import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meApi, ticketsApi, streamAssistant } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { IconCopy, IconCheck } from './icons';
import type { Ticket } from '../lib/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ragHits?: string[];
}

/**
 * The assistant side of a ticket: the AI's analysis (suggested reply + next
 * steps) plus a chat scoped to this ticket.
 */
export function TicketAssistant({ ticket }: { ticket: Ticket }) {
  const clientId = ticket.clientId;
  const qc = useQueryClient();
  const analysis = ticket.analysis;

  const meQ = useQuery({ queryKey: qk.me(), queryFn: () => meApi.get(), staleTime: 5 * 60_000 });
  const agentName = meQ.data?.user.name || meQ.data?.user.email || 'Agent';

  const [copied, setCopied] = useState(false);
  const copyReply = async () => {
    if (!analysis?.suggestedReply) return;
    try {
      await navigator.clipboard.writeText(analysis.suggestedReply);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const useAsReply = useMutation({
    mutationFn: () =>
      ticketsApi.addMessage(ticket._id, {
        authorName: agentName,
        authorRole: 'agent',
        body: analysis?.suggestedReply ?? '',
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.ticket(ticket._id) }),
        qc.invalidateQueries({ queryKey: qk.tickets(clientId) }),
      ]);
    },
  });

  // ─── Chat ──────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    const history = [...messages, { role: 'user' as const, content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setDraft('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAssistant({
        clientId,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        currentTicketId: ticket._id,
        signal: controller.signal,
        onEvent: (event) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (!last || last.role !== 'assistant') return next;
            if (event.type === 'start') next[next.length - 1] = { ...last, ragHits: event.ragHits };
            else if (event.type === 'delta') next[next.length - 1] = { ...last, content: last.content + event.text };
            else if (event.type === 'error')
              next[next.length - 1] = { ...last, content: last.content + `\n\n[erreur : ${event.message}]` };
            return next;
          });
          if (event.type === 'delta') {
            requestAnimationFrame(() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }
        },
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant')
            next[next.length - 1] = { ...last, content: last.content || `[erreur : ${(err as Error).message}]` };
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="asst">
      <div className="asst-scroll" ref={scrollRef}>
        {analysis ? (
          <>
            {analysis.suggestedReply && (
              <section className="asst-block">
                <div className="asst-block-head">
                  Réponse suggérée
                  <div className="asst-block-actions">
                    <button className="mini-btn" onClick={() => void copyReply()}>
                      {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
                      {copied ? 'Copié' : 'Copier'}
                    </button>
                    <button
                      className="mini-btn"
                      onClick={() => useAsReply.mutate()}
                      disabled={useAsReply.isPending}
                    >
                      {useAsReply.isPending ? 'Ajout…' : 'Ajouter au fil'}
                    </button>
                  </div>
                </div>
                <div className="reply-card">{analysis.suggestedReply}</div>
              </section>
            )}

            {analysis.nextSteps && analysis.nextSteps.length > 0 && (
              <section className="asst-block">
                <div className="asst-block-head">Prochaines étapes</div>
                <ul className="next-steps">
                  {analysis.nextSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <div className="empty" style={{ marginBottom: 18 }}>
            Lancez l'analyse (bouton « Analyser ») pour obtenir une réponse suggérée et des
            étapes de résolution. Vous pouvez aussi poser une question ci-dessous.
          </div>
        )}

        {messages.length > 0 && (
          <section className="asst-block">
            <div className="asst-block-head">Échange avec l'assistant</div>
            <div className="chat">
              {messages.map((m, i) => (
                <div key={i} className={`chat-msg ${m.role}`}>
                  {m.role === 'assistant' && m.ragHits && m.ragHits.length > 0 && (
                    <div className="chat-rag">Tickets consultés : {m.ragHits.slice(0, 3).join(' · ')}</div>
                  )}
                  <div className="chat-body">{m.content || '…'}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="asst-composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Demander un diagnostic, reformuler une réponse, vérifier l'historique…"
          rows={2}
          disabled={streaming}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <button className="btn" onClick={() => abortRef.current?.abort()}>Arrêter</button>
        ) : (
          <button className="btn primary" onClick={() => void send()} disabled={!draft.trim()}>
            Envoyer
          </button>
        )}
      </div>

      <AssistantStyles />
    </div>
  );
}

function AssistantStyles() {
  return (
    <style>{`
      .asst { display: flex; flex-direction: column; height: 100%; min-height: 0; }
      .asst-scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 20px 24px; }
      .asst-block { margin-bottom: 20px; }
      .asst-block-head {
        font-size: 11.5px; color: var(--text-3); font-weight: 500;
        margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;
      }
      .asst-block-actions { display: flex; gap: 6px; }
      .mini-btn {
        display: inline-flex; align-items: center; gap: 4px;
        background: none; border: 1px solid var(--border); color: var(--text-2);
        font-family: inherit; font-size: 11px; padding: 3px 8px; border-radius: 5px; cursor: pointer;
        transition: all 100ms;
      }
      .mini-btn:hover:not([disabled]) { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
      .mini-btn[disabled] { opacity: 0.5; cursor: default; }
      .reply-card {
        background: var(--bg-panel); border: 1px solid var(--border);
        border-radius: 8px; padding: 13px 15px;
        font-size: 13.5px; line-height: 1.65; color: var(--text); white-space: pre-wrap;
      }
      .next-steps { list-style: none; display: flex; flex-direction: column; gap: 7px; }
      .next-steps li {
        position: relative; padding-left: 18px;
        font-size: 13px; color: var(--text-2); line-height: 1.5;
      }
      .next-steps li::before {
        content: ''; position: absolute; left: 4px; top: 7px;
        width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
      }

      .chat { display: flex; flex-direction: column; gap: 12px; }
      .chat-msg { display: flex; flex-direction: column; }
      .chat-msg.user { align-items: flex-end; }
      .chat-msg.user .chat-body {
        background: var(--bg-elevated); border: 1px solid var(--border);
        border-radius: 11px 11px 4px 11px; padding: 8px 12px; max-width: 85%;
        font-size: 13px; color: var(--text); white-space: pre-wrap; line-height: 1.5;
      }
      .chat-msg.assistant .chat-body { font-size: 13.5px; color: var(--text); line-height: 1.65; white-space: pre-wrap; }
      .chat-rag { font-size: 11px; color: var(--text-3); margin-bottom: 4px; font-family: var(--font-mono); }

      .asst-composer {
        border-top: 1px solid var(--border); background: var(--bg);
        padding: 12px 16px 14px; flex-shrink: 0;
        display: flex; gap: 8px; align-items: flex-end;
      }
      .asst-composer textarea {
        flex: 1; background: var(--bg-panel); border: 1px solid var(--border);
        border-radius: 8px; padding: 9px 12px; color: var(--text);
        font-family: inherit; font-size: 13px; line-height: 1.5; outline: none; resize: none;
      }
      .asst-composer textarea:focus { border-color: var(--border-strong); }
    `}</style>
  );
}
