import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi, fileUrl } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { formatRelative } from '../lib/tickets';
import { formatBytes } from '../lib/files';
import { AddDocumentDialog } from './AddDocumentDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { IconPlus, IconFile, IconTrash } from './icons';
import type { KnowledgeDoc, KnowledgeScope } from '../lib/types';

interface Props {
  scope: KnowledgeScope;
  clientId?: string;
}

export function KnowledgeManager({ scope, clientId }: Props) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<KnowledgeDoc | null>(null);

  const queryKey = scope === 'global' ? qk.knowledgeGlobal() : qk.knowledgeClient(clientId ?? '');
  const docsQ = useQuery({
    queryKey,
    queryFn: () => (scope === 'global' ? knowledgeApi.listGlobal() : knowledgeApi.listForClient(clientId!)),
    enabled: scope === 'global' || !!clientId,
  });

  const remove = useMutation({
    mutationFn: (id: string) => knowledgeApi.remove(id),
    onSuccess: async () => {
      setToDelete(null);
      await qc.invalidateQueries({ queryKey });
    },
  });

  const docs = docsQ.data?.docs ?? [];

  return (
    <div className="kb">
      <div className="kb-head">
        <button className="btn primary small" onClick={() => setAdding(true)}>
          <IconPlus size={12} />
          Ajouter un document
        </button>
      </div>

      {docsQ.isLoading ? (
        <div className="loading">Chargement…</div>
      ) : docs.length === 0 ? (
        <div className="empty">
          Aucun document. Ajoutez de la documentation outil, des guides ou des règles —
          l'IA pourra s'y référer lors de l'analyse des tickets.
        </div>
      ) : (
        <div className="kb-list">
          {docs.map((d) => (
            <div key={d._id} className="kb-doc">
              <span className="kb-ico"><IconFile size={15} /></span>
              <div className="kb-body">
                <div className="kb-title">{d.title}</div>
                {d.description && <div className="kb-desc">{d.description}</div>}
                <div className="kb-meta">
                  <span className={`badge ${d.source === 'file' ? 'p-medium' : 's-new'}`}>
                    {d.source === 'file' ? 'fichier' : 'texte'}
                  </span>
                  {d.file && (
                    <a href={fileUrl(d.file.url)} target="_blank" rel="noreferrer" className="kb-file">
                      {d.file.filename}
                      {d.file.size != null && <span> · {formatBytes(d.file.size)}</span>}
                    </a>
                  )}
                  <span className="kb-date">maj {formatRelative(d.updatedAt)}</span>
                </div>
              </div>
              <button
                className="kb-del"
                onClick={() => setToDelete(d)}
                aria-label={`Supprimer ${d.title}`}
                title="Supprimer"
              >
                <IconTrash size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddDocumentDialog scope={scope} clientId={clientId} onClose={() => setAdding(false)} />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Supprimer ce document ?"
        message={<>Le document <em>{toDelete?.title}</em> sera définitivement supprimé.</>}
        confirmLabel="Supprimer"
        destructive
        busy={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete._id)}
        onCancel={() => setToDelete(null)}
      />

      <style>{`
        .kb-head { display: flex; justify-content: flex-end; margin-bottom: 14px; }
        .kb-list { display: flex; flex-direction: column; gap: 8px; }
        .kb-doc {
          display: flex; align-items: center; gap: 12px;
          background: var(--bg-panel); border: 1px solid var(--border);
          border-radius: 8px; padding: 12px 14px;
        }
        .kb-doc:hover { border-color: var(--border-strong); }
        .kb-ico {
          width: 32px; height: 32px; flex-shrink: 0; border-radius: 6px;
          background: var(--bg-elevated); display: flex; align-items: center;
          justify-content: center; color: var(--text-2);
        }
        .kb-body { flex: 1; min-width: 0; }
        .kb-title { font-size: 13.5px; font-weight: 500; color: var(--text); }
        .kb-desc { font-size: 12px; color: var(--text-2); margin-top: 2px; line-height: 1.45; }
        .kb-meta { display: flex; align-items: center; gap: 10px; margin-top: 4px; flex-wrap: wrap; }
        .kb-file { font-size: 12px; color: var(--text-2); }
        .kb-file:hover { color: var(--accent); }
        .kb-date { font-size: 11.5px; color: var(--text-3); }
        .kb-del {
          background: none; border: 1px solid transparent; color: var(--text-3);
          width: 30px; height: 30px; border-radius: 6px; cursor: pointer;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          transition: all 100ms;
        }
        .kb-del:hover { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-strong); }
      `}</style>
    </div>
  );
}
