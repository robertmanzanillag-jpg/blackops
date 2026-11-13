// Test-only entry: real route/page/CompanyOffice; native auth cache is a fixture.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route } from 'wouter';
import AgentsOfficePage from '../../client/src/pages/agents-office';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
function Harness() {
  const [owner, setOwner] = useState('fixture-user');
  (window as unknown as { setFixtureOwner: (owner: string) => void }).setFixtureOwner = setOwner;
  client.setQueryData(['auth-me'], { authenticated: true, user: { id: owner } });
  return <QueryClientProvider client={client}>
    <p role="note" style={{ background: '#f6c861', color: '#201b12', padding: 16 }}>HARNESS · DATOS DE PRUEBA · Todas las solicitudes interceptadas. Sin conexiones reales.</p>
    <Route path="/agents-office"><AgentsOfficePage key={owner} /></Route>
  </QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
