import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Client } from '../models/index.js';
import { searchChunks } from '../services/rag.js';
import { requireAuth } from './_auth.js';

const querySchema = z.object({
  q: z.string().min(2).max(500),
  k: z.coerce.number().int().min(1).max(20).optional(),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  // Semantic search across all tickets of a client
  app.get('/clients/:clientId/search', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const { q, k } = querySchema.parse(req.query);

    const client = await Client.findOne({ _id: clientId, userId: req.userId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });

    const hits = await searchChunks({ clientId, query: q, k });
    return { hits };
  });
}
