import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center px-8 py-10">
      <div className="flex max-w-md flex-col items-center rounded-3xl border border-[#e8e0d5] bg-white p-10 text-center shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
        <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[#f7eee4] text-[#a35d4d]">
          <Compass className="size-7" />
        </div>
        <h2 className="font-heading text-2xl font-semibold text-[#4a4036]">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-[#9c8e7c]">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-md bg-[#a35d4d] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#8f4f41]"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
