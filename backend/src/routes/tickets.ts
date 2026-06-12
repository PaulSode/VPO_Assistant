import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Ticket, Client } from '../models/index.js';
import { requireAuth } from './_auth.js';
import { startSSE } from './_sse.js';
import { analyzeTicket, cleanupTicketData } from '../services/ticketService.js';

// Guards against two overlapping analyses of the same ticket (e.g. two tabs).
const inFlightAnalyses = new Set<string>();

const createSchema = z.object({
  clientId: z.string().length(24),
  subject: z.string().min(1).max(300),
  content: z.string().default(''),
  reference: z.string().max(100).optional(),
  channel: z.enum(['email', 'phone', 'chat', 'other']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

const updateContentSchema = z.object({
  content: z.string(),
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

  // Read ticket (with content)
  app.get('/tickets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });
    return { ticket };
  });

  // Save ticket content
  app.put('/tickets/:id/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { content } = updateContentSchema.parse(req.body);
    const ticket = await ensureOwned(req, id);
    if (!ticket) return reply.code(404).send({ error: 'Ticket not found' });

    // Only bump the analysis version when the text actually changed.
    const changed = ticket.content !== content;
    ticket.content = content;
    if (changed) ticket.analysisVersion += 1;
    await ticket.save();

    return { savedAt: new Date(), analysisVersion: ticket.analysisVersion };
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
