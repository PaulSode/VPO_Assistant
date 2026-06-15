import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, streamAnalysis } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Topbar } from '../components/Layout';
import { EditorPanel } from '../components/EditorPanel';
import { TicketConversation } from '../components/TicketConversation';
import { TicketAssistant } from '../components/TicketAssistant';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconSparkle, IconTrash } from '../components/icons';

const ANALYZE_TIMEOUT_MS = 180_000;

type Tab = 'conversation' | 'assistant';

export function TicketDetailPage() {
  const { clientId = '', ticketId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('conversation');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysisStep, setAnalysisStep] = useState<number>(-1);
  const analyzeAbort = useRef<AbortController | null>(null);
  const analyzeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ticketQ = useQuery({
    queryKey: qk.ticket(ticketId),
    queryFn: () => ticketsApi.get(ticketId),
    enabled: !!ticketId,
  });
  const ticket = ticketQ.data?.ticket;

  // Reset transient analysis state when switching tickets
  const previousTicketId = useRef<string | undefined>();
  useEffect(() => {
    if (ticket && previousTicketId.current !== ticket._id) {
      previousTicketId.current = ticket._id;
      analyzeAbort.current?.abort();
      if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
      setAnalyzing(false);
      setAnalysisStep(-1);
      setAnalyzeError(null);
      setTab('conversation');
    }
  }, [ticket]);

  useEffect(() => {
    return () => {
      analyzeAbort.current?.abort();
      if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    };
  }, []);

  // ─── Analyze ───────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!ticketId || !ticket || analyzing) return;
    setAnalyzeError(null);
    setAnalyzing(true);
    setAnalysisStep(0);

    const controller = new AbortController();
    analyzeAbort.current = controller;
    if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    analyzeTimer.current = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

    try {
      await streamAnalysis({
        ticketId,
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'step') setAnalysisStep(e.index);
          else if (e.type === 'error') setAnalyzeError(e.message);
        },
      });
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError') setAnalyzeError(e.message || "L'analyse a échoué.");
    } finally {
      if (analyzeTimer.current) {
        clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      analyzeAbort.current = null;
      setAnalyzing(false);
      setAnalysisStep(-1);
      qc.invalidateQueries({ queryKey: qk.ticket(ticketId) });
      qc.invalidateQueries({ queryKey: qk.tickets(clientId) });
      qc.invalidateQueries({ queryKey: qk.facts(clientId) });
      qc.invalidateQueries({ queryKey: qk.factsForTicket(ticketId) });
    }
  };

  // ─── Subject + reference ───────────────────────────────────────────────
  const renameTicket = useMutation({
    mutationFn: (subject: string) => ticketsApi.updateMeta(ticketId, { subject }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.ticket(ticketId) }),
        qc.invalidateQueries({ queryKey: qk.tickets(clientId) }),
      ]);
    },
  });
  const commitSubject = (raw: string) => {
    const next = raw.trim();
    if (!ticket || !next || next === ticket.subject) return;
    renameTicket.mutate(next);
  };
  const updateReference = useMutation({
    mutationFn: (reference: string) => ticketsApi.updateMeta(ticketId, { reference }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.ticket(ticketId) }),
  });

  // ─── Delete ────────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTicket = useMutation({
    mutationFn: () => ticketsApi.remove(ticketId),
    onSuccess: async () => {
      setConfirmDelete(false);
      await qc.invalidateQueries({ queryKey: qk.tickets(clientId) });
      qc.removeQueries({ queryKey: qk.ticket(ticketId) });
      navigate(`/clients/${clientId}/tickets`, { replace: true });
    },
  });

  const hasMessages = !!ticket && ticket.messages.length > 0;
  const hasUnanalyzed = !!ticket && hasMessages && ticket.lastAnalyzedVersion < ticket.analysisVersion;

  if (!ticket) {
    return (
      <>
        <Topbar crumbs={[{ label: 'Tickets', to: `/clients/${clientId}/tickets` }, { label: '…' }]} />
        <div className="loading" style={{ padding: 40 }}>
          {ticketQ.isError ? `Ticket introuvable : ${(ticketQ.error as Error).message}` : 'Chargement…'}
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar crumbs={[{ label: 'Tickets', to: `/clients/${clientId}/tickets` }, { label: ticket.subject }]}>
        <button
          className={`btn small${hasUnanalyzed && !analyzing ? ' primary' : ''}`}
          onClick={() => void handleAnalyze()}
          disabled={analyzing || !hasMessages || !hasUnanalyzed}
          title={
            !hasMessages
              ? 'Ajoutez au moins un message avant d’analyser'
              : hasUnanalyzed
                ? 'Analyser ce ticket (classement, réponse, contexte)'
                : 'Ticket déjà analysé — aucune modification depuis'
          }
        >
          <IconSparkle size={12} />
          {analyzing ? 'Analyse…' : hasUnanalyzed ? 'Analyser' : 'À jour'}
        </button>
        <button
          className="btn small"
          onClick={() => setConfirmDelete(true)}
          disabled={deleteTicket.isPending}
          title="Supprimer ce ticket"
          aria-label="Supprimer ce ticket"
        >
          <IconTrash size={11} />
        </button>
      </Topbar>

      <div className="detail-body">
        <div className="detail-main">
          <div className="detail-head">
            <h1
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={(e) => commitSubject(e.currentTarget.textContent ?? '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            >
              {ticket.subject}
            </h1>
            <label className="ref-field">
              Réf.
              <input
                defaultValue={ticket.reference ?? ''}
                placeholder="lien outil ticketing"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (ticket.reference ?? '')) updateReference.mutate(v);
                }}
              />
            </label>
          </div>

          <div className="detail-tabs">
            <button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>
              Conversation
              <span className="tab-count">{ticket.messages.length}</span>
            </button>
            <button className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}>
              Assistant IA
            </button>
          </div>

          <div className="detail-tab-body">
            {tab === 'conversation' ? (
              <TicketConversation ticket={ticket} />
            ) : (
              <TicketAssistant ticket={ticket} />
            )}
          </div>
        </div>

        <EditorPanel
          ticket={ticket}
          analyzing={analyzing}
          analysisStep={analysisStep}
          hasUnanalyzed={hasUnanalyzed}
          analyzeError={analyzeError}
          onAnalyze={() => void handleAnalyze()}
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce ticket ?"
        message={
          <>
            Vous êtes sur le point de supprimer <em>{ticket.subject}</em>. La conversation,
            les pièces jointes et le contexte client extrait seront également retirés. Cette
            action est irréversible.
          </>
        }
        confirmLabel="Supprimer"
        destructive
        busy={deleteTicket.isPending}
        onConfirm={() => deleteTicket.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />

      <DetailStyles />
    </>
  );
}

function DetailStyles() {
  return (
    <style>{`
      .detail-body { flex: 1; display: flex; min-height: 0; }
      .detail-main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
      .detail-body > .panel { width: 320px; flex-shrink: 0; }

      .detail-head {
        display: flex; align-items: center; gap: 16px;
        padding: 16px 24px 12px; border-bottom: 1px solid var(--border);
      }
      .detail-head h1 {
        flex: 1; min-width: 0;
        font-size: 19px; font-weight: 600; letter-spacing: -0.01em;
        color: var(--text); outline: none; line-height: 1.3;
      }
      .ref-field {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; color: var(--text-3); flex-shrink: 0;
      }
      .ref-field input {
        background: var(--bg-panel); border: 1px solid var(--border);
        border-radius: 6px; padding: 4px 8px; width: 150px;
        color: var(--text-2); font-family: var(--font-mono); font-size: 11.5px; outline: none;
      }
      .ref-field input:focus { border-color: var(--border-strong); }

      .detail-tabs {
        display: flex; gap: 4px; padding: 0 16px;
        border-bottom: 1px solid var(--border); flex-shrink: 0;
      }
      .detail-tabs button {
        display: inline-flex; align-items: center; gap: 7px;
        background: none; border: none; border-bottom: 2px solid transparent;
        color: var(--text-3); font-family: inherit; font-size: 13px;
        padding: 10px 12px; margin-bottom: -1px; cursor: pointer;
        transition: color 100ms;
      }
      .detail-tabs button:hover { color: var(--text-2); }
      .detail-tabs button.active { color: var(--text); border-bottom-color: var(--text); }
      .tab-count {
        font-family: var(--font-mono); font-size: 10.5px; color: var(--text-4);
        background: var(--bg-elevated); border-radius: 8px; padding: 0 6px;
      }

      .detail-tab-body { flex: 1; min-height: 0; display: flex; }
      .detail-tab-body > * { flex: 1; min-width: 0; }
    `}</style>
  );
}
