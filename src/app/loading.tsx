import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-8 py-10">
      <div className="flex flex-col items-center gap-3 text-[#9c8e7c]">
        <Loader2 className="size-8 animate-spin text-[#a35d4d]" />
        <p className="text-sm">Loading…</p>
      </div>
    </div>
  );
}
