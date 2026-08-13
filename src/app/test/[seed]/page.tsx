import { permanentRedirect } from "next/navigation";

/**
 * The address a paper used to live at, before attempts became part of it.
 *
 * A seed on its own no longer names one paper - it names a sequence of them -
 * so the old address is the first attempt in that sequence. Redirecting rather
 * than 404ing keeps every seed anyone has already shared working.
 */
export const dynamic = "force-dynamic";

export default async function LegacyTestPage({
  params,
  searchParams,
}: {
  params: Promise<{ seed: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { seed } = await params;
  const { code } = await searchParams;
  const query = code ? `?code=${encodeURIComponent(code)}` : "";
  permanentRedirect(`/test/${encodeURIComponent(seed)}/1${query}`);
}
