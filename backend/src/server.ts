import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';

import { config } from './config.js';
import { connectDB, disconnectDB } from './db.js';

import { clientRoutes } from './routes/clients.js';
import { ticketRoutes } from './routes/tickets.js';
import { contextRoutes } from './routes/context.js';
import { searchRoutes } from './routes/search.js';
import { assistantRoutes } from './routes/assistant.js';
import { meRoutes } from './routes/me.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { readAttachment } from './storage.js';

async function build() {
  const app = Fastify({
    logger: {
      level: config.env === 'production' ? 'info' : 'debug',
      transport:
        config.env !== 'production'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
    // Attachments are sent as base64 inside the JSON message payload.
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.env === 'production'
      ? [/\.vpo-assistant\.app$/]
      : true,
    credentials: true,
  });
  await app.register(sensible);

  // Convert Zod errors → 400 JSON
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'ValidationError', issues: err.issues });
    }
    req.log.error(err);
    return reply.code(err.statusCode ?? 500).send({
      error: err.name || 'InternalServerError',
      message: err.message,
    });
  });

  app.get('/healthz', async () => ({ ok: true, time: new Date().toISOString() }));

  // Serve ticket attachments. Public by design (POC): the stored name carries a
  // UUID so it's unguessable, and browsers can't attach the dev-auth header to
  // <img>/<a> requests. Swap for signed URLs behind real auth in production.
  app.get('/files/:folder/:stored', async (req, reply) => {
    const { folder, stored } = req.params as { folder: string; stored: string };
    try {
      const buf = await readAttachment(folder, stored);
      // Derive a content type from the extension; default to octet-stream.
      const ext = stored.split('.').pop()?.toLowerCase() ?? '';
      const types: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
      };
      reply.header('Content-Type', types[ext] ?? 'application/octet-stream');
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: 'File not found' });
    }
  });

  // Mount routes under /v1
  await app.register(
    async (api) => {
      await api.register(clientRoutes);
      await api.register(ticketRoutes);
      await api.register(contextRoutes);
      await api.register(searchRoutes);
      await api.register(assistantRoutes);
      await api.register(knowledgeRoutes);
      await api.register(meRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}

async function main() {
  await connectDB();
  const app = await build();

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
