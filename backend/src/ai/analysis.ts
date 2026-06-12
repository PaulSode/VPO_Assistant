/**
 * Ticket analysis step.
 *
 * Input: ticket text + compact client context
 * Output: structured AnalysisResult (classification + suggested reply + facts)
 *
 * Uses Claude's tool_use mechanism to guarantee schema compliance.
 * Cost: one call per manual "Analyser le ticket" click.
 */

import { anthropic, cachedSystem } from './client.js';
import { config } from '../config.js';
import { ANALYSIS_SYSTEM, ANALYSIS_TOOL } from './prompts.js';

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

// ─── Main function ───────────────────────────────────────────────────────────
export async function analyzeTicket(args: {
  ticketText: string;
  subject: string;
  clientContext: string;
}): Promise<AnalysisResult> {
  const userMessage = `CLIENT CONTEXT (what we already know — reference it, don't repeat it):

${args.clientContext || '(empty — first ticket from this client)'}

TICKET
- Subject: ${args.subject}

MESSAGE
---
${args.ticketText}
---

Analyze this ticket. Classify it, draft a reply to the customer, list internal next steps, and extract durable client facts. Use the record_analysis tool.`;

  const response = await anthropic.messages.create({
    model: config.models.analysis,
    max_tokens: 4096,
    // Cache the constant tools + system prefix (reused on every analysis).
    system: cachedSystem(ANALYSIS_SYSTEM),
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'record_analysis' },
    messages: [{ role: 'user', content: userMessage }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Analysis failed: no tool_use block in Claude response.');
  }

  // We forced tool_choice so we know this is record_analysis.
  const raw = toolUse.input as Partial<AnalysisResult>;

  // Defensive defaults — normalise so downstream code is gentler.
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
