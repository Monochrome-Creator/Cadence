"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

/**
 * The non-standard `beforeinstallprompt` event (Chromium only). Not in the DOM
 * lib types, so we model the slice we use.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "cadence-install-dismissed";

/**
 * Two jobs, both client-only:
 *   1. Register the service worker (`/sw.js`) so offline support kicks in.
 *   2. Auto-present a custom "Add to Home Screen" prompt.
 *        - Chromium: captures `beforeinstallprompt` and triggers the native
 *          installer on click.
 *        - iOS Safari (no `beforeinstallprompt`): shows manual Share-sheet
 *          instructions instead.
 *
 * Hidden when already installed (standalone display mode) or after the user
 * dismisses it (remembered in localStorage). Renders nothing until needed.
 */
export function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isIOS, setIsIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  // Register the service worker once.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures shouldn't break the app.
      });
    }
  }, []);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari exposes this non-standard flag when launched from home screen.
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    if (localStorage.getItem(DISMISSED_KEY) === "1") return;

    const ios =
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
      !("MSStream" in window);

    if (ios) {
      // One-time feature detection that depends on browser-only APIs; it must
      // run after mount so the server render (which shows nothing) matches.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsIOS(true);
      setVisible(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    const onInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:bottom-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-[#e8e0d5] bg-white p-4 shadow-[0_8px_30px_rgba(74,64,54,0.18)]">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#f7eee4] text-[#a35d4d]">
          <Download className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold text-[#4a4036]">
            Install Cadence
          </p>
          {isIOS ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs leading-snug text-[#9c8e7c]">
              Tap
              <Share className="inline size-3.5 shrink-0" aria-label="Share" />
              then &ldquo;Add to Home Screen&rdquo;.
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-snug text-[#9c8e7c]">
              Add it to your home screen for a full-screen, app-like experience.
            </p>
          )}
        </div>
        {!isIOS && (
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-md bg-[#a35d4d] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#8f4f41]"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1.5 text-[#b3a692] transition-colors hover:bg-[#f2eadc] hover:text-[#6b5f50]"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
