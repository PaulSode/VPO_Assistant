import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clientsApi } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { Topbar } from '../components/Layout';
import { KnowledgeManager } from '../components/KnowledgeManager';

export function ClientDocumentsPage() {
  const { clientId = '' } = useParams();
  const clientQ = useQuery({
    queryKey: qk.client(clientId),
    queryFn: () => clientsApi.get(clientId),
    enabled: !!clientId,
  });

  return (
    <>
      <Topbar crumbs={[{ label: 'Documents' }]} />
      <div className="page-scroll">
        <div className="page">
          <h1 className="page-title">Documents du client</h1>
          <p className="page-subtitle">
            {clientQ.data?.client.name ?? '…'} — documents spécifiques à ce client. L'IA les
            consulte lors de l'analyse, en plus de la base de connaissances globale.
          </p>
          <KnowledgeManager scope="client" clientId={clientId} />
        </div>
      </div>
    </>
  );
}
