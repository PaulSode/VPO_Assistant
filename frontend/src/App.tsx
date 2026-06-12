import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { WorkspaceLayout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ClientsListPage } from './pages/ClientsListPage';
import { DashboardPage } from './pages/DashboardPage';
import { TicketsListPage } from './pages/TicketsListPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { ClientContextPage } from './pages/ClientContextPage';
import { AssistantPage } from './pages/AssistantPage';
import { SearchPage } from './pages/SearchPage';

export function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<ClientsListPage />} />

          {/* Every client page shares the navigation shell */}
          <Route path="/clients/:clientId" element={<WorkspaceLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="tickets" element={<TicketsListPage />} />
            <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
            <Route path="context" element={<ClientContextPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="assistant" element={<AssistantPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
