/**
 * Client context routes — surface the AI-extracted durable facts about a client
 * (the unified "client context") to the frontend.
 */

import type { FastifyInstance } from 'fastify';
import { ClientFact, Client } from '../models/index.js';
import { requireAuth } from './_auth.js';

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  async function ensureClient(req: { userId: string }, clientId: string) {
    return Client.findOne({ _id: clientId, userId: req.userId });
  }

  // All durable facts for a client (powers the "Contexte client" page)
  app.get('/clients/:clientId/facts', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    if (!(await ensureClient(req, clientId))) {
      return reply.code(404).send({ error: 'Client not found' });
    }
    const facts = await ClientFact.find({ clientId })
      .sort({ category: 1, key: 1 })
      .lean();
    return { facts };
  });

  // Facts extracted from a specific ticket (powers the right-panel context)
  app.get('/tickets/:ticketId/facts', async (req) => {
    const { ticketId } = req.params as { ticketId: string };
    const facts = await ClientFact.find({ sourceTicketId: ticketId }).lean();
    return { facts };
  });
}
