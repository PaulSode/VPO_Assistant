import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Ticket, Client } from '../models/index.js';
import { requireAuth } from './_auth.js';
import { startSSE } from './_sse.js';
import { analyzeTicket, cleanupTicketData } from '../services/ticketService.js';
import { storeAttachment } from '../storage.js';

// Guards against two overlapping analyses of the same ticket (e.g. two tabs).
const inFlightAnalyses = new Set<string>();

const createSchema = z.object({
  clientId: z.string().length(24),
  subject: z.string().min(1).max(300),
  reference: z.string().max(100).optional(),
  channel: z.enum(['email', 'phone', 'chat', 'other']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

const importSchema = z.object({
  messages: z
    .array(
      z.object({
        authorName: z.string().min(1).max(120),
        authorRole: z.enum(['customer', 'agent']),
        body: z.string().max(20_000).default(''),
        at: z.string().optional(), // ISO timestamp; falls back to now if absent/invalid
      }),
    )
    .min(1)
    .max(300),
});

const addMessageSchema = z.object({
  authorName: z.string().min(1).max(120),
  authorRole: z.enum(['customer', 'agent']),
  body: z.string().max(20_000).default(''),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        mime: z.string().max(150).optional(),
        dataBase64: z.string().min(1),
      }),
    )
    .max(10)
    .optional(),
});

const updateMetaSchema = z.object({
  subject: z.string().min(1).max(300).optional(),
  status: z.enum(['new', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  reference: z.string().max(100).optional(),
  channel: z.enum(['email', 'phone', 'chat', 'other']).optional(),
});

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  // Helper to verify the ticket belongs to the user (via its client)
  async function ensureOwned(req: { userId: string }, ticketId: string) {
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) return null;
    const client = await Client.findOne({ _id: ticket.clientId, userId: req.userId });
    if (!client) return null;
    return ticket;
  }

  // List tickets of a client
  app.get('/clients/:clientId/tickets', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const client = await Client.findOne({ _id: clientId, userId: req.userId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    const tickets = await Ticket.find({ clientId })
      .select('-content') // don't ship full text on list calls
      .sort({ createdAt: -1 })
      .lean();
    return { tickets };
  });

  // Create ticket
  app.post('/tickets', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const client = await Client.findOne({ _id: body.clientId, userId: req.userId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    const ticket = await Ticket.create(body);
    // Analysis is manual (the "Analyser le ticket" button).
    reply.code(201);
    return { ticket };
  });

  // Read ticket (with the full conversation)
  app.get('/tickets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });
    return { ticket };
  });

  // Append a message to the ticket conversation (with optional attachments).
  app.post('/tickets/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = addMessageSchema.parse(req.body);
    if (!body.body.trim() && (!body.attachments || body.attachments.length === 0)) {
      return reply.code(400).send({ error: 'Empty message' });
    }
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    // Persist any attachments to disk, collect their metadata.
    const stored = [];
    for (const att of body.attachments ?? []) {
      stored.push(
        await storeAttachment({
          folder: id,
          filename: att.filename,
          mime: att.mime,
          dataBase64: att.dataBase64,
        }),
      );
    }

    ticket.messages.push({
      authorName: body.authorName,
      authorRole: body.authorRole,
      body: body.body,
      attachments: stored,
      at: new Date(),
    } as never);
    // New content → re-analysis becomes relevant.
    ticket.analysisVersion += 1;
    await ticket.save();

    return { ticket };
  });

  // Bulk-import a parsed conversation (paste / file). Preserves original
  // timestamps so the imported thread keeps its real chronology.
  app.post('/tickets/:id/messages/import', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { messages } = importSchema.parse(req.body);
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    for (const m of messages) {
      const at = m.at ? new Date(m.at) : new Date();
      ticket.messages.push({
        authorName: m.authorName,
        authorRole: m.authorRole,
        body: m.body,
        attachments: [],
        at: isNaN(at.getTime()) ? new Date() : at,
      } as never);
    }
    ticket.analysisVersion += 1;
    await ticket.save();
    return { ticket };
  });

  // Remove a message from the conversation.
  app.delete('/tickets/:id/messages/:messageId', async (req, reply) => {
    const { id, messageId } = req.params as { id: string; messageId: string };
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });
    const before = ticket.messages.length;
    ticket.messages = ticket.messages.filter(
      (m) => String((m as { _id: unknown })._id) !== messageId,
    ) as typeof ticket.messages;
    if (ticket.messages.length !== before) ticket.analysisVersion += 1;
    await ticket.save();
    return { ticket };
  });

  // Manually trigger the AI analysis pipeline for a ticket.
  // Streams live progress as Server-Sent Events (stepper):
  //   event: step  { step, index, total }
  //   event: done  {}
  //   event: error { message }
  app.post('/tickets/:id/analyze', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    const sse = startSSE(req, reply);

    if (inFlightAnalyses.has(id)) {
      sse.write('error', { message: 'Une analyse est déjà en cours pour ce ticket.' });
      sse.end();
      return;
    }

    inFlightAnalyses.add(id);
    try {
      await analyzeTicket(id, {
        onProgress: (p) => sse.write('step', p),
      });
      sse.write('done', {});
    } catch (err) {
      req.log.error({ err }, 'Ticket analysis failed');
      sse.write('error', { message: "L'analyse a échoué." });
    } finally {
      inFlightAnalyses.delete(id);
      sse.end();
    }
  });

  // Update ticket metadata (subject, status, priority, reference, channel)
  app.patch('/tickets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateMetaSchema.parse(req.body);
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });
    Object.assign(ticket, body);
    await ticket.save();
    return { ticket };
  });

  app.delete('/tickets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });
    const clientId = String(ticket.clientId);
    await ticket.deleteOne();
    // Remove the facts + chunks this ticket contributed.
    try {
      await cleanupTicketData(clientId, id);
    } catch (err) {
      req.log.error({ err }, 'cleanupTicketData failed after ticket delete');
    }
    reply.code(204);
  });
}
