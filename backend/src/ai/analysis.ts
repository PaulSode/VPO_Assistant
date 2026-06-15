/**
 * Ticket analysis step.
 *
 * Input: ticket text + compact client context + (optionally) an index of
 * reference documents the model can read ON DEMAND.
 * Output: structured AnalysisResult (classification + suggested reply + facts)
 *
 * Cost control: instead of stuffing every document into every request, we send
 * a lightweight index (id · title · description). The model calls fetch_documents
 * for the few that look relevant, and we return only those. Clients with no
 * documents pay nothing extra (single forced tool call, as before).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, cachedSystem } from './client.js';
import { config } from '../config.js';
import { ANALYSIS_SYSTEM, ANALYSIS_TOOL, FETCH_DOCUMENTS_TOOL } from './prompts.js';

// ─── Output shape ────────────────────────────────────────────────────────────
export interface ExtractedFact {
  category: 'account' | 'product' | 'environment' | 'preference' | 'history' | 'contact';
  key: string;
  value: string;
  factuality: 'stated' | 'inferred';
  sourceQuote: string;
  confidence: number;
}

export interface AnalysisResult {
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  summary: string;
  suggestedReply: string;
  nextSteps: string[];
  facts: ExtractedFact[];
}

// ─── Knowledge index / loader ─────────────────────────────────────────────────
export interface KnowledgeIndexItem {
  id: string;
  title: string;
  description?: string;
  scope: 'global' | 'client';
}
export interface LoadedDoc {
  id: string;
  title: string;
  content: string;
}

/** How many fetch rounds the model gets before we force it to conclude. */
const MAX_FETCH_ROUNDS = 2;

// ─── Main function ───────────────────────────────────────────────────────────
export async function analyzeTicket(args: {
  ticketText: string;
  subject: string;
  clientContext: string;
  knowledgeIndex?: KnowledgeIndexItem[];
  loadDocuments?: (ids: string[]) => Promise<LoadedDoc[]>;
}): Promise<AnalysisResult> {
  const hasKnowledge = (args.knowledgeIndex?.length ?? 0) > 0 && !!args.loadDocuments;

  const indexBlock = hasKnowledge
    ? `DOCUMENT INDEX (available reference docs — call fetch_documents to read the relevant ones):

${args.knowledgeIndex!
        .map((d) => `- id: ${d.id} · [${d.scope}] ${d.title}${d.description ? ` — ${d.description}` : ''}`)
        .join('\n')}

`
    : '';

  const userMessage = `CLIENT CONTEXT (what we already know — reference it, don't repeat it):

${args.clientContext || '(empty — first ticket from this client)'}

${indexBlock}TICKET
- Subject: ${args.subject}

MESSAGE
---
${args.ticketText}
---

Analyze this ticket. Classify it, draft a reply to the customer, list internal next steps, and extract durable client facts. ${
    hasKnowledge ? 'Read any clearly relevant documents first, then call' : 'Call'
  } the record_analysis tool.`;

  // Fast path: no knowledge base → single forced call, no fetch tool, no loop.
  if (!hasKnowledge) {
    const response = await anthropic.messages.create({
      model: config.models.analysis,
      max_tokens: 4096,
      system: cachedSystem(ANALYSIS_SYSTEM),
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'record_analysis' },
      messages: [{ role: 'user', content: userMessage }],
    });
    return normalize(findToolInput(response, 'record_analysis'));
  }

  // Agentic path: the model may fetch documents before recording its analysis.
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];

  for (let round = 0; ; round++) {
    const forceRecord = round >= MAX_FETCH_ROUNDS;
    const response = await anthropic.messages.create({
      model: config.models.analysis,
      max_tokens: 4096,
      system: cachedSystem(ANALYSIS_SYSTEM),
      tools: [FETCH_DOCUMENTS_TOOL, ANALYSIS_TOOL],
      tool_choice: forceRecord ? { type: 'tool', name: 'record_analysis' } : { type: 'any' },
      messages,
    });

    const record = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'record_analysis',
    );
    if (record) return normalize(record.input as Partial<AnalysisResult>);

    const fetches = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'fetch_documents',
    );
    if (fetches.length === 0) {
      // No tool call we can act on — loop once more, forcing the record next time.
      if (forceRecord) {
        throw new Error('Analysis failed: model never called record_analysis.');
      }
      continue;
    }

    // Echo the assistant turn, then answer each fetch with the document contents.
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const f of fetches) {
      const ids = ((f.input as { documentIds?: unknown }).documentIds ?? []) as string[];
      const docs = await args.loadDocuments!(ids.slice(0, 5));
      const text = docs.length
        ? docs.map((d) => `### ${d.title}\n${d.content}`).join('\n\n---\n\n')
        : '(no document found for those ids)';
      results.push({ type: 'tool_result', tool_use_id: f.id, content: text });
    }
    messages.push({ role: 'user', content: results });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function findToolInput(response: Anthropic.Message, name: string): Partial<AnalysisResult> {
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name,
  );
  if (!block) throw new Error(`Analysis failed: no ${name} tool_use in Claude response.`);
  return block.input as Partial<AnalysisResult>;
}

function normalize(raw: Partial<AnalysisResult>): AnalysisResult {
  return {
    category: raw.category ?? 'other',
    priority: raw.priority ?? 'medium',
    sentiment: raw.sentiment ?? 'neutral',
    summary: raw.summary ?? '',
    suggestedReply: raw.suggestedReply ?? '',
    nextSteps: raw.nextSteps ?? [],
    facts: raw.facts ?? [],
  };
}
