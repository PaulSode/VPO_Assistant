import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Client } from '../lib/types';
import { IconUsers, IconPlus, IconArrow, IconTrash, IconBook } from '../components/icons';

export function ClientsListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');

  const clientsQ = useQuery({
    queryKey: qk.clients(),
    queryFn: () => clientsApi.list(),
  });

  const create = useMutation({
    mutationFn: (data: { name: string; company?: string }) =>
      clientsApi.create(data),
    onSuccess: ({ client }) => {
      qc.invalidateQueries({ queryKey: qk.clients() });
      navigate(`/clients/${client._id}/tickets`);
    },
  });

  const handleCreate = () => {
    if (!name.trim()) return;
    create.mutate({ name: name.trim(), company: company.trim() || undefined });
  };

  // ─── Delete client ───────────────────────────────────────────────────────
  const [toDelete, setToDelete] = useState<Client | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => {
      setToDelete(null);
      qc.invalidateQueries({ queryKey: qk.clients() });
    },
  });

  return (
    <div className="standalone">
      <div className="hero">
        <div className="brand-row">
          <span className="brand-mark" />
          <span className="brand-text">VPO Assistant</span>
        </div>
        <h1>Vos clients</h1>
        <p className="hero-sub">
          Le copilote support qui garde le contexte de chaque client. Ouvrez un compte
          ou créez-en un.
        </p>
        <Link to="/knowledge" className="hero-link">
          <IconBook size={13} />
          Base de connaissances
        </Link>
      </div>

      <section className="projects">
        {clientsQ.isLoading && <div className="loading">Chargement…</div>}
        {clientsQ.data?.clients.length === 0 && !creating && (
          <div className="empty">
            <p style={{ marginBottom: 14 }}>Aucun client. Ajoutez le premier.</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <IconPlus size={12} /> Nouveau client
            </button>
          </div>
        )}

        <ul className="proj-list">
          {clientsQ.data?.clients.map((c) => (
            <li key={c._id} className="proj-li">
              <Link to={`/clients/${c._id}/tickets`} className="proj">
                <span className="proj-ico">
                  <IconUsers size={16} />
                </span>
                <span className="proj-body">
                  <span className="proj-title">{c.name}</span>
                  {c.company && <span className="proj-desc">{c.company}</span>}
                  <span className="proj-meta">
                    {c.contactEmail ?? 'Sans contact'} · maj {formatDate(c.updatedAt)}
                  </span>
                </span>
                <span className="proj-arrow">
                  <IconArrow size={14} />
                </span>
              </Link>
              <button
                className="proj-del"
                title="Supprimer ce client"
                aria-label={`Supprimer ${c.name}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setToDelete(c);
                }}
              >
                <IconTrash size={13} />
              </button>
            </li>
          ))}
        </ul>

        {creating ? (
          <div className="create-card">
            <label className="create-label" htmlFor="new-name">
              Nom du client
            </label>
            <input
              id="new-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. Marie Dupont"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <label className="create-label" htmlFor="new-company" style={{ marginTop: 10 }}>
              Société (optionnel)
            </label>
            <input
              id="new-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="ex. Acme SAS"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <div className="create-actions">
              <button
                className="btn"
                onClick={() => {
                  setCreating(false);
                  setName('');
                  setCompany('');
                }}
              >
                Annuler
              </button>
              <button
                className="btn primary"
                onClick={handleCreate}
                disabled={!name.trim() || create.isPending}
              >
                {create.isPending ? 'Création…' : 'Créer'}
              </button>
            </div>
            {create.isError && (
              <div className="create-error">
                Échec : {(create.error as Error).message}
              </div>
            )}
          </div>
        ) : (
          clientsQ.data?.clients.length !== 0 && (
            <button className="add-row" onClick={() => setCreating(true)}>
              <IconPlus size={12} /> Nouveau client
            </button>
          )
        )}
      </section>

      <ConfirmDialog
        open={!!toDelete}
        title="Supprimer ce client ?"
        message={
          <>
            Vous êtes sur le point de supprimer <em>{toDelete?.name}</em>. Tous ses
            tickets, le contexte client extrait et l'index de recherche seront
            définitivement effacés. Cette action est irréversible.
          </>
        }
        confirmLabel="Supprimer le client"
        destructive
        busy={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete._id)}
        onCancel={() => setToDelete(null)}
      />

      <style>{`
        .standalone {
          height: 100vh; overflow-y: auto;
          background: var(--bg);
          display: flex; flex-direction: column; align-items: center;
          padding: 80px 24px 60px;
        }
        .hero { max-width: 580px; width: 100%; margin-bottom: 36px; }
        .brand-row {
          display: flex; align-items: center; gap: 9px;
          margin-bottom: 32px; color: var(--text-2); font-size: 13px;
        }
        .brand-text { font-weight: 500; color: var(--text); letter-spacing: -0.005em; }
        .hero h1 {
          font-size: 26px; font-weight: 500;
          letter-spacing: -0.012em; margin-bottom: 8px;
        }
        .hero-sub { color: var(--text-3); font-size: 13.5px; line-height: 1.55; }
        .hero-link {
          display: inline-flex; align-items: center; gap: 6px;
          margin-top: 14px; font-size: 12.5px; color: var(--text-2);
          border: 1px solid var(--border); border-radius: 6px; padding: 5px 10px;
          transition: border-color 100ms, color 100ms;
        }
        .hero-link:hover { border-color: var(--border-strong); color: var(--text); }

        .projects { max-width: 580px; width: 100%; }
        .proj-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
        .proj-li { position: relative; }
        .proj {
          display: flex; align-items: center; gap: 14px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          padding: 12px 14px; border-radius: 6px;
          transition: border-color 100ms, background 100ms;
        }
        .proj:hover { border-color: var(--border-strong); background: var(--bg-hover); }
        .proj-del {
          position: absolute; top: 50%; right: 44px;
          transform: translateY(-50%);
          display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px;
          background: none; border: 1px solid transparent;
          border-radius: 5px; color: var(--text-3);
          cursor: pointer; opacity: 0;
          transition: opacity 100ms, color 100ms, background 100ms, border-color 100ms;
        }
        .proj-li:hover .proj-del { opacity: 1; }
        .proj-del:hover { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-strong); }
        .proj-del:focus-visible { opacity: 1; outline: none; color: var(--danger); border-color: var(--danger-strong); }
        .proj-ico {
          width: 30px; height: 30px; flex-shrink: 0;
          border-radius: 5px; background: var(--bg-elevated);
          display: flex; align-items: center; justify-content: center;
          color: var(--text-2);
        }
        .proj-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .proj-title { color: var(--text); font-size: 13.5px; font-weight: 500; }
        .proj-desc {
          color: var(--text-2); font-size: 12.5px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .proj-meta { color: var(--text-3); font-size: 11.5px; }
        .proj-arrow { color: var(--text-3); }
        .proj:hover .proj-arrow { color: var(--text-2); }

        .add-row {
          margin-top: 12px;
          display: flex; align-items: center; gap: 6px;
          background: none; border: 1px dashed var(--border);
          color: var(--text-3);
          padding: 11px 14px; border-radius: 6px;
          font-size: 12.5px; font-family: inherit;
          cursor: pointer; width: 100%;
          justify-content: center;
          transition: all 100ms;
        }
        .add-row:hover { border-color: var(--border-strong); color: var(--text-2); }

        .create-card {
          margin-top: 12px;
          background: var(--bg-panel);
          border: 1px solid var(--border-strong);
          padding: 16px; border-radius: 6px;
        }
        .create-label {
          display: block; font-size: 11.5px;
          color: var(--text-3); margin-bottom: 6px;
        }
        .create-card input {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 6px 10px;
          border-radius: 5px; font-family: inherit;
          font-size: 13px; outline: none;
          transition: border-color 120ms;
        }
        .create-card input:focus { border-color: var(--border-strong); }
        .create-actions {
          display: flex; gap: 8px; justify-content: flex-end;
          margin-top: 12px;
        }
        .create-error {
          margin-top: 10px; color: var(--danger); font-size: 12px;
        }
      `}</style>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
