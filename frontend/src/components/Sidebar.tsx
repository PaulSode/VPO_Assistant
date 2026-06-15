import { Link, NavLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clientsApi, ticketsApi, meApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { isOpen } from '../lib/tickets';
import {
  IconGrid,
  IconFile,
  IconBook,
  IconUsers,
  IconChat,
  IconChevron,
  IconSearch,
  IconSettings,
} from './icons';

/**
 * Navigation rail. Holds only navigation — the ticket list lives on its own
 * full-width table page (see TicketsListPage), not buried in here.
 */
export function Sidebar() {
  const { clientId = '' } = useParams();

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

  const meQ = useQuery({
    queryKey: qk.me(),
    queryFn: () => meApi.get(),
    staleTime: 5 * 60_000,
  });

  const client = clientQ.data?.client;
  const openCount = (ticketsQ.data?.tickets ?? []).filter((t) => isOpen(t.status)).length;

  const me = meQ.data?.user;
  const displayName = me?.name || me?.email || 'Agent';
  const planLabel = { free: 'Plan gratuit', team: 'Plan équipe', pro: 'Plan pro' }[
    me?.plan ?? 'free'
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link to="/" className="brand">
          <span className="brand-mark" />
          VPO Assistant
        </Link>
      </div>

      <div className="client-card">
        <div className="client-name">{client ? client.name : '…'}</div>
        {client?.company && <div className="client-company">{client.company}</div>}
        <Link to="/" className="client-switch">
          <IconChevron size={11} />
          Changer de client
        </Link>
      </div>

      <nav className="nav">
        <SideLink to={`/clients/${clientId}`} end icon={<IconGrid size={15} />}>
          Tableau de bord
        </SideLink>
        <SideLink
          to={`/clients/${clientId}/tickets`}
          icon={<IconFile size={15} />}
          count={openCount > 0 ? openCount : undefined}
        >
          Tickets
        </SideLink>
        <SideLink to={`/clients/${clientId}/context`} icon={<IconUsers size={15} />}>
          Contexte client
        </SideLink>
        <SideLink to={`/clients/${clientId}/documents`} icon={<IconBook size={15} />}>
          Documents
        </SideLink>
        <SideLink to={`/clients/${clientId}/search`} icon={<IconSearch size={15} />}>
          Recherche
        </SideLink>
        <SideLink to={`/clients/${clientId}/assistant`} icon={<IconChat size={15} />}>
          Assistant
        </SideLink>
      </nav>

      <div style={{ flex: 1 }} />

      <div className="sidebar-foot">
        <div className="avatar">{userInitials(displayName)}</div>
        <div className="user-info">
          <div className="uname">{displayName}</div>
          <div className="uplan">{planLabel}</div>
        </div>
        <button className="icon-btn" aria-label="Paramètres">
          <IconSettings size={14} />
        </button>
      </div>

      <SidebarStyles />
    </aside>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SideLinkProps {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
  end?: boolean;
}

function SideLink({ to, icon, children, count, end }: SideLinkProps) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      {icon}
      {children}
      {count !== undefined && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

function userInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function SidebarStyles() {
  return (
    <style>{`
      .client-card {
        margin: 4px 12px 10px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg);
      }
      .client-name { font-size: 13px; font-weight: 600; color: var(--text); }
      .client-company { font-size: 11.5px; color: var(--text-3); margin-top: 1px; }
      .client-switch {
        display: inline-flex; align-items: center; gap: 4px;
        margin-top: 8px; font-size: 11px; color: var(--text-3);
      }
      .client-switch:hover { color: var(--text-2); }
      .client-switch svg { transform: rotate(90deg); }
      .nav { padding: 2px 8px; display: flex; flex-direction: column; gap: 1px; }
    `}</style>
  );
}
