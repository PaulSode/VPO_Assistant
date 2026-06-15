import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { fileToBase64 } from '../lib/files';
import { IconPaperclip } from './icons';
import type { KnowledgeScope } from '../lib/types';

interface Props {
  scope: KnowledgeScope;
  clientId?: string;
  onClose: () => void;
}

/**
 * Add a knowledge document — by pasting text and/or attaching a file.
 * Text files are turned into searchable content automatically by the backend.
 */
export function AddDocumentDialog({ scope, clientId, onClose }: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: async () => {
      const filePayload = file
        ? { filename: file.name, mime: file.type || undefined, dataBase64: await fileToBase64(file) }
        : undefined;
      return knowledgeApi.create({
        scope,
        clientId,
        title: title.trim(),
        description: description.trim() || undefined,
        content: content.trim() || undefined,
        file: filePayload,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: scope === 'global' ? qk.knowledgeGlobal() : qk.knowledgeClient(clientId ?? ''),
      });
      onClose();
    },
  });

  // If the title is empty and a file is chosen, suggest the file name.
  const onPickFile = (f: File | null) => {
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const canSave = title.trim().length > 0 && (content.trim().length > 0 || !!file) && !create.isPending;

  return (
    <div className="imp-backdrop" onClick={onClose}>
      <div className="imp" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="imp-head">
          <h2>Ajouter un document</h2>
          <button className="imp-x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <p className="imp-sub">
          {scope === 'global'
            ? 'Document de connaissance partagé pour tous vos clients (documentation outil, guides, règles…).'
            : 'Document spécifique à ce client.'}{' '}
          L'IA pourra le consulter lors de l'analyse des tickets.
        </p>

        <label className="fld-label">Titre</label>
        <input
          className="fld-input"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="ex. Guide de configuration des filtres"
        />

        <label className="fld-label" style={{ marginTop: 12 }}>
          Description courte <span className="fld-opt">— aide l'IA à savoir quand consulter ce document</span>
        </label>
        <input
          className="fld-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="ex. Règles de nommage et préfixes des références contrats"
        />

        <label className="fld-label" style={{ marginTop: 12 }}>Contenu (texte)</label>
        <textarea
          className="imp-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Collez ici le texte du document (procédure, règle, extrait de doc…)"
          rows={6}
        />

        <div className="fld-file">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            <IconPaperclip size={13} />
            {file ? 'Changer le fichier' : 'Joindre un fichier'}
          </button>
          <input
            ref={fileInput}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => {
              onPickFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          {file && (
            <span className="fld-file-name">
              {file.name}
              <button onClick={() => setFile(null)} aria-label="Retirer">×</button>
            </span>
          )}
          <span className="fld-hint">Les fichiers texte (.txt, .md, .csv…) sont lus automatiquement.</span>
        </div>

        {create.isError && (
          <div className="imp-error">Échec : {(create.error as Error).message}</div>
        )}

        <div className="imp-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" onClick={() => create.mutate()} disabled={!canSave}>
            {create.isPending ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>

        <style>{`
          .fld-label { display: block; font-size: 11.5px; color: var(--text-3); margin-bottom: 6px; }
          .fld-opt { color: var(--text-4); }
          .fld-input {
            width: 100%; background: var(--bg); border: 1px solid var(--border);
            border-radius: 7px; padding: 8px 11px; color: var(--text);
            font-family: inherit; font-size: 13px; outline: none;
          }
          .fld-input:focus { border-color: var(--border-strong); }
          .fld-file { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
          .fld-file-name {
            display: inline-flex; align-items: center; gap: 6px;
            font-size: 12px; color: var(--text-2);
            background: var(--bg-elevated); border: 1px solid var(--border);
            border-radius: 6px; padding: 3px 8px;
          }
          .fld-file-name button { background: none; border: none; color: var(--text-3); cursor: pointer; font-size: 14px; line-height: 1; }
          .fld-file-name button:hover { color: var(--danger); }
          .fld-hint { font-size: 11px; color: var(--text-3); }
        `}</style>
      </div>
    </div>
  );
}
