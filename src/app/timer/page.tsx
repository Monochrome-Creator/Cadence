import { AccountFooter } from "@/components/sidebar";
import { TimerWidget } from "@/components/timer-widget";
import { MementoMoriGrid } from "@/components/memento-mori";

/**
 * Dedicated focus-timer route. On desktop the Pomodoro timer also lives in the
 * sidebar, but that sidebar is hidden on phones — so this page is how mobile
 * users reach the timer via the bottom navigation bar. Also hosts Memento
 * Mori, the life-in-weeks grid — grouped here under "Timer" since both are
 * about how time is spent.
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

        <div className="mt-8">
          <MementoMoriGrid />
        </div>

        {/* Sign-out lives in the sidebar on desktop; surface it here for phones. */}
        <div className="mt-4 md:hidden">
          <AccountFooter />
        </div>
      </div>
    </div>
  );
}
