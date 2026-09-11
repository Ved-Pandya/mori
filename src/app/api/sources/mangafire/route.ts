import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { sessionCookie, validSession } from "@/lib/mori-auth";
import { getMangaFireChapters, getMangaFireDetails, getMangaFirePages, listMangaFireTitles, MangaFireError } from "@/lib/sources/mangafire";

export const runtime = "nodejs";
export const maxDuration = 30;

function proxiedImageUrl(sourceUrl: string) {
  const workerUrl = process.env.MORI_WORKER_URL;
  const token = process.env.MORI_API_TOKEN;
  if (!workerUrl || !token) throw new Error("The image proxy is not configured.");
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const signature = createHmac("sha256", token).update(`${expires}\n${sourceUrl}`).digest("base64url");
  const proxy = new URL("/api/image", workerUrl);
  proxy.searchParams.set("url", sourceUrl);
  proxy.searchParams.set("expires", String(expires));
  proxy.searchParams.set("signature", signature);
  return proxy.toString();
}

export async function GET(request: Request) {
  const jar = await cookies();
  if (!validSession(jar.get(sessionCookie)?.value)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "popular";

  try {
    if (action === "pages") {
      const chapterId = Number(url.searchParams.get("chapterId"));
      if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return Response.json({ error: "A valid chapterId is required." }, { status: 400 });
      const pages = await getMangaFirePages(chapterId);
      return Response.json({ pages: pages.map(page => ({ ...page, url: proxiedImageUrl(page.url) })) });
    }

    if (action === "details") {
      const hid = url.searchParams.get("hid")?.trim();
      if (!hid) return Response.json({ error: "hid is required." }, { status: 400 });
      const [details, chapters] = await Promise.all([getMangaFireDetails(hid), getMangaFireChapters(hid)]);
      return Response.json({ details, chapters });
    }

    if (action !== "popular" && action !== "latest" && action !== "search") return Response.json({ error: "Unknown source action." }, { status: 400 });
    const result = await listMangaFireTitles({ type: action, query: url.searchParams.get("q") ?? undefined, page: Number(url.searchParams.get("page")) || 1 });
    return Response.json({ items: result.items ?? [], hasNext: result.meta?.hasNext ?? false });
  } catch (error) {
    if (error instanceof MangaFireError) return Response.json({ error: error.message, sourceStatus: error.status }, { status: error.status === 403 ? 503 : 502 });
    console.error("MangaFire adapter failed", error);
    return Response.json({ error: "MangaFire is temporarily unavailable." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const jar = await cookies();
  if (!validSession(jar.get(sessionCookie)?.value)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await request.json() as { entries?: Array<{ id?: string; hid?: string }> };
  const entries = (payload.entries ?? []).filter((entry): entry is { id: string; hid: string } => Boolean(entry.id && entry.hid)).slice(0, 5);
  if (!entries.length) return Response.json({ error: "No MangaFire entries supplied." }, { status: 400 });
  const updates: Array<{ id: string; latestChapter: number }> = [];
  const errors: Array<{ id: string; error: string }> = [];
  for (const entry of entries) {
    try {
      const details = await getMangaFireDetails(entry.hid);
      if (Number.isFinite(details.latestChapter)) updates.push({ id: entry.id, latestChapter: Number(details.latestChapter) });
      else errors.push({ id: entry.id, error: "No chapter baseline returned." });
    } catch (error) {
      errors.push({ id: entry.id, error: error instanceof Error ? error.message : "Refresh failed." });
    }
  }
  return Response.json({ updates, errors });
}
