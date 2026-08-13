"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readCursor } from "@/lib/cursor";
import type { LicenceCode } from "@/lib/blueprint";

/**
 * The "Start" link, pointed at wherever this learner has got to.
 *
 * The home page is rendered on the server and cannot know that, so the link
 * begins as attempt 1 of a fresh seed and is corrected once the stored position
 * is read. Rendering the server's href first rather than nothing keeps the card
 * clickable before hydration - a slow connection should still get a working
 * test, just not a continued one.
 */
export default function StartTest({
  code,
  seed,
  className,
  children,
}: {
  code: LicenceCode;
  /** Fresh seed from the server, used until the stored position is known. */
  seed: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState({ seed, attempt: 1 });

  useEffect(() => {
    const cursor = readCursor();
    if (cursor) setTarget({ seed: cursor.seed, attempt: cursor.nextAttempt });
  }, []);

  return (
    <Link
      href={`/test/${encodeURIComponent(target.seed)}/${target.attempt}?code=${code}`}
      className={className}
    >
      {children}
    </Link>
  );
}
