/**
 * Shared ticket vocabulary + small presentational helpers used across the
 * dashboard, the tickets table, the sidebar, and the detail panel.
 */

import type { TicketStatus, TicketPriority, TicketChannel } from './types';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Nouveau',
  in_progress: 'En cours',
  waiting: 'En attente',
  resolved: 'Résolu',
  closed: 'Clos',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Basse',
  medium: 'Moyenne',
  high: 'Haute',
  urgent: 'Urgente',
};

export const CHANNEL_LABELS: Record<TicketChannel, string> = {
  email: 'E-mail',
  phone: 'Téléphone',
  chat: 'Chat',
  other: 'Autre',
};

/** Statuses considered "open" (counts in the dashboard / nav badge). */
export const OPEN_STATUSES: TicketStatus[] = ['new', 'in_progress', 'waiting'];

export function isOpen(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`;
  if (diff < 7 * 86400) return `il y a ${Math.round(diff / 86400)} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
