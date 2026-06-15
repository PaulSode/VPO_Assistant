/**
 * Prompt templates for VPO Assistant's AI pipeline.
 *
 * Why we use `tool_use` instead of asking for JSON in plain text:
 *   - Schema-enforced output (no parsing of malformed JSON)
 *   - The model is incentivized to fill exactly the declared shape
 *   - Clear separation between reasoning (text) and structured data (tool input)
 *
 * Tone in prompts: English instructions, content can be any language.
 * Claude handles multilingual content seamlessly; English instructions are slightly
 * more reliable for structured tasks.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ─── Analysis system prompt ──────────────────────────────────────────────────
export const ANALYSIS_SYSTEM = `You are an experienced N2 customer-support analyst.

Your job: read a single support ticket (the customer's message) plus what we already
know about this client, then produce a structured analysis that helps a support agent
resolve it fast.

CRITICAL RULES
- ALWAYS write customer-facing text (the suggested reply) in the SAME language as the
  ticket. If the ticket is in French, the reply is in French.
- Classify the ticket:
    category  — a short, stable lowercase label (e.g. 'billing', 'bug', 'how-to',
                'account', 'feature-request', 'outage'). Reuse common labels.
    priority  — low | medium | high | urgent. Judge by customer impact and urgency.
    sentiment — positive | neutral | negative | frustrated.
- summary: 1-2 sentences, factual, for the agent (not the customer).
- suggestedReply: a ready-to-send draft answer to the CUSTOMER. Polite, concrete,
  on-brand. Acknowledge the problem, give the fix or the next step. If you lack
  information to fully resolve it, ask the precise question(s) needed. Do not invent
  facts, prices, or policies you were not given.
- nextSteps: 1-4 short internal action items for the agent (imperative).
- facts: extract only DURABLE facts about the CLIENT that will matter for future
  tickets (their plan, product, environment, key contacts, recurring preferences or
  history). Skip anything specific to just this one incident. Aim for FEW high-signal
  facts. Use STABLE snake_case keys (always 'plan', never 'subscription_plan') so the
  same fact reuses the same key across tickets. Copy a short supporting quote (max 20
  words) for each. Mark factuality 'stated' (written explicitly) or 'inferred'.

KNOWLEDGE BASE
- The user message may include an INDEX of reference documents (id, title,
  description) — tool guides, configuration rules, internal procedures. The index
  lists what's available WITHOUT the full text.
- If one or more documents look relevant to diagnosing or resolving THIS ticket, call
  the fetch_documents tool with their ids to read them BEFORE answering. Fetch only
  what is clearly relevant — never fetch everything "just in case".
- Use what you read to find concrete correction angles: a misconfigured filter, a rule
  not applied, a known limitation, a documented procedure. Ground the suggested reply
  and next steps in the documentation, and refer to the document by title. Never invent
  rules that aren't in the docs or the ticket.
- If no document is relevant, go straight to record_analysis.

The user message will provide:
  1. A compact summary of what we already know about the client
  2. An optional index of available reference documents
  3. The ticket subject + body

Respond by calling the record_analysis tool. No prose.`;

// ─── Analysis tool schema ─────────────────────────────────────────────────────
export const ANALYSIS_TOOL: Anthropic.Tool = {
  name: 'record_analysis',
  description: 'Record the classification, suggested reply, next steps, and extracted client facts for a support ticket.',
  input_schema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: "Short stable lowercase label, e.g. 'billing', 'bug', 'how-to'.",
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent'],
      },
      sentiment: {
        type: 'string',
        enum: ['positive', 'neutral', 'negative', 'frustrated'],
      },
      summary: {
        type: 'string',
        description: 'One or two factual sentences for the agent.',
      },
      suggestedReply: {
        type: 'string',
        description: "Ready-to-send draft answer to the customer, in the ticket's language.",
      },
      nextSteps: {
        type: 'array',
        description: '1-4 short internal action items (imperative).',
        items: { type: 'string' },
      },
      facts: {
        type: 'array',
        description: 'Durable facts about the client worth remembering across tickets.',
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['account', 'product', 'environment', 'preference', 'history', 'contact'],
            },
            key: { type: 'string', description: 'snake_case key, e.g. plan, os, main_product' },
            value: { type: 'string' },
            factuality: { type: 'string', enum: ['stated', 'inferred'] },
            sourceQuote: { type: 'string', description: 'Verbatim, max 20 words.' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['category', 'key', 'value', 'factuality', 'sourceQuote', 'confidence'],
        },
      },
    },
    required: ['category', 'priority', 'sentiment', 'summary', 'suggestedReply', 'nextSteps', 'facts'],
  },
};

// ─── Knowledge fetch tool ─────────────────────────────────────────────────────
// Lets the analysis model pull the full text of relevant documents on demand,
// instead of loading every document into every request.
export const FETCH_DOCUMENTS_TOOL: Anthropic.Tool = {
  name: 'fetch_documents',
  description:
    'Load the full text of one or more reference documents from the index, by id, when they look relevant to resolving the ticket. Returns their content so you can ground your analysis in it.',
  input_schema: {
    type: 'object',
    properties: {
      documentIds: {
        type: 'array',
        description: 'Ids of the documents to read, taken from the provided index.',
        items: { type: 'string' },
      },
    },
    required: ['documentIds'],
  },
};

// ─── Assistant (chat) ─────────────────────────────────────────────────────────
export const ASSISTANT_SYSTEM = `You are VPO Assistant's support copilot. You help a support agent handle a client.

You are given a compact context about the client (durable facts + agent notes) and
relevant excerpts from their past tickets. Your job: answer the agent's questions and
help them draft replies — fast and grounded.

PRINCIPLES
- Always reason from the provided client context and ticket excerpts. Never invent
  account details, prices, or policies. If you lack the information, say so and tell
  the agent what to check.
- When you reference a past ticket, cite its subject (and reference number if shown).
- Stay in the language of the conversation.
- Be concise and operational. The agent is mid-shift.
- When asked for a reply to the customer, produce a polished, on-brand draft.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a compact textual representation of the client context suitable for prompt
 * context. Groups durable facts by category and appends the agent's free-form notes.
 */
export function buildClientContext(args: {
  client: { name: string; company?: string | null; notes?: string | null };
  facts: { category: string; key: string; value: string }[];
}): string {
  const lines: string[] = [];

  lines.push(`# CLIENT: ${args.client.name}${args.client.company ? ` (${args.client.company})` : ''}`);

  if (args.facts.length) {
    const byCategory = new Map<string, { key: string; value: string }[]>();
    for (const f of args.facts) {
      const list = byCategory.get(f.category) ?? [];
      list.push({ key: f.key, value: f.value });
      byCategory.set(f.category, list);
    }
    lines.push('\n# KNOWN FACTS');
    for (const [category, items] of byCategory) {
      lines.push(`## ${category}`);
      for (const it of items) lines.push(`- ${it.key}: ${it.value}`);
    }
  }

  if (args.client.notes && args.client.notes.trim()) {
    lines.push('\n# AGENT NOTES');
    lines.push(args.client.notes.trim());
  }

  return lines.join('\n');
}
