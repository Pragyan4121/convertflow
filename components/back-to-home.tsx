"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BackToHome() {
  const pathname = usePathname();

  // Do not show on homepage
  if (pathname === "/") {
    return null;
  }

  return (
    <div className="fixed left-4 top-4 z-[9999]">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/95 px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm backdrop-blur transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
      >
        <span aria-hidden="true">←</span>
        Back to Home
      </Link>
    </div>
  );
}
