import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  env: process.env.NODE_ENV ?? 'development',

  mongoUri: required('MONGO_URI'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  voyageApiKey: required('VOYAGE_API_KEY'),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',

  // Claude model selection — ticket analysis needs structured reasoning,
  // the assistant needs smooth streaming.
  models: {
    /** Structured ticket analysis: classify, draft a reply, extract client facts. */
    analysis: 'claude-sonnet-4-6',
    /** Streaming assistant for the agent (Q&A over the client's history). */
    assistant: 'claude-sonnet-4-6',
    /** Cheap summarization tasks. */
    summarizer: 'claude-haiku-4-5-20251001',
  },

  embedding: {
    // Voyage model + dimensions. Must match the Atlas Vector Search index definition.
    model: 'voyage-3-large',
    dimensions: 1024,
    // Paragraph-based chunking with sliding window for long paragraphs.
    targetChunkChars: 1200,
    maxChunkChars: 1800,
  },
} as const;

export type Config = typeof config;
