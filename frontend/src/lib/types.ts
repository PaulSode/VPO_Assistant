/**
 * Domain types — mirror the shapes the backend returns.
 */

export type ID = string;

export interface Client {
  _id: ID;
  userId: ID;
  name: string;
  company?: string;
  contactEmail?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatus = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketChannel = 'email' | 'phone' | 'chat' | 'other';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'frustrated';

export interface TicketAnalysis {
  summary?: string;
  sentiment?: Sentiment;
  suggestedReply?: string;
  nextSteps?: string[];
  analyzedModel?: string;
}

export interface Ticket {
  _id: ID;
  clientId: ID;
  reference?: string;
  subject: string;
  content: string;
  channel: TicketChannel;
  status: TicketStatus;
  priority: TicketPriority;
  category?: string;
  analysisVersion: number;
  lastAnalyzedVersion: number;
  lastAnalyzedAt?: string;
  analysis?: TicketAnalysis;
  createdAt: string;
  updatedAt: string;
}

export type FactCategory =
  | 'account'
  | 'product'
  | 'environment'
  | 'preference'
  | 'history'
  | 'contact';

export interface ClientFact {
  _id: ID;
  clientId: ID;
  category: FactCategory;
  key: string;
  value: string;
  sourceTicketId: ID;
  sourceQuote?: string;
  confidence: number;
  factuality: 'stated' | 'inferred';
  extractedAt?: string;
}

export interface RagHit {
  chunkId: ID;
  ticketId: ID;
  ticketSubject: string;
  text: string;
  span: [number, number];
  score: number;
}
