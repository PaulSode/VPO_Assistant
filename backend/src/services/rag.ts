/**
 * RAG retrieval over a client's ticket text chunks.
 *
 * Uses MongoDB Atlas Vector Search via the $vectorSearch aggregation stage.
 * The index must be created on the chunks collection (see scripts/createIndexes.ts).
 */

import { Types } from 'mongoose';
import { Chunk, Ticket } from '../models/index.js';
import { embedQuery } from '../ai/embeddings.js';

export interface RagHit {
  chunkId: string;
  ticketId: string;
  ticketSubject: string;
  text: string;
  span: [number, number];
  score: number;
}

export async function searchChunks(args: {
  clientId: string;
  query: string;
  k?: number;
}): Promise<RagHit[]> {
  const k = args.k ?? 8;
  const queryVector = await embedQuery(args.query);

  const results = await Chunk.aggregate([
    {
      $vectorSearch: {
        index: 'chunks_vector_idx',
        path: 'embedding',
        queryVector,
        numCandidates: k * 10,
        limit: k,
        filter: { clientId: new Types.ObjectId(args.clientId) },
      },
    },
    {
      $project: {
        _id: 1,
        ticketId: 1,
        text: 1,
        span: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);

  // Join ticket subjects in a single follow-up query.
  const ticketIds = [...new Set(results.map((r) => String(r.ticketId)))];
  const tickets = await Ticket.find({ _id: { $in: ticketIds } })
    .select('subject')
    .lean();
  const subjectMap = new Map(tickets.map((t) => [String(t._id), t.subject]));

  return results.map((r) => ({
    chunkId: String(r._id),
    ticketId: String(r.ticketId),
    ticketSubject: subjectMap.get(String(r.ticketId)) ?? '?',
    text: r.text,
    span: r.span as [number, number],
    score: r.score,
  }));
}
