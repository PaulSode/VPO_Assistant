/**
 * Assistant route.
 *
 * POST /clients/:clientId/assistant
 *   body: { messages: [{role, content}], currentTicketId?: string }
 *
 * Server-Sent Events stream of text deltas.
 * The frontend appends each delta to the visible assistant message.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Client, Ticket, ClientFact } from '../models/index.js';
import { streamAssistant, type AssistantMessage } from '../ai/assistant.js';
import { searchChunks } from '../services/rag.js';
import { buildClientContext } from '../ai/prompts.js';
import { requireAuth } from './_auth.js';
import { startSSE } from './_sse.js';

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(40),
  currentTicketId: z.string().length(24).optional(),
});

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  app.post('/clients/:clientId/assistant', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const { messages, currentTicketId } = bodySchema.parse(req.body);

    const client = await Client.findOne({ _id: clientId, userId: req.userId }).lean();
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    // Build context: client facts + agent notes (+ optional current ticket + RAG)
    const facts = await ClientFact.find({ clientId }).select('category key value').lean();
    const clientContext = buildClientContext({
      client: { name: client.name, company: client.company, notes: client.notes },
      facts: facts.map((f) => ({ category: f.category, key: f.key, value: f.value })),
    });

    let currentTicket: { subject: string; content: string } | undefined;
    if (currentTicketId) {
      const t = await Ticket.findById(currentTicketId).select('subject content').lean();
      if (t) currentTicket = { subject: t.subject, content: t.content };
    }

    // RAG: embed the last user message and pull relevant ticket excerpts
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    let ragHits: { ticketSubject: string; quote: string }[] = [];
    if (lastUser) {
      try {
        const hits = await searchChunks({ clientId, query: lastUser.content, k: 6 });
        ragHits = hits.map((h) => ({ ticketSubject: h.ticketSubject, quote: h.text }));
      } catch (err) {
        // Vector search may not be configured in dev — degrade gracefully.
        req.log.warn({ err }, 'RAG search failed, continuing without hits');
      }
    }

    // ─── Stream as SSE ────────────────────────────────────────────────────
    const sse = startSSE(req, reply);

    try {
      sse.write('start', { ragHits: ragHits.map((h) => h.ticketSubject) });

      const stream = streamAssistant({
        history: messages as AssistantMessage[],
        context: { clientContext, currentTicket, ragHits },
      });

      for await (const delta of stream) {
        sse.write('delta', { text: delta });
      }

      sse.write('done', {});
    } catch (err) {
      req.log.error({ err }, 'Assistant stream failed');
      sse.write('error', { message: 'Assistant stream failed.' });
    } finally {
      sse.end();
    }
  });
}
