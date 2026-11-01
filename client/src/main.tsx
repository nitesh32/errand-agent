import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import { readStorage, THEME_KEY } from './storage.ts';
import '../styles/theme.css';
import '../styles/app.css';

// Refetching happens when a chat opens. Focus changes alone never change the server's state.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Applied here, so the first-load skeleton already has the saved theme.
document.documentElement.dataset.theme = readStorage(THEME_KEY, 'light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
