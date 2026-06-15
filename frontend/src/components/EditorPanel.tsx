import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, contextApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import type { Ticket, TicketStatus, TicketPriority, Sentiment } from '../lib/types';
import { STATUS_LABELS, PRIORITY_LABELS } from '../lib/tickets';
import { IconSparkle, IconCheck, IconChat } from './icons';
import { Link } from 'react-router-dom';

interface EditorPanelProps {
  ticket: Ticket;
  /** True while a user-triggered analysis is in flight. */
  analyzing: boolean;
  /** Index of the analysis phase currently running (-1 = none). */
  analysisStep: number;
  /** True when there are saved/local changes not yet analyzed. */
  hasUnanalyzed: boolean;
  analyzeError: string | null;
  onAnalyze: () => void;
}

/** Phases mirror the backend pipeline (ANALYSIS_STEPS), in order. */
const ANALYSIS_STEP_LABELS: { key: string; label: string }[] = [
  { key: 'preparing', label: 'Préparation du contexte' },
  { key: 'analyzing', label: 'Analyse du ticket' },
  { key: 'context', label: 'Mise à jour du contexte client' },
  { key: 'indexing', label: 'Indexation (recherche)' },
  { key: 'finalizing', label: 'Finalisation' },
];

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: 'positif',
  neutral: 'neutre',
  negative: 'négatif',
  frustrated: 'frustré',
};

export function EditorPanel({
  ticket,
  analyzing,
  analysisStep,
  hasUnanalyzed,
  analyzeError,
  onAnalyze,
}: EditorPanelProps) {
  const ticketId = ticket._id;
  const clientId = ticket.clientId;
  const qc = useQueryClient();

  const factsQ = useQuery({
    queryKey: qk.factsForTicket(ticketId),
    queryFn: () => contextApi.factsForTicket(ticketId),
    enabled: !!ticketId,
  });

  const updateStatus = useMutation({
    mutationFn: (status: TicketStatus) => ticketsApi.updateMeta(ticketId, { status }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.ticket(ticketId) }),
        qc.invalidateQueries({ queryKey: qk.tickets(clientId) }),
      ]);
    },
  });

  const updatePriority = useMutation({
    mutationFn: (priority: TicketPriority) => ticketsApi.updateMeta(ticketId, { priority }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.ticket(ticketId) }),
        qc.invalidateQueries({ queryKey: qk.tickets(clientId) }),
      ]);
    },
  });

  const analysis = ticket.analysis;
  const facts = factsQ.data?.facts ?? [];

  const analysisDisplay = (() => {
    if (analyzing) return 'analyse en cours…';
    if (ticket.messages.length === 0) return '—';
    if (hasUnanalyzed) return 'modifications non analysées';
    if (ticket.lastAnalyzedAt) return `à jour · ${formatRelative(ticket.lastAnalyzedAt)}`;
    return 'jamais analysé';
  })();

  return (
    <aside className="panel">
      <div className="panel-tabs">
        <button className="ptab active">Analyse &amp; suivi</button>
      </div>

      <div className="panel-body">
        {/* ─── Tracking ─────────────────────────────────────────────── */}
        <div className="psection">
          <div className="psection-label">Suivi</div>
          <div className="meta-row">
            <span className="k">Statut</span>
            <select
              className="meta-select"
              value={ticket.status}
              onChange={(e) => updateStatus.mutate(e.target.value as TicketStatus)}
              disabled={updateStatus.isPending}
            >
              {(Object.keys(STATUS_LABELS) as TicketStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="meta-row">
            <span className="k">Priorité</span>
            <select
              className="meta-select"
              value={ticket.priority}
              onChange={(e) => updatePriority.mutate(e.target.value as TicketPriority)}
              disabled={updatePriority.isPending}
            >
              {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          {ticket.category && (
            <div className="meta-row">
              <span className="k">Catégorie</span>
              <span className="v"><span className="chip">{ticket.category}</span></span>
            </div>
          )}
          {ticket.reference && (
            <div className="meta-row">
              <span className="k">Réf.</span>
              <span className="v">{ticket.reference}</span>
            </div>
          )}
          <div className="meta-row">
            <span className="k">Analyse</span>
            <span className="v">
              {analyzing && <span className="analysis-pulse" />}
              {analysisDisplay}
            </span>
          </div>

          {analyzing ? (
            <AnalysisStepper currentStep={analysisStep} />
          ) : (
            <>
              <button
                className={`analyze-btn${hasUnanalyzed ? ' primary' : ''}`}
                onClick={onAnalyze}
                disabled={ticket.messages.length === 0 || !hasUnanalyzed}
              >
                <IconSparkle size={13} />
                {hasUnanalyzed ? 'Analyser le ticket' : 'Ticket à jour'}
              </button>
              {analyzeError && <div className="analyze-error">{analyzeError}</div>}
              <div className="analyze-hint">
                L'analyse (classement, réponse suggérée, contexte client) consomme des
                crédits IA. Elle ne se lance qu'à la demande.
              </div>
            </>
          )}
        </div>

        {/* ─── Analysis output ──────────────────────────────────────── */}
        {analysis ? (
          <>
            {analysis.summary && (
              <div className="psection">
                <div className="psection-label">Résumé</div>
                <div className="note">{analysis.summary}</div>
                {analysis.sentiment && (
                  <div className="meta-row" style={{ marginTop: 4 }}>
                    <span className="k">Ton client</span>
                    <span className="v">
                      <span className={`chip senti ${analysis.sentiment}`}>
                        {SENTIMENT_LABELS[analysis.sentiment]}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {facts.length > 0 && (
              <div className="psection">
                <div className="psection-label">
                  Contexte client ajouté <span className="count">{facts.length}</span>
                </div>
                {facts.map((f) => (
                  <div key={f._id} className="fact-row">
                    <span className="fact-cat">{f.category}</span>
                    <span className="fact-kv">
                      <strong>{f.key}</strong> : {f.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="psection">
            <div className="note" style={{ color: 'var(--text-3)' }}>
              Collez le message du client puis lancez l'analyse : l'IA proposera un
              classement, une réponse prête à envoyer et des étapes de résolution.
            </div>
            <Link to={`/clients/${clientId}/assistant`} className="lead-cta" style={{ marginTop: 12 }}>
              <IconChat size={13} />
              Ouvrir l'assistant
            </Link>
          </div>
        )}
      </div>

      <div className="panel-foot">
        <span className="pulse" />
        Contexte client enrichi à chaque analyse
      </div>

      <PanelStyles />
    </aside>
  );
}

// ─── Analysis stepper ────────────────────────────────────────────────────────

function AnalysisStepper({ currentStep }: { currentStep: number }) {
  const active = Math.max(0, currentStep);
  return (
    <div className="stepper">
      <div className="stepper-head">
        <span className="analysis-pulse" />
        Analyse en cours…
      </div>
      <ol className="stepper-list">
        {ANALYSIS_STEP_LABELS.map((s, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'pending';
          return (
            <li key={s.key} className={`stepper-item ${state}`}>
              <span className="stepper-marker">
                {state === 'done' ? <IconCheck size={11} /> : <span className="stepper-dot" />}
              </span>
              <span className="stepper-label">{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `il y a ${Math.round(diff)}s`;
  if (diff < 3600) return `il y a ${Math.round(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)}h`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function PanelStyles() {
  return (
    <style>{`
      .panel {
        background: var(--bg-panel);
        border-left: 1px solid var(--border);
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      .panel-tabs {
        height: 42px;
        border-bottom: 1px solid var(--border);
        display: flex; align-items: center;
        padding: 0 16px; gap: 18px;
        flex-shrink: 0;
      }
      .ptab {
        font-size: 12.5px; color: var(--text-3);
        cursor: pointer; padding: 13px 0;
        background: none; border: none;
        border-bottom: 1.5px solid transparent;
        margin-bottom: -1px; user-select: none;
        font-family: inherit;
        display: flex; align-items: center; gap: 5px;
        transition: color 100ms;
      }
      .ptab.active { color: var(--text); border-bottom-color: var(--text); }

      .panel-body { flex: 1; overflow-y: auto; padding: 14px 14px 24px; min-height: 0; }
      .psection { margin-bottom: 22px; }
      .psection:last-child { margin-bottom: 0; }
      .psection-label {
        font-size: 11px; color: var(--text-3); font-weight: 500;
        letter-spacing: 0.015em; padding: 0 4px 6px;
        display: flex; align-items: center; justify-content: space-between;
      }
      .psection-label .count { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-4); }

      .copy-btn {
        display: inline-flex; align-items: center; gap: 4px;
        background: none; border: 1px solid var(--border);
        color: var(--text-2); font-family: inherit; font-size: 10.5px;
        padding: 2px 7px; border-radius: 4px; cursor: pointer;
        transition: all 100ms;
      }
      .copy-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }

      .meta-row {
        display: flex; align-items: baseline; gap: 10px;
        padding: 5px 6px; font-size: 12.5px;
        border-radius: 5px;
      }
      .meta-row .k { color: var(--text-3); font-size: 11.5px; width: 72px; flex-shrink: 0; }
      .meta-row .v {
        color: var(--text); flex: 1;
        display: inline-flex; align-items: center; gap: 6px;
      }

      .chip {
        display: inline-flex; align-items: center;
        font-size: 11px; padding: 1px 8px; border-radius: 10px;
        background: var(--bg-elevated); border: 1px solid var(--border);
        color: var(--text-2);
      }
      .chip.senti.negative, .chip.senti.frustrated { color: var(--danger, #d96a6a); border-color: var(--danger-strong, #5a3a3a); }
      .chip.senti.positive { color: var(--success, #5aa86f); }

      .meta-select {
        background: transparent;
        border: 1px solid transparent;
        color: var(--text);
        font-family: inherit; font-size: 12.5px;
        padding: 1px 6px; margin-left: -6px;
        border-radius: 4px; cursor: pointer; outline: none;
        transition: background 80ms, border-color 80ms;
      }
      .meta-select:hover { background: var(--bg-hover); border-color: var(--border); }
      .meta-select:focus { background: var(--bg-hover); border-color: var(--border-strong); }
      .meta-select option { background: var(--bg-elevated); color: var(--text); }
      .meta-select[disabled] { opacity: 0.5; cursor: wait; }

      .analysis-pulse {
        width: 5px; height: 5px; border-radius: 50%;
        background: var(--warning); animation: pulse 1.4s ease-in-out infinite;
        flex-shrink: 0;
      }
      @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

      .note {
        font-size: 12.5px; color: var(--text-2);
        line-height: 1.55; padding: 7px 8px; border-radius: 5px;
      }

      .reply-box {
        font-size: 12.5px; color: var(--text);
        line-height: 1.6; padding: 11px 12px;
        background: var(--bg-editor); border: 1px solid var(--border);
        border-radius: 6px; white-space: pre-wrap;
      }

      .steps { list-style: none; display: flex; flex-direction: column; gap: 6px; padding: 0 4px; }
      .steps li {
        font-size: 12.5px; color: var(--text-2); line-height: 1.5;
        padding-left: 16px; position: relative;
      }
      .steps li::before {
        content: ''; position: absolute; left: 3px; top: 7px;
        width: 5px; height: 5px; border-radius: 50%; background: var(--accent, #c9a978);
      }

      .fact-row {
        display: flex; align-items: baseline; gap: 8px;
        padding: 5px 6px; font-size: 12px; color: var(--text-2);
      }
      .fact-cat {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em;
        color: var(--text-4); width: 76px; flex-shrink: 0;
      }
      .fact-kv strong { color: var(--text); font-weight: 500; }

      .lead-cta {
        display: flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 12px; border-radius: 6px;
        border: 1px solid var(--border); background: var(--bg-editor);
        color: var(--text-2); font-size: 12.5px; transition: all 100ms;
      }
      .lead-cta:hover { border-color: var(--border-strong); color: var(--text); }
      .lead-cta svg { flex-shrink: 0; }

      .analyze-btn {
        width: 100%; margin-top: 12px;
        display: flex; align-items: center; justify-content: center; gap: 7px;
        padding: 8px 12px; border-radius: 6px;
        border: 1px solid var(--border); background: var(--bg-editor);
        color: var(--text-2); font-family: inherit; font-size: 12.5px;
        cursor: pointer; transition: all 100ms;
      }
      .analyze-btn:hover:not([disabled]) { border-color: var(--border-strong); color: var(--text); }
      .analyze-btn.primary {
        background: var(--accent); color: #fff;
        border-color: var(--accent); font-weight: 500;
      }
      .analyze-btn.primary:hover:not([disabled]) { background: #7e5020; border-color: #7e5020; }
      .analyze-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
      .analyze-btn svg { flex-shrink: 0; }
      .analyze-error { margin-top: 8px; font-size: 11.5px; color: var(--danger); line-height: 1.45; }
      .analyze-hint { margin-top: 8px; font-size: 11px; color: var(--text-3); line-height: 1.45; }

      .stepper {
        margin-top: 12px; border: 1px solid var(--border);
        border-radius: 7px; padding: 12px 13px 13px; background: var(--bg-editor);
      }
      .stepper-head {
        display: flex; align-items: center; gap: 7px;
        font-size: 12px; color: var(--text); font-weight: 500; margin-bottom: 12px;
      }
      .stepper-list { list-style: none; display: flex; flex-direction: column; }
      .stepper-item {
        display: flex; align-items: center; gap: 10px;
        position: relative; padding: 5px 0;
        font-size: 12px; color: var(--text-3);
      }
      .stepper-item:not(:last-child)::before {
        content: ''; position: absolute;
        left: 8px; top: 22px; bottom: -3px;
        width: 1.5px; background: var(--border);
      }
      .stepper-item.done::before { background: var(--success); }
      .stepper-marker {
        width: 17px; height: 17px; flex-shrink: 0; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        border: 1.5px solid var(--border-strong);
        background: var(--bg-panel); color: var(--bg); z-index: 1;
      }
      .stepper-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--text-4); }
      .stepper-item.done .stepper-marker { background: var(--success); border-color: var(--success); color: #fff; }
      .stepper-item.active .stepper-marker { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
      .stepper-item.active .stepper-dot { background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
      .stepper-item.active .stepper-label { color: var(--text); font-weight: 500; }
      .stepper-item.done .stepper-label { color: var(--text-2); }

      .panel-foot {
        padding: 9px 16px; border-top: 1px solid var(--border);
        font-size: 11px; color: var(--text-3);
        display: flex; align-items: center; gap: 6px; flex-shrink: 0;
      }
      .panel-foot .pulse { width: 5px; height: 5px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
    `}</style>
  );
}
