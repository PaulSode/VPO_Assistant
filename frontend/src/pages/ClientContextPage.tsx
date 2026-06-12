import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi, contextApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Topbar } from '../components/Layout';
import type { ClientFact, FactCategory } from '../lib/types';

const CATEGORY_LABELS: Record<FactCategory, string> = {
  account: 'Compte',
  product: 'Produit',
  environment: 'Environnement',
  preference: 'Préférences',
  history: 'Historique',
  contact: 'Contacts',
};

const CATEGORY_ORDER: FactCategory[] = [
  'account',
  'product',
  'environment',
  'contact',
  'preference',
  'history',
];

export function ClientContextPage() {
  const { clientId = '' } = useParams();
  const qc = useQueryClient();

  const clientQ = useQuery({
    queryKey: qk.client(clientId),
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });

  const factsQ = useQuery({
    queryKey: qk.facts(clientId),
    queryFn: () => contextApi.facts(clientId),
    enabled: !!clientId,
  });

  // ─── Editable agent notes ──────────────────────────────────────────────
  const [notes, setNotes] = useState('');
  const [savedTick, setSavedTick] = useState(false);
  useEffect(() => {
    if (clientQ.data) setNotes(clientQ.data.client.notes ?? '');
  }, [clientQ.data]);

  const saveNotes = useMutation({
    mutationFn: (value: string) => clientsApi.update(clientId, { notes: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.client(clientId) });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    },
  });

  const facts = factsQ.data?.facts ?? [];
  const byCategory = new Map<FactCategory, ClientFact[]>();
  for (const f of facts) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  const orderedCategories = CATEGORY_ORDER.filter((c) => byCategory.has(c));

  const client = clientQ.data?.client;

  return (
    <>
      <Topbar crumbs={[{ label: 'Contexte client' }]} />
      <div className="page-scroll">
        <div className="page">
          <h1 className="page-title">Contexte client</h1>
          <p className="page-subtitle">
            {client?.company ? `${client.name} · ${client.company}` : client?.name ?? '…'} —
            ce que l'on sait du client, alimenté automatiquement à chaque analyse de ticket.
          </p>

          {/* Agent notes */}
          <section className="ctx-notes">
            <div className="ctx-label">
              Notes de l'agent
              {savedTick && <span className="saved-tick">enregistré</span>}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (client?.notes ?? '')) saveNotes.mutate(notes);
              }}
              placeholder="Contexte libre : contrat, interlocuteur privilégié, historique commercial…"
              rows={3}
            />
          </section>

          {/* Extracted facts */}
          {factsQ.isLoading ? (
            <div className="loading">Chargement…</div>
          ) : facts.length === 0 ? (
            <div className="empty">
              Aucun fait extrait pour l'instant. Analysez un ticket de ce client pour
              enrichir automatiquement son contexte.
            </div>
          ) : (
            <div className="ctx-grid">
              {orderedCategories.map((cat) => (
                <div key={cat} className="ctx-card">
                  <div className="ctx-card-head">{CATEGORY_LABELS[cat]}</div>
                  <dl className="ctx-facts">
                    {byCategory.get(cat)!.map((f) => (
                      <div key={f._id} className="ctx-fact" title={f.sourceQuote ?? ''}>
                        <dt>{f.key}</dt>
                        <dd>
                          {f.value}
                          {f.factuality === 'inferred' && (
                            <span className="ctx-inferred">déduit</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .ctx-notes { margin-bottom: 28px; }
        .ctx-label {
          font-size: 11.5px; color: var(--text-3); margin-bottom: 7px;
          display: flex; align-items: center; gap: 8px;
        }
        .saved-tick { font-size: 10.5px; color: var(--success, #5aa86f); }
        .ctx-notes textarea {
          width: 100%; background: var(--bg-panel);
          border: 1px solid var(--border); border-radius: 8px;
          padding: 12px 14px; color: var(--text);
          font-family: inherit; font-size: 13.5px; line-height: 1.6;
          outline: none; resize: vertical;
          transition: border-color 120ms;
        }
        .ctx-notes textarea:focus { border-color: var(--border-strong); }

        .ctx-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 12px;
        }
        .ctx-card {
          background: var(--bg-panel); border: 1px solid var(--border);
          border-radius: 8px; padding: 14px 16px;
        }
        .ctx-card-head {
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--text-3); margin-bottom: 10px;
        }
        .ctx-facts { display: flex; flex-direction: column; gap: 8px; }
        .ctx-fact { display: flex; flex-direction: column; gap: 1px; }
        .ctx-fact dt { font-size: 11px; color: var(--text-3); }
        .ctx-fact dd {
          font-size: 13px; color: var(--text);
          display: flex; align-items: center; gap: 8px;
        }
        .ctx-inferred {
          font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.03em;
          color: var(--text-4); border: 1px solid var(--border);
          border-radius: 8px; padding: 0 5px;
        }
      `}</style>
    </>
  );
}
