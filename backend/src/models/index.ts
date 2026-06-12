/**
 * VPO Assistant data model — customer ticket tracking.
 *
 * Three layers (mirrors the original skeleton, repointed to support):
 *   1. Raw text       — Ticket.content, the customer message the agent edits
 *   2. Structured     — ClientFact, AI-extracted durable facts about the client
 *   3. Vector index   — Chunk, for RAG retrieval across a client's tickets
 *
 * Crucial pattern: every extracted fact carries its source ticket + quote.
 * That's what enables:
 *   - Idempotent re-analysis (drop old facts from that ticket, re-extract)
 *   - Citation in the UI ("ticket #1234 says...")
 */

import { Schema, model, Types, type InferSchemaType } from 'mongoose';

// ─── User (support agent) ─────────────────────────────────────────────────────
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: String,
    plan: { type: String, enum: ['free', 'team', 'pro'], default: 'free' },
    passwordHash: { type: String, select: false },
  },
  { timestamps: true },
);
export const User = model('User', userSchema);
export type UserDoc = InferSchemaType<typeof userSchema>;

// ─── Client ────────────────────────────────────────────────────────────────
// A client = a customer account. Holds the durable context the agent reuses
// across every ticket from that client.
const clientSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    company: String,
    contactEmail: String,
    notes: String, // free-form context the agent maintains by hand
  },
  { timestamps: true },
);
export const Client = model('Client', clientSchema);

// ─── Ticket ──────────────────────────────────────────────────────────────────
// One customer request. `content` is the raw message; the analysis pipeline
// fills `analysis` (summary, suggested reply, next steps) and `category`.
const ticketAnalysisSchema = new Schema(
  {
    summary: String,
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative', 'frustrated'],
    },
    suggestedReply: String, // ready-to-send draft answer for the agent
    nextSteps: { type: [String], default: [] },
    analyzedModel: String,
  },
  { _id: false },
);

const ticketSchema = new Schema(
  {
    clientId: { type: Types.ObjectId, ref: 'Client', required: true, index: true },
    /** Free-form reference number — the manual link to the external ticketing tool. */
    reference: String,
    subject: { type: String, required: true },
    content: { type: String, default: '' }, // the customer's message
    channel: {
      type: String,
      enum: ['email', 'phone', 'chat', 'other'],
      default: 'email',
    },
    status: {
      type: String,
      enum: ['new', 'in_progress', 'waiting', 'resolved', 'closed'],
      default: 'new',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    category: String, // free-form, filled by the AI (e.g. 'billing', 'bug', 'how-to')
    /**
     * Bumped on every content change. The analysis pipeline compares
     * `analysisVersion` against `lastAnalyzedVersion` to know if re-analysis is needed.
     */
    analysisVersion: { type: Number, default: 0 },
    lastAnalyzedVersion: { type: Number, default: -1 },
    lastAnalyzedAt: Date,
    analysis: { type: ticketAnalysisSchema, default: undefined },
  },
  { timestamps: true },
);
ticketSchema.index({ clientId: 1, createdAt: -1 });
export const Ticket = model('Ticket', ticketSchema);

// ─── ClientFact (the unified "client context") ───────────────────────────────
// One durable fact about a client, anchored to the ticket that revealed it.
// Replaces the original "bible" (characters/locations/objects/events/relations).
const clientFactSchema = new Schema(
  {
    clientId: { type: Types.ObjectId, ref: 'Client', required: true, index: true },
    category: {
      type: String,
      enum: ['account', 'product', 'environment', 'preference', 'history', 'contact'],
      required: true,
    },
    key: { type: String, required: true }, // e.g. 'plan', 'os', 'main_product'
    value: { type: String, required: true }, // e.g. 'Pro', 'Windows 11', 'VPO Cloud'
    sourceTicketId: { type: Types.ObjectId, ref: 'Ticket', required: true },
    sourceQuote: String, // verbatim excerpt
    confidence: { type: Number, min: 0, max: 1, default: 0.9 },
    factuality: {
      type: String,
      enum: ['stated', 'inferred'],
      default: 'stated',
    },
    extractedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
clientFactSchema.index({ clientId: 1, category: 1 });
export const ClientFact = model('ClientFact', clientFactSchema);

// ─── Chunk (text + vector for RAG) ───────────────────────────────────────────
// Atlas Vector Search index must be created on this collection separately;
// see scripts/createIndexes.ts.
const chunkSchema = new Schema(
  {
    clientId: { type: Types.ObjectId, ref: 'Client', required: true, index: true },
    ticketId: { type: Types.ObjectId, ref: 'Ticket', required: true, index: true },
    text: { type: String, required: true },
    span: { type: [Number], required: true }, // [startChar, endChar]
    embedding: { type: [Number], required: true },
    ticketVersion: Number, // == ticket.analysisVersion when this chunk was made
  },
  { timestamps: true },
);
export const Chunk = model('Chunk', chunkSchema);
