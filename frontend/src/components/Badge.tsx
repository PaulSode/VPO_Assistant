import type { TicketStatus, TicketPriority } from '../lib/types';
import { STATUS_LABELS, PRIORITY_LABELS } from '../lib/tickets';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`badge s-${status}`}>
      <span className="badge-dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={`badge p-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}
