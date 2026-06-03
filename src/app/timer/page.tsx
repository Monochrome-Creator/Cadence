import { AccountFooter } from "@/components/sidebar";
import { TimerWidget } from "@/components/timer-widget";

/**
 * Dedicated focus-timer route. On desktop the Pomodoro timer also lives in the
 * sidebar, but that sidebar is hidden on phones — so this page is how mobile
 * users reach the timer via the bottom navigation bar.
 */
export default function TimerPage() {
  return (
    <div className="px-6 py-10 md:px-8">
      <div className="mx-auto max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-[var(--c-ink-2)]">
            Focus Timer
          </h1>
          <p className="mt-2 text-sm text-[var(--c-dim)]">
            Work in calm, focused intervals.
          </p>
        </header>

        <TimerWidget />

        {/* Sign-out lives in the sidebar on desktop; surface it here for phones. */}
        <div className="mt-4 md:hidden">
          <AccountFooter />
        </div>
      </div>
    </div>
  );
}
