"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  LogIn,
  LogOut,
  Repeat,
  Target,
  Timer,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useProdStore, type Task } from "@/store/use-prod-store";
import { getSupabaseClient, isSupabaseConfigured } from "@/utils/supabase/client";
import { TimerWidget } from "@/components/timer-widget";
import { ThemeToggle } from "@/components/theme-toggle";

/** Desktop sidebar links. The Pomodoro timer is the widget below, not a link. */
const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Daily Plan", icon: CalendarDays },
  { href: "/board", label: "Workspace", icon: LayoutGrid },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/goals", label: "North Star", icon: Target },
  { href: "/recurring", label: "Scheduled", icon: Repeat },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
];

/**
 * Mobile bottom-bar links. Adds a Timer tab (the desktop sidebar's timer widget
 * is hidden on phones) and keeps Home reachable. Labels are kept short so four
 * thumb-sized tabs sit comfortably on narrow screens.
 */
const MOBILE_NAV_LINKS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/calendar", label: "Today", icon: CalendarDays },
  { href: "/board", label: "Work", icon: LayoutGrid },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/timer", label: "Timer", icon: Timer },
  { href: "/flashcards", label: "Cards", icon: Layers },
];

/** localStorage key remembering whether the desktop sidebar is minimized. */
const SIDEBAR_COLLAPSED_KEY = "cadence:sidebarCollapsed";

/** Shared active-route check for both desktop and mobile navigation. */
function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Auth screens render their own full-bleed layout — no app chrome. */
function isAuthRoute(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth");
}

/** Today as a local yyyy-MM-dd string, for lexical comparison with deadlines. */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Counts active tasks whose deadline is today or already past. "Active" excludes
 * Done (finished) and Inbox (untriaged) tasks. Deadlines are stored as ISO-ish
 * strings; we pull the yyyy-MM-dd and compare lexically against today.
 */
function countUrgentTasks(tasks: Task[]): number {
  const today = todayISO();
  return tasks.reduce((count, task) => {
    if (task.status === "Done" || task.status === "Inbox") return count;
    const iso = task.deadline?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return iso && iso <= today ? count + 1 : count;
  }, 0);
}

/**
 * Shows the signed-in email and a sign-out control. Renders nothing when cloud
 * auth isn't configured or no one is signed in (local-only mode).
 */
export function AccountFooter({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        setEmail(data.user?.email ?? null);
      })
      .catch(() => {
        // A stale mobile session should quietly stay in local-only mode.
        setEmail(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) return null;

  // Not logged in — show a sign-in prompt.
  if (!email) {
    return (
      <Link
        href="/login"
        title={collapsed ? "Sign in to sync" : undefined}
        className={cn(
          "mt-3 flex items-center rounded-2xl bg-[var(--c-panel-soft)] text-sm font-medium text-[var(--c-ink-3)] transition-colors hover:bg-[var(--c-beige-2)] hover:text-[#a35d4d]",
          collapsed ? "justify-center p-2.5" : "gap-2 px-3 py-2.5"
        )}
      >
        <LogIn className="size-4 shrink-0" />
        {!collapsed && "Sign in to sync"}
      </Link>
    );
  }

  const signOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  // Collapsed: just the sign-out icon, centered, with the email in the tooltip.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={signOut}
        title={`Signed in as ${email} — sign out`}
        aria-label="Sign out"
        className="mt-3 flex w-full items-center justify-center rounded-2xl bg-[var(--c-panel-soft)] p-2.5 text-[var(--c-dim)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
      >
        <LogOut className="size-4" />
      </button>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[var(--c-panel-soft)] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-[var(--c-ink-3)]" title={email}>
          {email}
        </p>
        <p className="text-[10px] text-[var(--c-dim)]">Synced</p>
      </div>
      <button
        type="button"
        onClick={signOut}
        title="Sign out"
        aria-label="Sign out"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--c-dim)] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  // Derive the urgent count with useMemo from the stable `tasks` reference —
  // computing inside the selector would return a new value each render.
  const tasks = useProdStore((state) => state.tasks);
  const urgentCount = useMemo(() => countUrgentTasks(tasks), [tasks]);

  // Minimize toggle: collapses the sidebar to an icon rail so the main view can
  // claim the freed width. Defaults expanded for a stable first paint, then
  // restores the saved preference on mount to avoid an SSR hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of persisted layout pref after hydration.
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Private-mode storage failures shouldn't break the toggle.
      }
      return next;
    });
  };

  if (isAuthRoute(pathname)) return null;

  return (
    <aside
      className={cn(
        "mr-3 hidden shrink-0 flex-col rounded-3xl bg-[var(--c-beige)] text-[var(--c-ink-2)] shadow-[0_1px_3px_rgba(74,64,54,0.06)] md:flex",
        collapsed ? "w-[72px] p-2" : "w-64 p-4"
      )}
    >
      <div
        className={cn(
          "flex items-center py-5",
          collapsed ? "flex-col gap-3 px-1" : "gap-3 px-3"
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--c-panel)] font-heading text-xl font-semibold text-[var(--c-accent)] shadow-[0_1px_3px_rgba(74,64,54,0.08)]">
          C
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-heading text-2xl font-semibold tracking-tight text-[var(--c-ink-2)]">
              Cadence
            </span>
            <p className="truncate text-xs tracking-wide text-[var(--c-dim)]">
              Your life vault
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Minimize sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Minimize sidebar"}
          aria-expanded={!collapsed}
          className="flex size-9 shrink-0 items-center justify-center rounded-2xl text-[var(--c-dim)] transition-colors hover:bg-[var(--c-panel-soft)] hover:text-[var(--c-ink-2)]"
        >
          {collapsed ? (
            <ChevronsRight className="size-4" />
          ) : (
            <ChevronsLeft className="size-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-1.5">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActiveRoute(pathname, href);
          const showBadge = href === "/board" && urgentCount > 0;
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "relative flex items-center rounded-2xl text-sm font-medium transition-all",
                collapsed ? "justify-center p-3" : "gap-3 px-4 py-3",
                active
                  ? "bg-[var(--c-panel)] text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]"
                  : "text-[var(--c-ink-3)] hover:bg-[var(--c-panel-soft)] hover:text-[var(--c-ink-2)]"
              )}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-[#a35d4d]")} />
              {!collapsed && <span className="flex-1">{label}</span>}
              {showBadge && !collapsed && (
                <span
                  title={`${urgentCount} task${
                    urgentCount === 1 ? "" : "s"
                  } due today or overdue`}
                  aria-label={`${urgentCount} urgent task${
                    urgentCount === 1 ? "" : "s"
                  }`}
                  className="flex min-w-[20px] items-center justify-center rounded-full bg-[#c2410c] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white"
                >
                  {urgentCount}
                </span>
              )}
              {showBadge && collapsed && (
                <span
                  aria-label={`${urgentCount} urgent task${
                    urgentCount === 1 ? "" : "s"
                  }`}
                  className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#c2410c]"
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="pt-3">
        {!collapsed && <TimerWidget />}
        <div className={cn("mt-3 flex items-center", collapsed ? "justify-center" : "justify-between gap-2 rounded-2xl bg-[var(--c-panel-soft)] px-3 py-2")}>
          {!collapsed && (
            <span className="text-xs font-medium text-[var(--c-ink-3)]">Appearance</span>
          )}
          <ThemeToggle size={36} />
        </div>
        <AccountFooter collapsed={collapsed} />
      </div>
    </aside>
  );
}

/**
 * Fixed bottom navigation bar shown only on mobile (md:hidden).
 * Mirrors the sidebar's routes in the terracotta/beige design system.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    }).catch(() => setEmail(null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (isAuthRoute(pathname)) return null;

  const showSignIn = isSupabaseConfigured && !email;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[var(--c-line)] bg-[var(--c-beige)]/95 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur md:hidden">
      {MOBILE_NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const active = isActiveRoute(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-medium transition-colors",
              active
                ? "bg-[var(--c-panel)] text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]"
                : "text-[var(--c-ink-3)] hover:text-[var(--c-ink-2)]"
            )}
          >
            <Icon className={cn("size-5", active && "text-[#a35d4d]")} />
            {label}
          </Link>
        );
      })}
      {showSignIn && (
        <Link
          href="/login"
          className="flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-2 py-1.5 text-[11px] font-medium text-[#a35d4d] transition-colors"
        >
          <LogIn className="size-5" />
          Sign in
        </Link>
      )}
    </nav>
  );
}
