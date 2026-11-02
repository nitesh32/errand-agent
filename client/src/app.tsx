import { AppLayout } from './components/app-layout.tsx';
import { useChatApp } from './hooks/use-chat-app.ts';

export function App() {
  return <AppLayout app={useChatApp()} />;
}
