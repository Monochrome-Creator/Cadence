"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LayoutGrid,
  Layers,
  LogOut,
  Timer,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { getSupabaseClient, isSupabaseConfigured } from "@/utils/supabase/client";
import { TimerWidget } from "@/components/timer-widget";

/** Desktop sidebar links. The Pomodoro timer is the widget below, not a link. */
const NAV_LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/board", label: "Board", icon: LayoutGrid },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
];

/**
 * Mobile bottom-bar links. Adds a Timer tab (the desktop sidebar's timer widget
 * is hidden on phones) and keeps Home reachable. Labels are kept short so four
 * thumb-sized tabs sit comfortably on narrow screens.
 */
const MOBILE_NAV_LINKS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/board", label: "Board", icon: LayoutGrid },
  { href: "/timer", label: "Timer", icon: Timer },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
];

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

/**
 * Shows the signed-in email and a sign-out control. Renders nothing when cloud
 * auth isn't configured or no one is signed in (local-only mode).
 */
export function AccountFooter() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured || !email) return null;

  const signOut = async () => {
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/60 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-[#6b5f50]" title={email}>
          {email}
        </p>
        <p className="text-[10px] text-[#9c8e7c]">Synced</p>
      </div>
      <button
        type="button"
        onClick={signOut}
        title="Sign out"
        aria-label="Sign out"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#9c8e7c] transition-colors hover:bg-[#f6e0e0] hover:text-[#9b3b3b]"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  if (isAuthRoute(pathname)) return null;

  return (
    <aside className="mr-3 hidden w-64 shrink-0 flex-col rounded-3xl bg-[#f2eadc] p-4 text-[#4a4036] shadow-[0_1px_3px_rgba(74,64,54,0.06)] md:flex">
      <div className="flex items-center gap-3 px-3 py-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white font-heading text-xl font-semibold text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]">
          C
        </span>
        <div className="leading-tight">
          <span className="font-heading text-2xl font-semibold tracking-tight text-[#4a4036]">
            Cadence
          </span>
          <p className="text-xs tracking-wide text-[#9c8e7c]">Your life vault</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const active = isActiveRoute(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all",
                active
                  ? "bg-white text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]"
                  : "text-[#6b5f50] hover:bg-white/50 hover:text-[#4a4036]"
              )}
            >
              <Icon className={cn("size-4", active && "text-[#a35d4d]")} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="pt-3">
        <TimerWidget />
        <AccountFooter />
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

  if (isAuthRoute(pathname)) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-[#e8e0d5] bg-[#f2eadc]/95 px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] backdrop-blur md:hidden">
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
                ? "bg-white text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]"
                : "text-[#6b5f50] hover:text-[#4a4036]"
            )}
          >
            <Icon className={cn("size-5", active && "text-[#a35d4d]")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
