/**
 * Streaming assistant.
 *
 * For interactive agent Q&A and reply drafting.
 * Yields incremental text deltas suitable for piping into Server-Sent Events.
 *
 * Context strategy:
 *   1. Always include the compact client context (durable facts + agent notes)
 *   2. If the agent is focused on a ticket, include it in full
 *   3. Otherwise RAG: retrieve top-K relevant ticket excerpts
 */

import { anthropic, cachedSystem } from './client.js';
import { config } from '../config.js';
import { ASSISTANT_SYSTEM } from './prompts.js';

export interface AssistantContext {
  clientContext: string;
  currentTicket?: { subject: string; content: string };
  ragHits?: { ticketSubject: string; quote: string }[];
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Stream a response. Each yielded value is a text delta (not a full message).
 */
export async function* streamAssistant(args: {
  history: AssistantMessage[];
  context: AssistantContext;
}): AsyncGenerator<string, void, void> {
  const contextBlock = buildContextBlock(args.context);

  // Inject the client context as the first user turn, then real history.
  // (Prepending context-as-first-message keeps cache-friendly turn structure.)
  const messages: AssistantMessage[] = [
    { role: 'user', content: contextBlock },
    {
      role: 'assistant',
      content: "Compris. J'ai chargé le contexte client et les tickets pertinents. Comment puis-je aider ?",
    },
    ...args.history,
  ];

  const stream = anthropic.messages.stream({
    model: config.models.assistant,
    max_tokens: 2048,
    system: cachedSystem(ASSISTANT_SYSTEM),
    messages,
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }
}

function buildContextBlock(ctx: AssistantContext): string {
  const parts: string[] = [];

  parts.push('=== CONTEXTE CLIENT ===');
  parts.push(ctx.clientContext);

  if (ctx.currentTicket) {
    parts.push('');
    parts.push(`=== TICKET EN COURS — ${ctx.currentTicket.subject} ===`);
    parts.push(ctx.currentTicket.content);
  }

  if (ctx.ragHits && ctx.ragHits.length > 0) {
    parts.push('');
    parts.push('=== EXTRAITS DE TICKETS PERTINENTS ===');
    for (const h of ctx.ragHits) {
      parts.push(`[${h.ticketSubject}] ${h.quote}`);
    }
  }

  return parts.join('\n');
}
