/**
 * Ticket service — the orchestration heart of VPO Assistant.
 *
 * `analyzeTicket()` runs the full pipeline for a single ticket:
 *
 *   1. Build a compact client context (known facts + agent notes → prompt context)
 *   2. Call the analysis (Sonnet + tool_use → classification, suggested reply, facts)
 *   3. Merge the extracted client facts:
 *        - Drop existing facts sourced from THIS ticket (we're re-running)
 *        - Insert the new facts
 *   4. Chunk + embed the ticket text, replace existing chunks for this ticket
 *   5. Persist the analysis onto the ticket
 *
 * The "ticket-anchored" pattern (fact.sourceTicketId) makes step 3 idempotent:
 * re-running on an edited ticket produces the same result as the first run.
 */

import { Types } from 'mongoose';
import { Ticket, Client, ClientFact, Chunk, KnowledgeDoc } from '../models/index.js';
import { analyzeTicket as runAnalysis } from '../ai/analysis.js';
import { chunkText, embedTexts } from '../ai/embeddings.js';
import { buildClientContext } from '../ai/prompts.js';
import { config } from '../config.js';
import { removeFolder } from '../storage.js';

// ─── Thread helpers ──────────────────────────────────────────────────────────
export interface ThreadMessage {
  authorName: string;
  authorRole: string;
  body?: string | null;
  attachments?: { filename: string }[];
  at?: Date | string;
}

/** Flatten a ticket conversation into plain text for analysis + embeddings. */
export function threadToText(messages: ThreadMessage[]): string {
  return messages
    .map((m) => {
      const role = m.authorRole === 'agent' ? 'Agent' : 'Client';
      const files = (m.attachments ?? []).map((a) => a.filename);
      const header = `${m.authorName} (${role})`;
      const parts = [`${header}:`, (m.body ?? '').trim()];
      if (files.length) parts.push(`[pièces jointes : ${files.join(', ')}]`);
      return parts.filter(Boolean).join('\n');
    })
    .join('\n\n');
}

// ─── Progress reporting ──────────────────────────────────────────────────────
/** Ordered phases the editor's stepper renders. */
export type AnalysisStep = 'preparing' | 'analyzing' | 'context' | 'indexing' | 'finalizing';
export const ANALYSIS_STEPS: AnalysisStep[] = [
  'preparing',
  'analyzing',
  'context',
  'indexing',
  'finalizing',
];

export interface AnalysisProgress {
  step: AnalysisStep;
  index: number;
  total: number;
}

export interface AnalyzeOptions {
  /** Called at the start of each phase so the UI can drive a live stepper. */
  onProgress?: (p: AnalysisProgress) => void;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
export async function analyzeTicket(ticketId: string, opts: AnalyzeOptions = {}): Promise<void> {
  const total = ANALYSIS_STEPS.length;
  const emit = (step: AnalysisStep): void => {
    opts.onProgress?.({ step, index: ANALYSIS_STEPS.indexOf(step), total });
  };

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
  const threadText = threadToText(ticket.messages);
  if (threadText.trim().length < 20) {
    // Too short to analyze meaningfully. Mark as analyzed and bail.
    emit('finalizing');
    ticket.lastAnalyzedVersion = ticket.analysisVersion;
    ticket.lastAnalyzedAt = new Date();
    await ticket.save();
    return;
  }

  const clientId = ticket.clientId;
  const startVersion = ticket.analysisVersion;

  // 1. Build client context + knowledge base
  emit('preparing');
  const clientContext = await buildClientContextSummary(String(clientId));
  const knowledge = await buildKnowledgeContext(String(clientId));

  // 2. Analyze
  emit('analyzing');
  const analysis = await runAnalysis({
    ticketText: threadText,
    subject: ticket.subject,
    clientContext,
    knowledge,
  });

  // 3. Merge client facts. Each step is isolated: a failure in a secondary step
  // (facts, embeddings) must NOT prevent the ticket from being marked analyzed.
  emit('context');
  await runStep('mergeClientFacts', () =>
    mergeClientFacts(String(clientId), String(ticketId), analysis.facts),
  );

  // 4. Re-chunk + re-embed (RAG index). Most failure-prone step (external
  // embeddings API + Atlas) → isolated so it never blocks finalizing.
  emit('indexing');
  await runStep('reindexChunks', () =>
    reindexChunks(String(clientId), String(ticketId), threadText, startVersion),
  );

  // 5. Persist the analysis onto the ticket.
  emit('finalizing');
  ticket.analysis = {
    summary: analysis.summary,
    sentiment: analysis.sentiment,
    suggestedReply: analysis.suggestedReply,
    nextSteps: analysis.nextSteps,
    analyzedModel: config.models.analysis,
  } as never;
  ticket.category = analysis.category;
  // Only set priority from the AI if the agent hasn't (it defaults to 'medium').
  if (!ticket.priority || ticket.priority === 'medium') {
    ticket.priority = analysis.priority;
  }
  ticket.lastAnalyzedVersion = startVersion;
  ticket.lastAnalyzedAt = new Date();
  await ticket.save();
}

/** Run a pipeline step, logging (but swallowing) any error so the run continues. */
async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[analysis] step "${name}" failed (continuing):`, err);
  }
}

// ─── Client context summary builder ──────────────────────────────────────────
async function buildClientContextSummary(clientId: string): Promise<string> {
  const [client, facts] = await Promise.all([
    Client.findById(clientId).select('name company notes').lean(),
    ClientFact.find({ clientId }).select('category key value').sort({ category: 1 }).lean(),
  ]);
  if (!client) return '';

  return buildClientContext({
    client: { name: client.name, company: client.company, notes: client.notes },
    facts: facts.map((f) => ({ category: f.category, key: f.key, value: f.value })),
  });
}

// ─── Knowledge base context ──────────────────────────────────────────────────
// Compact reference docs (global + client-scoped) the analysis can reason over.
// Capped so a large doc set never blows up the prompt.
const KNOWLEDGE_PER_DOC = 2500;
const KNOWLEDGE_TOTAL = 9000;

async function buildKnowledgeContext(clientId: string): Promise<string> {
  const client = await Client.findById(clientId).select('userId').lean();
  if (!client) return '';

  const docs = await KnowledgeDoc.find({
    userId: client.userId,
    $or: [{ scope: 'global' }, { scope: 'client', clientId }],
  })
    .select('title content scope')
    .sort({ scope: 1, updatedAt: -1 })
    .lean();

  const parts: string[] = [];
  let budget = KNOWLEDGE_TOTAL;
  for (const d of docs) {
    const content = (d.content ?? '').trim();
    if (!content) continue;
    const scope = d.scope === 'global' ? 'GLOBAL' : 'CLIENT';
    const excerpt = content.slice(0, Math.min(KNOWLEDGE_PER_DOC, budget));
    parts.push(`## [${scope}] ${d.title}\n${excerpt}`);
    budget -= excerpt.length;
    if (budget <= 200) break;
  }
  return parts.join('\n\n');
}

// ─── Client facts merge ──────────────────────────────────────────────────────
async function mergeClientFacts(
  clientId: string,
  ticketId: string,
  facts: Awaited<ReturnType<typeof runAnalysis>>['facts'],
): Promise<void> {
  // Idempotent re-run: drop facts previously extracted from THIS ticket.
  await ClientFact.deleteMany({ clientId, sourceTicketId: ticketId });

  if (facts.length === 0) return;

  const docs = facts.map((f) => ({
    clientId: new Types.ObjectId(clientId),
    category: f.category,
    key: f.key,
    value: f.value,
    sourceTicketId: new Types.ObjectId(ticketId),
    sourceQuote: f.sourceQuote,
    confidence: f.confidence,
    factuality: f.factuality,
    extractedAt: new Date(),
  }));

  await ClientFact.insertMany(docs);
}

// ─── Chunks + embeddings ─────────────────────────────────────────────────────
async function reindexChunks(
  clientId: string,
  ticketId: string,
  content: string,
  version: number,
): Promise<void> {
  // Throw out existing chunks for this ticket — we always rewrite.
  await Chunk.deleteMany({ ticketId });

  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  // Embed in one batch call
  const vectors = await embedTexts(chunks.map((c) => c.text), 'document');

  const docs = chunks.map((c, i) => ({
    clientId: new Types.ObjectId(clientId),
    ticketId: new Types.ObjectId(ticketId),
    text: c.text,
    span: c.span,
    embedding: vectors[i],
    ticketVersion: version,
  }));

  await Chunk.insertMany(docs);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
/**
 * Remove every trace a ticket left behind (extracted facts + RAG chunks).
 * Called when a ticket is deleted so nothing orphaned lingers in the client
 * context or the vector index.
 */
export async function cleanupTicketData(clientId: string, ticketId: string): Promise<void> {
  const cid = new Types.ObjectId(clientId);
  const tid = new Types.ObjectId(ticketId);
  await Promise.all([
    ClientFact.deleteMany({ clientId: cid, sourceTicketId: tid }),
    Chunk.deleteMany({ ticketId: tid }),
    removeFolder(ticketId).catch(() => {}),
  ]);
}

/**
 * Delete every document belonging to a client. Called when a client is removed
 * so we don't leak tickets, facts, or chunks across the DB.
 */
export async function cleanupClientData(clientId: string): Promise<void> {
  const cid = new Types.ObjectId(clientId);

  // Remove stored files for this client's tickets + client-scoped knowledge docs.
  const [tickets, docs] = await Promise.all([
    Ticket.find({ clientId: cid }).select('_id').lean(),
    KnowledgeDoc.find({ clientId: cid, scope: 'client' }).select('_id').lean(),
  ]);
  await Promise.all([
    ...tickets.map((t) => removeFolder(String(t._id)).catch(() => {})),
    ...docs.map((d) => removeFolder(`kb-${d._id}`).catch(() => {})),
  ]);

  await Promise.all([
    Ticket.deleteMany({ clientId: cid }),
    ClientFact.deleteMany({ clientId: cid }),
    Chunk.deleteMany({ clientId: cid }),
    KnowledgeDoc.deleteMany({ clientId: cid, scope: 'client' }),
  ]);
}
