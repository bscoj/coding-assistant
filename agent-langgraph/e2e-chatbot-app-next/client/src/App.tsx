import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { SessionProvider } from '@/contexts/SessionContext';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { DataStreamProvider } from '@/components/data-stream-provider';
import { Toaster } from 'sonner';
import RootLayout from '@/layouts/RootLayout';
import ChatLayout from '@/layouts/ChatLayout';

const NewChatPage = lazy(() => import('@/pages/NewChatPage'));
const ChatPage = lazy(() => import('@/pages/ChatPage'));

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <SessionProvider>
        <AppConfigProvider>
          <DataStreamProvider>
            <Toaster position="top-center" />
            <Routes>
              <Route path="/" element={<RootLayout />}>
                <Route element={<ChatLayout />}>
                  <Route
                    index
                    element={
                      <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/55">Loading chat…</div>}>
                        <NewChatPage />
                      </Suspense>
                    }
                  />
                  <Route
                    path="chat/:id"
                    element={
                      <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-white/55">Loading chat…</div>}>
                        <ChatPage />
                      </Suspense>
                    }
                  />
                </Route>
              </Route>
            </Routes>
          </DataStreamProvider>
        </AppConfigProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

export default App;
