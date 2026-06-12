import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, streamAnalysis } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Topbar } from '../components/Layout';
import { EditorPanel } from '../components/EditorPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconSparkle, IconTrash } from '../components/icons';

/**
 * Ticket detail — reached from the tickets table.
 *
 * - Local content state is the source of truth while the agent edits
 * - 1.5s after the last keystroke we PUT the content (saving stays free)
 * - Analysis is user-triggered; it streams live SSE progress into the right
 *   panel's stepper.
 */

const SAVE_DEBOUNCE_MS = 1500;
const ANALYZE_TIMEOUT_MS = 180_000;

export function TicketDetailPage() {
  const { clientId = '', ticketId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  // ─── Local content state ───────────────────────────────────────────────
  const [content, setContent] = useState<string>('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const previousTicketId = useRef<string | undefined>();

  useEffect(() => {
    if (!ticket) return;
    if (previousTicketId.current !== ticket._id) {
      setContent(ticket.content ?? '');
      setSaveState('idle');
      previousTicketId.current = ticket._id;
      analyzeAbort.current?.abort();
      if (analyzeTimer.current) {
        clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      setAnalyzing(false);
      setAnalysisStep(-1);
      setAnalyzeError(null);
    }
  }, [ticket]);

  useEffect(() => {
    return () => {
      analyzeAbort.current?.abort();
      if (analyzeTimer.current) clearTimeout(analyzeTimer.current);
    };
  }, []);

  // ─── Save mutation ─────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (text: string) => ticketsApi.saveContent(ticketId, text),
    onMutate: () => setSaveState('saving'),
    onSuccess: (data) => {
      setSaveState('saved');
      setLastSavedAt(new Date(data.savedAt));
      qc.invalidateQueries({ queryKey: qk.ticket(ticketId) });
    },
    onError: () => setSaveState('error'),
  });

  // ─── Analyze (manual trigger) ──────────────────────────────────────────
  const refreshAfterAnalysis = () => {
    qc.invalidateQueries({ queryKey: qk.ticket(ticketId) });
    qc.invalidateQueries({ queryKey: qk.tickets(clientId) });
    qc.invalidateQueries({ queryKey: qk.facts(clientId) });
    qc.invalidateQueries({ queryKey: qk.factsForTicket(ticketId) });
  };

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
      if (content !== ticket.content) {
        await save.mutateAsync(content);
      }
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
      if (e.name !== 'AbortError') {
        setAnalyzeError(e.message || "L'analyse a échoué.");
      }
    } finally {
      if (analyzeTimer.current) {
        clearTimeout(analyzeTimer.current);
        analyzeTimer.current = null;
      }
      analyzeAbort.current = null;
      setAnalyzing(false);
      setAnalysisStep(-1);
      refreshAfterAnalysis();
    }
  };

  // ─── Rename (subject) ──────────────────────────────────────────────────
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

  // ─── Delete ticket ─────────────────────────────────────────────────────
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

  // Debounced save on content changes
  useEffect(() => {
    if (!ticket) return;
    if (content === ticket.content) return;
    const timer = setTimeout(() => save.mutate(content), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // ─── Derived ───────────────────────────────────────────────────────────
  const hasContent = content.trim().length > 0;
  const hasUnanalyzed =
    !!ticket &&
    hasContent &&
    (ticket.lastAnalyzedVersion < ticket.analysisVersion || content !== ticket.content);

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
          disabled={analyzing || !hasContent || !hasUnanalyzed}
          title={
            !hasContent
              ? "Collez le message du client avant d'analyser"
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
        <SaveBadge state={saveState} savedAt={lastSavedAt} />
      </Topbar>

      <div className="detail-body">
        <div className="detail-main">
          <article className="editor">
            <div className="ticket-ref-row">
              <span className="chap-num">ticket</span>
              <input
                className="ref-input"
                defaultValue={ticket.reference ?? ''}
                placeholder="réf. externe (optionnel)"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (ticket.reference ?? '')) updateReference.mutate(v);
                }}
              />
            </div>
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
            <div className="content-label">Message du client</div>
            <textarea
              className="editor-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Collez ici le message reçu du client…"
              spellCheck
            />
          </article>
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
            Vous êtes sur le point de supprimer <em>{ticket.subject}</em>. Le contexte
            client extrait de ce ticket sera également retiré. Cette action est
            irréversible.
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

// ─── Save state indicator ────────────────────────────────────────────────────

function SaveBadge({ state, savedAt }: { state: 'idle' | 'saving' | 'saved' | 'error'; savedAt: Date | null }) {
  const label =
    state === 'saving'
      ? 'Sauvegarde…'
      : state === 'error'
        ? 'Erreur de sauvegarde'
        : state === 'saved' && savedAt
          ? `Sauvegardé ${formatSecs(savedAt)}`
          : 'Synchronisé';

  return (
    <div className="save">
      <span className={`dot${state === 'saving' ? ' pending' : ''}${state === 'error' ? ' error' : ''}`} />
      {label}
    </div>
  );
}

function formatSecs(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 5) return "à l'instant";
  if (diff < 60) return `il y a ${diff}s`;
  return `il y a ${Math.round(diff / 60)}min`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function DetailStyles() {
  return (
    <style>{`
      .detail-body { flex: 1; display: flex; min-height: 0; }
      .detail-main { flex: 1; overflow-y: auto; min-width: 0; }
      .detail-body > .panel { width: 340px; flex-shrink: 0; }

      .editor {
        max-width: 760px; margin: 0 auto; padding: 36px 40px 80px;
        font-family: var(--font-sans);
        font-size: 15px; line-height: 1.7; color: var(--text);
      }
      .editor .ticket-ref-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .editor .chap-num {
        font-family: var(--font-sans); font-size: 11.5px; color: var(--text-3);
        letter-spacing: 0.04em; text-transform: uppercase;
      }
      .ref-input {
        background: transparent; border: 1px solid var(--border);
        color: var(--text-2); font-family: var(--font-mono); font-size: 11.5px;
        padding: 3px 8px; border-radius: 5px; outline: none; flex: 1; max-width: 260px;
        transition: border-color 100ms;
      }
      .ref-input:hover { border-color: var(--border-strong); }
      .ref-input:focus { border-color: var(--text-3); }
      .editor h1 {
        font-family: var(--font-sans);
        font-size: 24px; font-weight: 600;
        letter-spacing: -0.012em; line-height: 1.25;
        margin-bottom: 26px; outline: none;
      }
      .content-label {
        font-size: 11.5px; color: var(--text-3); margin-bottom: 8px; letter-spacing: 0.01em;
      }
      .editor-textarea {
        width: 100%; min-height: 46vh;
        background: var(--bg-panel); border: 1px solid var(--border);
        border-radius: 8px; padding: 16px 18px;
        outline: none; resize: vertical;
        font-family: inherit; font-size: 14.5px; line-height: 1.7; color: inherit;
        transition: border-color 120ms;
      }
      .editor-textarea:focus { border-color: var(--border-strong); }
      .editor-textarea::placeholder { color: var(--text-3); font-style: italic; }
    `}</style>
  );
}
