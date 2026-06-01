import { WifiOff } from "lucide-react";

/**
 * Offline fallback. The service worker serves this cached page whenever a
 * navigation request fails because the device has no network connection.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-8 py-10">
      <div className="flex max-w-md flex-col items-center rounded-3xl border border-[#e8e0d5] bg-white p-10 text-center shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[#f7eee4] text-[#a35d4d]">
          <WifiOff className="size-7" />
        </div>
        <h2 className="font-heading text-2xl font-semibold text-[#4a4036]">
          You&apos;re offline
        </h2>
        <p className="mt-2 text-sm text-[#9c8e7c]">
          Cadence can&apos;t reach the network right now. Your saved work is
          still on this device — reconnect to pick up where you left off.
        </p>
      </div>
    </div>
  );
}
