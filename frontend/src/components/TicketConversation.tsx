import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi, meApi, ticketsApi, fileUrl } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { fileToBase64, isImage, formatBytes } from '../lib/files';
import { formatRelative } from '../lib/tickets';
import { ImportConversationDialog } from './ImportConversationDialog';
import { IconPaperclip, IconTrash, IconFile, IconImport } from './icons';
import type { Ticket, TicketMessage, AuthorRole } from '../lib/types';

/**
 * The ticketing conversation: customer ⇄ agent messages with attachments,
 * plus a composer to append a new message.
 */
export function TicketConversation({ ticket }: { ticket: Ticket }) {
  const clientId = ticket.clientId;
  const qc = useQueryClient();

  const meQ = useQuery({ queryKey: qk.me(), queryFn: () => meApi.get(), staleTime: 5 * 60_000 });
  const clientQ = useQuery({
    queryKey: qk.client(clientId),
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });

  const agentName = meQ.data?.user.name || meQ.data?.user.email || 'Agent';
  const clientName = clientQ.data?.client.name || 'Client';

  const [role, setRole] = useState<AuthorRole>('agent');
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const effectiveAuthor = author.trim() || (role === 'agent' ? agentName : clientName);

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.ticket(ticket._id) }),
      qc.invalidateQueries({ queryKey: qk.tickets(clientId) }),
    ]);

  const addMessage = useMutation({
    mutationFn: async () => {
      const attachments = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          mime: f.type || undefined,
          dataBase64: await fileToBase64(f),
        })),
      );
      return ticketsApi.addMessage(ticket._id, {
        authorName: effectiveAuthor,
        authorRole: role,
        body: body.trim(),
        attachments,
      });
    },
    onSuccess: async () => {
      setBody('');
      setFiles([]);
      setError(null);
      await invalidate();
    },
    onError: (e) => setError((e as Error).message),
  });

  const removeMessage = useMutation({
    mutationFn: (messageId: string) => ticketsApi.removeMessage(ticket._id, messageId),
    onSuccess: () => invalidate(),
  });

  const canSend = (body.trim().length > 0 || files.length > 0) && !addMessage.isPending;

  return (
    <div className="conv">
      <div className="conv-thread">
        {ticket.messages.length === 0 ? (
          <div className="empty conv-empty">
            <p>Aucun message. Ajoutez-en un ci-dessous, ou importez une conversation existante.</p>
            <button className="btn" onClick={() => setImporting(true)}>
              <IconImport size={13} />
              Importer une conversation
            </button>
          </div>
        ) : (
          ticket.messages.map((m) => (
            <Message key={m._id} message={m} onDelete={() => removeMessage.mutate(m._id)} />
          ))
        )}
      </div>

      <div className="conv-composer">
        <div className="composer-row1">
          <div className="seg small">
            <button className={role === 'customer' ? 'active' : ''} onClick={() => setRole('customer')}>
              Client
            </button>
            <button className={role === 'agent' ? 'active' : ''} onClick={() => setRole('agent')}>
              Agent
            </button>
          </div>
          <input
            className="author-input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder={role === 'agent' ? agentName : clientName}
          />
        </div>

        <textarea
          className="composer-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message en tant que ${effectiveAuthor}…`}
          rows={3}
        />

        {files.length > 0 && (
          <div className="pending-files">
            {files.map((f, i) => (
              <span key={i} className="pending-chip">
                <IconFile size={11} />
                {f.name}
                <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label="Retirer">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <div className="composer-error">{error}</div>}

        <div className="composer-actions">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <IconPaperclip size={13} />
            Joindre
          </button>
          <button className="btn" onClick={() => setImporting(true)} title="Importer une conversation existante">
            <IconImport size={13} />
            Importer
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setFiles((prev) => [...prev, ...picked]);
              e.target.value = '';
            }}
          />
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => addMessage.mutate()} disabled={!canSend}>
            {addMessage.isPending ? 'Envoi…' : 'Ajouter au fil'}
          </button>
        </div>
      </div>

      {importing && (
        <ImportConversationDialog
          ticketId={ticket._id}
          clientId={clientId}
          onClose={() => setImporting(false)}
        />
      )}

      <ConversationStyles />
    </div>
  );
}

function Message({ message, onDelete }: { message: TicketMessage; onDelete: () => void }) {
  const isAgent = message.authorRole === 'agent';
  return (
    <div className={`msg-line ${isAgent ? 'agent' : 'customer'}`}>
      <div className="msg-card">
        <div className="msg-head">
          <span className="msg-author">{message.authorName}</span>
          <span className={`role-tag ${isAgent ? 'agent' : 'customer'}`}>
            {isAgent ? 'Agent' : 'Client'}
          </span>
          <span className="msg-date">{formatRelative(message.at)}</span>
          <button className="msg-del" onClick={onDelete} aria-label="Supprimer le message" title="Supprimer">
            <IconTrash size={11} />
          </button>
        </div>
        {message.body && <div className="msg-text">{message.body}</div>}
        {message.attachments.length > 0 && (
          <div className="msg-attachments">
            {message.attachments.map((a, i) =>
              isImage(a.mime, a.filename) ? (
                <a key={i} href={fileUrl(a.url)} target="_blank" rel="noreferrer" className="att-image">
                  <img src={fileUrl(a.url)} alt={a.filename} />
                  <span className="att-caption">{a.filename}</span>
                </a>
              ) : (
                <a key={i} href={fileUrl(a.url)} target="_blank" rel="noreferrer" className="att-file">
                  <IconFile size={14} />
                  <span className="att-name">{a.filename}</span>
                  {a.size != null && <span className="att-size">{formatBytes(a.size)}</span>}
                </a>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationStyles() {
  return (
    <style>{`
      .conv { display: flex; flex-direction: column; height: 100%; min-height: 0; }
      .conv-thread {
        flex: 1; overflow-y: auto; min-height: 0;
        padding: 20px 24px;
        display: flex; flex-direction: column; gap: 14px;
      }
      .conv-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; }
      .conv-empty p { margin: 0; }
      .msg-line { display: flex; }
      .msg-line.agent { justify-content: flex-end; }
      .msg-card {
        max-width: 78%;
        background: var(--bg-panel);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 13px 11px;
      }
      .msg-line.agent .msg-card { background: var(--accent-bg); border-color: var(--accent-strong); }
      .msg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .msg-author { font-size: 12.5px; font-weight: 600; color: var(--text); }
      .role-tag {
        font-size: 10px; padding: 1px 6px; border-radius: 5px;
        border: 1px solid var(--border); color: var(--text-3); background: var(--bg);
      }
      .role-tag.agent { color: var(--accent); border-color: var(--accent-strong); }
      .msg-date { font-size: 11px; color: var(--text-3); }
      .msg-del {
        margin-left: auto; background: none; border: none; color: var(--text-4);
        cursor: pointer; padding: 2px; border-radius: 4px; opacity: 0; transition: opacity 100ms;
        display: flex;
      }
      .msg-card:hover .msg-del { opacity: 1; }
      .msg-del:hover { color: var(--danger); background: var(--danger-bg); }
      .msg-text { font-size: 13.5px; color: var(--text); line-height: 1.6; white-space: pre-wrap; }

      .msg-attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
      .att-file {
        display: inline-flex; align-items: center; gap: 7px;
        border: 1px solid var(--border); border-radius: 7px;
        padding: 6px 10px; background: var(--bg); color: var(--text-2);
        font-size: 12px; transition: border-color 100ms;
      }
      .att-file:hover { border-color: var(--border-strong); color: var(--text); }
      .att-file .att-size { color: var(--text-4); font-size: 11px; }
      .att-image { display: inline-flex; flex-direction: column; gap: 3px; max-width: 200px; }
      .att-image img {
        max-width: 200px; max-height: 150px; border-radius: 7px;
        border: 1px solid var(--border); object-fit: cover;
      }
      .att-image .att-caption { font-size: 11px; color: var(--text-3); }

      .conv-composer {
        border-top: 1px solid var(--border);
        background: var(--bg);
        padding: 12px 16px 14px;
        flex-shrink: 0;
        display: flex; flex-direction: column; gap: 8px;
      }
      .composer-row1 { display: flex; align-items: center; gap: 8px; }
      .seg.small button { padding: 4px 12px; font-size: 11.5px; }
      .author-input {
        flex: 1; max-width: 240px;
        background: var(--bg-panel); border: 1px solid var(--border);
        border-radius: 6px; padding: 5px 9px;
        color: var(--text); font-family: inherit; font-size: 12.5px; outline: none;
      }
      .author-input:focus { border-color: var(--border-strong); }
      .composer-body {
        width: 100%;
        background: var(--bg-panel); border: 1px solid var(--border);
        border-radius: 8px; padding: 10px 12px;
        color: var(--text); font-family: inherit; font-size: 13.5px; line-height: 1.6;
        outline: none; resize: vertical;
      }
      .composer-body:focus { border-color: var(--border-strong); }
      .pending-files { display: flex; flex-wrap: wrap; gap: 6px; }
      .pending-chip {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11.5px; color: var(--text-2);
        background: var(--bg-elevated); border: 1px solid var(--border);
        border-radius: 6px; padding: 3px 8px;
      }
      .pending-chip button {
        background: none; border: none; color: var(--text-3);
        cursor: pointer; font-size: 14px; line-height: 1; padding: 0;
      }
      .pending-chip button:hover { color: var(--danger); }
      .composer-error { font-size: 11.5px; color: var(--danger); }
      .composer-actions { display: flex; align-items: center; gap: 8px; }
    `}</style>
  );
}
