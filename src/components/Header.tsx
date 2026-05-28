"use client";

import { Settings, Search } from "lucide-react";
import { Emblem } from "./Emblem";
import { ProjectSwitcher } from "./ProjectSwitcher";
import type { Project } from "@/lib/client/types";

type User = {
  email: string;
  image?: string | null;
  name?: string | null;
};

type Props = {
  user: User;
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onProjectsChanged: () => void | Promise<void>;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
};

export function Header({
  user,
  projects,
  activeProjectId,
  onSelectProject,
  onProjectsChanged,
  onOpenSettings,
  onOpenSearch,
}: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-elevated px-6">
      <div className="flex items-center gap-3">
        <Emblem size={32} className="h-8 w-8 shrink-0" />
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-semibold tracking-tight text-fg">
            Duksoo Code
          </span>
          <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg">
            DS Code
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenSearch}
          className="hidden items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:bg-bg-sunken md:flex"
          title="검색 (Cmd/Ctrl+K)"
        >
          <Search className="h-3.5 w-3.5" />
          <span>검색</span>
          <kbd className="rounded border border-border bg-bg-elevated px-1 py-0.5 font-mono text-[10px] text-fg-subtle">
            ⌘K
          </kbd>
        </button>
        <ProjectSwitcher
          projects={projects}
          activeId={activeProjectId}
          onSelect={onSelectProject}
          onCreated={onProjectsChanged}
          onDeleted={onProjectsChanged}
        />
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2 py-1 transition-colors hover:border-border-strong hover:bg-bg-sunken"
          title={user.email}
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded-full"
            />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-sunken text-[11px] font-semibold text-fg-muted">
              {user.email[0]?.toUpperCase()}
            </div>
          )}
          <span className="hidden max-w-[160px] truncate text-xs text-fg-muted md:inline">
            {user.email}
          </span>
        </button>
        <button
          onClick={onOpenSettings}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
          title="설정"
          aria-label="설정"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
