import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ticketsApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { parseConversation, distinctAuthors } from '../lib/parseConversation';
import { formatRelative } from '../lib/tickets';
import type { AuthorRole } from '../lib/types';

interface Props {
  ticketId: string;
  clientId: string;
  onClose: () => void;
}

/**
 * Import an existing conversation by pasting its text or loading a text file.
 * The agent maps each detected author to a role before importing; original
 * timestamps are preserved.
 */
export function ImportConversationDialog({ ticketId, clientId, onClose }: Props) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState('');
  const [roles, setRoles] = useState<Record<string, AuthorRole>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseConversation(raw), [raw]);
  const authors = useMemo(() => distinctAuthors(parsed), [parsed]);

  // Default role mapping: first author = client (usually opens the ticket), rest = agent.
  useEffect(() => {
    setRoles((prev) => {
      const next: Record<string, AuthorRole> = {};
      authors.forEach((a, i) => {
        next[a] = prev[a] ?? (i === 0 ? 'customer' : 'agent');
      });
      return next;
    });
  }, [authors]);

  const importMut = useMutation({
    mutationFn: () =>
      ticketsApi.importMessages(
        ticketId,
        parsed.map((m) => ({
          authorName: m.authorName,
          authorRole: roles[m.authorName] ?? 'agent',
          body: m.body,
          at: m.at,
        })),
      ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.ticket(ticketId) }),
        qc.invalidateQueries({ queryKey: qk.tickets(clientId) }),
      ]);
      onClose();
    },
  });

  async function loadFile(file: File) {
    const text = await file.text();
    setRaw(text);
  }

  return (
    <div className="imp-backdrop" onClick={onClose}>
      <div className="imp" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="imp-head">
          <h2>Importer une conversation</h2>
          <button className="imp-x" onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <p className="imp-sub">
          Collez le texte d'une conversation existante (ou chargez un fichier texte). Les
          messages sont détectés automatiquement ; vérifiez les rôles avant d'importer.
        </p>

        <div className="imp-tools">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Charger un fichier (.txt)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,.csv,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
              e.target.value = '';
            }}
          />
          {raw && (
            <button className="btn" onClick={() => setRaw('')}>Effacer</button>
          )}
        </div>

        <textarea
          className="imp-textarea"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={'Collez ici la conversation…\n\nNom Prénom\n03/04/2026 14:19:41\nBonjour, …'}
          rows={6}
        />

        {parsed.length > 0 && (
          <>
            <div className="imp-section">
              <div className="imp-section-head">
                {parsed.length} message{parsed.length > 1 ? 's' : ''} · {authors.length} interlocuteur
                {authors.length > 1 ? 's' : ''}
              </div>
              <div className="imp-authors">
                {authors.map((a) => (
                  <div key={a} className="imp-author">
                    <span className="imp-author-name">{a}</span>
                    <div className="seg small">
                      <button
                        className={roles[a] === 'customer' ? 'active' : ''}
                        onClick={() => setRoles((r) => ({ ...r, [a]: 'customer' }))}
                      >
                        Client
                      </button>
                      <button
                        className={roles[a] === 'agent' ? 'active' : ''}
                        onClick={() => setRoles((r) => ({ ...r, [a]: 'agent' }))}
                      >
                        Agent
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="imp-preview">
              {parsed.map((m, i) => (
                <div key={i} className="imp-prev-msg">
                  <div className="imp-prev-head">
                    <span className={`role-dot ${roles[m.authorName] ?? 'agent'}`} />
                    <strong>{m.authorName}</strong>
                    {m.at && <span className="imp-prev-date">{formatRelative(m.at)}</span>}
                  </div>
                  <div className="imp-prev-body">{m.body.slice(0, 160)}{m.body.length > 160 ? '…' : ''}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {importMut.isError && (
          <div className="imp-error">Échec de l'import : {(importMut.error as Error).message}</div>
        )}

        <div className="imp-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn primary"
            onClick={() => importMut.mutate()}
            disabled={parsed.length === 0 || importMut.isPending}
          >
            {importMut.isPending ? 'Import…' : `Importer ${parsed.length || ''} message${parsed.length > 1 ? 's' : ''}`}
          </button>
        </div>

        <ImportStyles />
      </div>
    </div>
  );
}

function ImportStyles() {
  return (
    <style>{`
      .imp-backdrop {
        position: fixed; inset: 0; background: rgba(20, 22, 28, 0.35);
        display: flex; align-items: center; justify-content: center;
        z-index: 100; padding: 24px;
      }
      .imp {
        background: var(--bg-panel); border: 1px solid var(--border-strong);
        border-radius: 10px; padding: 20px 22px 18px;
        max-width: 640px; width: 100%; max-height: 86vh; overflow-y: auto;
        box-shadow: 0 8px 24px rgba(20, 22, 28, 0.14);
      }
      .imp-head { display: flex; align-items: center; justify-content: space-between; }
      .imp-head h2 { font-size: 16px; font-weight: 600; color: var(--text); }
      .imp-x {
        background: none; border: none; color: var(--text-3); font-size: 22px;
        line-height: 1; cursor: pointer; padding: 0 4px;
      }
      .imp-x:hover { color: var(--text); }
      .imp-sub { font-size: 12.5px; color: var(--text-3); line-height: 1.55; margin: 6px 0 14px; }
      .imp-tools { display: flex; gap: 8px; margin-bottom: 10px; }
      .imp-textarea {
        width: 100%; background: var(--bg); border: 1px solid var(--border);
        border-radius: 8px; padding: 11px 13px; color: var(--text);
        font-family: var(--font-mono); font-size: 12px; line-height: 1.55;
        outline: none; resize: vertical;
      }
      .imp-textarea:focus { border-color: var(--border-strong); }

      .imp-section { margin-top: 16px; }
      .imp-section-head { font-size: 11.5px; color: var(--text-3); margin-bottom: 8px; }
      .imp-authors { display: flex; flex-direction: column; gap: 6px; }
      .imp-author {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px;
        background: var(--bg);
      }
      .imp-author-name { font-size: 13px; color: var(--text); font-weight: 500; }
      .seg.small button { padding: 3px 11px; font-size: 11.5px; }

      .imp-preview {
        margin-top: 14px; border: 1px solid var(--border); border-radius: 8px;
        max-height: 240px; overflow-y: auto; background: var(--bg);
      }
      .imp-prev-msg { padding: 9px 12px; border-bottom: 1px solid var(--border); }
      .imp-prev-msg:last-child { border-bottom: none; }
      .imp-prev-head { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; font-size: 12.5px; color: var(--text); }
      .role-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-4); flex-shrink: 0; }
      .role-dot.customer { background: var(--text-3); }
      .role-dot.agent { background: var(--accent); }
      .imp-prev-date { color: var(--text-3); font-size: 11px; margin-left: auto; }
      .imp-prev-body { font-size: 12px; color: var(--text-2); line-height: 1.5; white-space: pre-wrap; }

      .imp-error { margin-top: 12px; font-size: 12px; color: var(--danger); }
      .imp-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `}</style>
  );
}
