import { Link } from 'react-router-dom';
import { KnowledgeManager } from '../components/KnowledgeManager';
import { IconArrow } from '../components/icons';

/**
 * Standalone page (outside a client workspace) for the global knowledge base —
 * documents shared across every client.
 */
export function GlobalKnowledgePage() {
  return (
    <div className="standalone">
      <div className="kb-page">
        <Link to="/" className="back-link">
          <IconArrow size={13} style={{ transform: 'rotate(180deg)' }} />
          Clients
        </Link>
        <h1 className="page-title" style={{ marginTop: 16 }}>Base de connaissances</h1>
        <p className="page-subtitle">
          Documents de connaissance partagés pour tous vos clients : documentation de
          l'outil, guides, règles de configuration… L'IA s'y réfère lors de l'analyse des
          tickets pour proposer des angles de correction.
        </p>
        <KnowledgeManager scope="global" />
      </div>

      <style>{`
        .kb-page { max-width: 760px; width: 100%; }
        .back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-3); }
        .back-link:hover { color: var(--text); }
      `}</style>
    </div>
  );
}
