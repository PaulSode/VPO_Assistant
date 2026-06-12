import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Client } from '../models/index.js';
import { requireAuth } from './_auth.js';
import { cleanupClientData } from '../services/ticketService.js';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional().or(z.literal('')),
  notes: z.string().max(5000).optional(),
});

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  app.get('/clients', async (req) => {
    const clients = await Client.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .lean();
    return { clients };
  });

  app.post('/clients', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const client = await Client.create({ ...body, userId: req.userId });
    reply.code(201);
    return { client };
  });

  app.get('/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await Client.findOne({ _id: id, userId: req.userId }).lean();
    if (!client) return reply.code(404).send({ error: 'Client not found' });
    return { client };
  });

  app.patch('/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createSchema.partial().parse(req.body);
    const client = await Client.findOneAndUpdate(
      { _id: id, userId: req.userId },
      body,
      { new: true },
    );
    if (!client) return reply.code(404).send({ error: 'Client not found' });
    return { client };
  });

  app.delete('/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await Client.deleteOne({ _id: id, userId: req.userId });
    if (r.deletedCount === 0) return reply.code(404).send({ error: 'Client not found' });
    // Cascade: remove all tickets, facts, and chunks for this client.
    try {
      await cleanupClientData(id);
    } catch (err) {
      req.log.error({ err }, 'cleanupClientData failed after client delete');
    }
    reply.code(204);
  });
}
