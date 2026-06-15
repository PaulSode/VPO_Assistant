import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi, ticketsApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Topbar } from '../components/Layout';
import { StatusBadge, PriorityBadge } from '../components/Badge';
import { formatRelative } from '../lib/tickets';
import { IconPlus } from '../components/icons';
import type { Ticket, TicketStatus } from '../lib/types';

export function DashboardPage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const clientQ = useQuery({
    queryKey: qk.client(clientId),
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });

  const ticketsQ = useQuery({
    queryKey: qk.tickets(clientId),
    queryFn: () => ticketsApi.listForClient(clientId),
    enabled: !!clientId,
  });

  const createTicket = useMutation({
    mutationFn: () => ticketsApi.create({ clientId, subject: 'Nouveau ticket' }),
    onSuccess: async ({ ticket }) => {
      await qc.invalidateQueries({ queryKey: qk.tickets(clientId) });
      navigate(`/clients/${clientId}/tickets/${ticket._id}`);
    },
  });

  const tickets = ticketsQ.data?.tickets ?? [];
  const count = (s: TicketStatus) => tickets.filter((t) => t.status === s).length;
  const recent = [...tickets]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 6);

  return (
    <>
      <Topbar crumbs={[{ label: 'Tableau de bord' }]}>
        <button className="btn primary small" onClick={() => createTicket.mutate()} disabled={createTicket.isPending}>
          <IconPlus size={12} />
          {createTicket.isPending ? 'Création…' : 'Nouveau ticket'}
        </button>
      </Topbar>

      <div className="page-scroll">
        <div className="page">
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-subtitle">{clientQ.data?.client.name ?? '…'}</p>

          <div className="stat-strip">
            <Stat num={count('new')} label="Nouveaux" />
            <Stat num={count('in_progress')} label="En cours" />
            <Stat num={count('waiting')} label="En attente" />
            <Stat num={count('resolved')} label="Résolus" />
            <Stat num={tickets.length} label="Total" />
          </div>

          <div className="section-row">
            <div className="section-label" style={{ margin: '28px 0 10px' }}>
              Tickets récents
            </div>
            <Link to={`/clients/${clientId}/tickets`} className="see-all">
              Voir tous les tickets →
            </Link>
          </div>

          {ticketsQ.isLoading ? (
            <div className="loading">Chargement…</div>
          ) : recent.length === 0 ? (
            <div className="empty">
              Aucun ticket pour ce client. Créez-en un pour lancer l'analyse.
            </div>
          ) : (
            <RecentTable tickets={recent} clientId={clientId} navigate={navigate} />
          )}
        </div>
      </div>

      <style>{`
        .section-row { display: flex; align-items: baseline; justify-content: space-between; }
        .see-all { font-size: 12.5px; color: var(--text-3); }
        .see-all:hover { color: var(--accent); }
      `}</style>
    </>
  );
}

function Stat({ num, label }: { num: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-num">{num}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function RecentTable({
  tickets,
  clientId,
  navigate,
}: {
  tickets: Ticket[];
  clientId: string;
  navigate: (to: string) => void;
}) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 120 }}>Statut</th>
          <th>Sujet</th>
          <th style={{ width: 110 }}>Priorité</th>
          <th style={{ width: 130 }}>Mis à jour</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((t) => (
          <tr
            key={t._id}
            className="clickable"
            onClick={() => navigate(`/clients/${clientId}/tickets/${t._id}`)}
          >
            <td><StatusBadge status={t.status} /></td>
            <td className="cell-subject">{t.subject}</td>
            <td><PriorityBadge priority={t.priority} /></td>
            <td className="cell-muted">{formatRelative(t.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
