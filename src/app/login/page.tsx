"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Sparkles } from "lucide-react";

import { getSupabaseClient, isSupabaseConfigured } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "signin" | "signup";
type Feedback = { tone: "error" | "success"; text: string } | null;

/** Read a query param without useSearchParams (avoids the CSR Suspense bailout). */
function readParam(key: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [useMagicLink, setUseMagicLink] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Where to send the user after auth. Read once from the URL; not rendered, so
  // a server/client value difference is harmless.
  const [nextPath] = useState(() => {
    const next = readParam("next");
    return next.startsWith("/") ? next : "/";
  });

  // Surface an expired/invalid magic-link error after mount (avoids a hydration
  // mismatch — server and client both render no feedback initially).
  useEffect(() => {
    if (readParam("error") === "link") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init from the URL
      setFeedback({
        tone: "error",
        text: "That sign-in link was invalid or expired. Please try again.",
      });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setFeedback({
        tone: "error",
        text: "Cloud sync isn't configured yet. You can keep using Cadence locally.",
      });
      return;
    }

    setLoading(true);
    try {
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        nextPath
      )}`;

      if (useMagicLink) {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo, shouldCreateUser: true },
        });
        if (error) throw error;
        setFeedback({
          tone: "success",
          text: `We've sent a magic link to ${email}. Check your inbox to continue.`,
        });
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(nextPath);
          router.refresh();
          return;
        }
        setFeedback({
          tone: "success",
          text: `Almost there — confirm your email (${email}) to activate your account.`,
        });
        return;
      }

      // Sign in with password.
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setFeedback({
        tone: "error",
        text:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-1.5rem)] items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        {/* Brand mark */}
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[var(--c-beige)] font-heading text-2xl font-semibold text-[#a35d4d] shadow-[0_1px_3px_rgba(74,64,54,0.08)]">
            C
          </span>
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-[var(--c-ink-2)]">
            {mode === "signin" ? "Welcome back" : "Join Cadence"}
          </h1>
          <p className="mt-2 text-sm text-[var(--c-dim)]">
            {mode === "signin"
              ? "Sign in to sync your board across every device."
              : "Create an account to keep your focus in flow."}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel-soft)] p-6 shadow-[0_8px_30px_rgba(74,64,54,0.07)] backdrop-blur sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="px-1 text-xs font-semibold tracking-wide text-[var(--c-dim)] uppercase"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 border-[var(--c-line-strong)] bg-[var(--c-panel)] text-[var(--c-ink-2)] shadow-none focus-visible:border-[#a35d4d]"
              />
            </div>

            {!useMagicLink && (
              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="px-1 text-xs font-semibold tracking-wide text-[var(--c-dim)] uppercase"
                >
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  required={!useMagicLink}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 border-[var(--c-line-strong)] bg-[var(--c-panel)] text-[var(--c-ink-2)] shadow-none focus-visible:border-[#a35d4d]"
                />
              </div>
            )}

            {feedback && (
              <p
                className={cn(
                  "rounded-xl px-3 py-2.5 text-sm",
                  feedback.tone === "error"
                    ? "bg-[#f6e0e0] text-[#9b3b3b]"
                    : "bg-[#e3ece0] text-[#4d7049]"
                )}
              >
                {feedback.text}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full bg-[#a35d4d] text-white hover:bg-[#8f4f41] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : useMagicLink ? (
                <>
                  <Mail className="size-4" /> Send magic link
                </>
              ) : mode === "signin" ? (
                "Sign in"
              ) : (
                "Create account"
              )}
            </Button>
          </form>

          {/* Magic-link toggle */}
          <button
            type="button"
            onClick={() => {
              setUseMagicLink((v) => !v);
              setFeedback(null);
            }}
            className="mt-4 flex w-full items-center justify-center gap-1.5 text-sm font-medium text-[#a35d4d] transition-colors hover:text-[#8f4f41]"
          >
            <Sparkles className="size-3.5" />
            {useMagicLink
              ? "Use a password instead"
              : "Email me a magic link instead"}
          </button>
        </div>

        {/* Mode switch */}
        <p className="mt-6 text-center text-sm text-[var(--c-dim)]">
          {mode === "signin" ? "New to Cadence?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "signin" ? "signup" : "signin"));
              setFeedback(null);
            }}
            className="font-semibold text-[#a35d4d] transition-colors hover:text-[#8f4f41]"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>

        {/* Plain <a> (not <Link>): /reset is a route handler whose
            Clear-Site-Data header only takes effect on a full document load. */}
        <p className="mt-4 text-center text-xs text-[var(--c-faint)]">
          Trouble loading the app?{" "}
          <a
            href="/reset"
            className="font-medium text-[var(--c-dim)] underline transition-colors hover:text-[#a35d4d]"
          >
            Reset this device
          </a>
        </p>

        {!isSupabaseConfigured && (
          <p className="mt-6 rounded-xl bg-[var(--c-beige)] px-4 py-3 text-center text-xs text-[#8a7d6b]">
            Cloud sync isn&apos;t set up yet. Add your Supabase keys to{" "}
            <code className="font-mono">.env.local</code> to enable accounts, or{" "}
            <Link href="/" className="font-semibold text-[#a35d4d] underline">
              keep using Cadence locally
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
