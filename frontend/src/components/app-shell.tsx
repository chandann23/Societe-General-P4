import type { ReactNode } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface AppShellProps {
  children: ReactNode;
  title: string;
  description?: string;
  stickyHeader?: boolean;
  fullBleed?: boolean;
}

export function AppShell({ children, title, stickyHeader = false, fullBleed = false }: AppShellProps) {
  return (
    <>
      <header
        className={`flex h-16 shrink-0 items-center justify-between border-b border-border px-6 ${
          stickyHeader ? "sticky top-0 z-20 bg-background/95 backdrop-blur" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
      </header>

      <main
        className={
          fullBleed
            ? "flex min-h-0 w-full flex-1 flex-col"
            : "mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-y-auto px-4 py-6 md:px-6 xl:px-8"
        }
      >
        {children}
      </main>
    </>
  );
}
