import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Topbar } from '../components/Layout';
import { StatusBadge, PriorityBadge } from '../components/Badge';
import { formatRelative, isOpen } from '../lib/tickets';
import { IconPlus } from '../components/icons';
import type { Ticket } from '../lib/types';

type Filter = 'all' | 'open' | 'resolved' | 'closed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'open', label: 'Ouverts' },
  { key: 'resolved', label: 'Résolus' },
  { key: 'closed', label: 'Clos' },
];

export function TicketsListPage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const ticketsQ = useQuery({
    queryKey: qk.tickets(clientId),
    queryFn: () => ticketsApi.listForClient(clientId),
    enabled: !!clientId,
  });

  const createTicket = useMutation({
    mutationFn: () => ticketsApi.create({ clientId, subject: 'Nouveau ticket', content: '' }),
    onSuccess: async ({ ticket }) => {
      await qc.invalidateQueries({ queryKey: qk.tickets(clientId) });
      navigate(`/clients/${clientId}/tickets/${ticket._id}`);
    },
  });

  const all = ticketsQ.data?.tickets ?? [];
  const tickets = all.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'open') return isOpen(t.status);
    return t.status === filter;
  });

  return (
    <>
      <Topbar crumbs={[{ label: 'Tickets' }]}>
        <button className="btn primary small" onClick={() => createTicket.mutate()} disabled={createTicket.isPending}>
          <IconPlus size={12} />
          {createTicket.isPending ? 'Création…' : 'Nouveau ticket'}
        </button>
      </Topbar>

      <div className="page-scroll">
        <div className="page">
          <h1 className="page-title">Tickets</h1>
          <p className="page-subtitle">{all.length} ticket{all.length > 1 ? 's' : ''} au total</p>

          <div className="toolbar">
            <div className="seg">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={filter === f.key ? 'active' : ''}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {ticketsQ.isLoading ? (
            <div className="loading">Chargement…</div>
          ) : tickets.length === 0 ? (
            <div className="empty">
              {all.length === 0
                ? "Aucun ticket pour ce client. Créez-en un pour lancer l'analyse."
                : 'Aucun ticket pour ce filtre.'}
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Statut</th>
                  <th>Sujet</th>
                  <th style={{ width: 110 }}>Priorité</th>
                  <th style={{ width: 130 }}>Catégorie</th>
                  <th style={{ width: 110 }}>Réf.</th>
                  <th style={{ width: 120 }}>Mis à jour</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t: Ticket) => (
                  <tr
                    key={t._id}
                    className="clickable"
                    onClick={() => navigate(`/clients/${clientId}/tickets/${t._id}`)}
                  >
                    <td><StatusBadge status={t.status} /></td>
                    <td className="cell-subject">{t.subject}</td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td className="cell-muted">{t.category ?? '—'}</td>
                    <td className="cell-mono">{t.reference || '—'}</td>
                    <td className="cell-muted">{formatRelative(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
