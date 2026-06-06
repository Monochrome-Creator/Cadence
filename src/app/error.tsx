"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-8 py-10">
      <div className="flex max-w-md flex-col items-center rounded-3xl border border-[var(--c-line)] bg-[var(--c-panel)] p-10 text-center shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[var(--c-beige-2)] text-[#a35d4d]">
          <TriangleAlert className="size-7" />
        </div>
        <h2 className="font-heading text-2xl font-semibold text-[var(--c-ink-2)]">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-[var(--c-dim)]">
          We hit an unexpected snag. You can try again, and if it keeps
          happening, refresh the page.
        </p>
        {/* TEMPORARY DIAGNOSTIC: surface the raw error on-screen (incl. mobile)
            so production failures can be read without devtools. Remove once the
            underlying issue is identified. */}
        <pre className="mt-4 max-h-48 w-full overflow-auto rounded-lg border-2 border-red-500 bg-red-50 px-3 py-2 text-left text-xs break-words whitespace-pre-wrap text-red-900">
          <strong className="block text-red-700">DEBUG · error.message</strong>
          {error.message || "(empty)"}
          {"\n\n"}
          <strong className="block text-red-700">error.digest</strong>
          {error.digest || "(none)"}
        </pre>
        <Button
          onClick={() => unstable_retry()}
          className="mt-6 bg-[#a35d4d] text-white hover:bg-[#8f4f41]"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}
