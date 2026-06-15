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

export type AuthorRole = 'customer' | 'agent';

export interface Attachment {
  filename: string;
  storedName: string;
  mime?: string;
  size?: number;
  url: string;
}

export interface TicketMessage {
  _id: ID;
  authorName: string;
  authorRole: AuthorRole;
  body: string;
  attachments: Attachment[];
  at: string;
}

export interface Ticket {
  _id: ID;
  clientId: ID;
  reference?: string;
  subject: string;
  messages: TicketMessage[];
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

export type KnowledgeScope = 'global' | 'client';

export interface KnowledgeDoc {
  _id: ID;
  userId: ID;
  scope: KnowledgeScope;
  clientId?: ID | null;
  title: string;
  content?: string;
  source: 'text' | 'file';
  file?: Attachment;
  createdAt: string;
  updatedAt: string;
}

export interface RagHit {
  chunkId: ID;
  ticketId: ID;
  ticketSubject: string;
  text: string;
  span: [number, number];
  score: number;
}
