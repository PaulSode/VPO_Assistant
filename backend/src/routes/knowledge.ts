/**
 * Knowledge base routes.
 *
 * Reference documents the AI can consult during analysis. Two scopes:
 *   - global : shared across all of an agent's clients
 *   - client : attached to one client
 *
 * Text content is what the AI reads. Text files are decoded into `content`
 * automatically; binary files (pdf/docx) are stored and downloadable, and the
 * agent can paste their text into `content` for the AI to use.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KnowledgeDoc, Client } from '../models/index.js';
import { requireAuth } from './_auth.js';
import { storeAttachment, removeFolder } from '../storage.js';

const MAX_CONTENT = 200_000;

const fileSchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().max(150).optional(),
  dataBase64: z.string().min(1),
});

const createSchema = z
  .object({
    scope: z.enum(['global', 'client']),
    clientId: z.string().length(24).optional(),
    title: z.string().min(1).max(200),
    content: z.string().max(MAX_CONTENT).optional(),
    file: fileSchema.optional(),
  })
  .refine((v) => v.scope === 'global' || !!v.clientId, {
    message: 'clientId is required for client-scoped documents',
  });

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(MAX_CONTENT).optional(),
});

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|html?|yaml|yml)$/i;
function isTextFile(filename: string, mime?: string): boolean {
  return (mime?.startsWith('text/') ?? false) || TEXT_EXT.test(filename);
}

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  // List global docs for the current agent
  app.get('/knowledge', async (req) => {
    const docs = await KnowledgeDoc.find({ userId: req.userId, scope: 'global' })
      .select('-content')
      .sort({ updatedAt: -1 })
      .lean();
    return { docs };
  });

  // List docs for a specific client
  app.get('/clients/:clientId/knowledge', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const client = await Client.findOne({ _id: clientId, userId: req.userId });
    if (!client) return reply.code(404).send({ error: 'Client not found' });
    const docs = await KnowledgeDoc.find({ userId: req.userId, scope: 'client', clientId })
      .select('-content')
      .sort({ updatedAt: -1 })
      .lean();
    return { docs };
  });

  // Read one doc (with content)
  app.get('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await KnowledgeDoc.findOne({ _id: id, userId: req.userId }).lean();
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    return { doc };
  });

  // Create a doc (optionally from an uploaded file)
  app.post('/knowledge', async (req, reply) => {
    const body = createSchema.parse(req.body);

    if (body.scope === 'client') {
      const client = await Client.findOne({ _id: body.clientId, userId: req.userId });
      if (!client) return reply.code(404).send({ error: 'Client not found' });
    }

    let content = body.content ?? '';
    const doc = await KnowledgeDoc.create({
      userId: req.userId,
      scope: body.scope,
      clientId: body.scope === 'client' ? body.clientId : null,
      title: body.title,
      content,
      source: body.file ? 'file' : 'text',
    });

    if (body.file) {
      const stored = await storeAttachment({
        folder: `kb-${doc._id}`,
        filename: body.file.filename,
        mime: body.file.mime,
        dataBase64: body.file.dataBase64,
      });
      doc.file = stored as never;

      // Auto-extract text from text files when no content was pasted.
      if (!content.trim() && isTextFile(body.file.filename, body.file.mime)) {
        const b64 = body.file.dataBase64.includes(',')
          ? body.file.dataBase64.split(',', 2)[1]!
          : body.file.dataBase64;
        content = Buffer.from(b64, 'base64').toString('utf8').slice(0, MAX_CONTENT);
        doc.content = content;
      }
      await doc.save();
    }

    reply.code(201);
    return { doc };
  });

  // Update title / content
  app.patch('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const doc = await KnowledgeDoc.findOneAndUpdate(
      { _id: id, userId: req.userId },
      body,
      { new: true },
    );
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    return { doc };
  });

  // Delete a doc (+ its stored file)
  app.delete('/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await KnowledgeDoc.findOneAndDelete({ _id: id, userId: req.userId });
    if (!r) return reply.code(404).send({ error: 'Document not found' });
    await removeFolder(`kb-${id}`).catch(() => {});
    reply.code(204);
  });
}
