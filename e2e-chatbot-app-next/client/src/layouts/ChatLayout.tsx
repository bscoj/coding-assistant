import { Outlet } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useSession } from '@/contexts/SessionContext';
import { DatabricksLogo } from '@/components/DatabricksLogo';
import { DbIcon } from '@/components/ui/db-icon';
import { UserKeyIconIcon } from '@/components/icons';

export default function ChatLayout() {
  const { session, loading } = useSession();
  const isCollapsed = localStorage.getItem('sidebar:state') !== 'true';

  // Wait for session to load
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // No guest mode - redirect if no session
  if (!session?.user) {
    return (
      <div className="flex h-screen items-center justify-center bg-secondary">
        <div className="flex flex-col items-center gap-6">
          <DatabricksLogo height={20} />
          <div className="flex w-80 flex-col items-center gap-4 rounded-md border border-border bg-background p-10 shadow-[var(--shadow-db-lg)]">
            <DbIcon icon={UserKeyIconIcon} size={32} color="muted" />
            <div className="flex flex-col items-center gap-1.5 text-center">
              <h3>Authentication Required</h3>
              <p className="text-muted-foreground">
                Please authenticate using Databricks to access this application.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Get preferred username from session (if available from headers)
  const preferredUsername = session.user.preferredUsername ?? null;

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar user={session.user} preferredUsername={preferredUsername} />
      <SidebarInset className="h-svh overflow-hidden bg-background">
        <div className="flex flex-1 flex-col overflow-hidden bg-background md:mr-3 md:rounded-2xl md:border md:border-white/[0.08] md:bg-black/[0.18] md:shadow-[0_24px_80px_rgba(0,0,0,0.35)] md:backdrop-blur-xl">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
