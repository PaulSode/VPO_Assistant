/**
 * Query key factory for TanStack Query.
 *
 * Keeping keys in one place makes invalidation predictable: after a ticket
 * analysis we invalidate ['facts', clientId] and the ticket itself, and any
 * view consuming them refreshes automatically.
 */

export const qk = {
  me: () => ['me'] as const,
  clients: () => ['clients'] as const,
  client: (id: string) => ['client', id] as const,
  tickets: (clientId: string) => ['tickets', clientId] as const,
  ticket: (id: string) => ['ticket', id] as const,
  facts: (clientId: string) => ['facts', clientId] as const,
  factsForTicket: (ticketId: string) => ['facts', 'ticket', ticketId] as const,
  search: (clientId: string, query: string) => ['search', clientId, query] as const,
  knowledgeGlobal: () => ['knowledge', 'global'] as const,
  knowledgeClient: (clientId: string) => ['knowledge', 'client', clientId] as const,
};
