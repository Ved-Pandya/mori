import { cookies } from "next/headers";
import { sessionCookie, validSession } from "@/lib/mori-auth";
import { getMangaFireChapters, getMangaFireDetails, getMangaFirePages, listMangaFireTitles, MangaFireError } from "@/lib/sources/mangafire";

export const runtime = "nodejs";
export const maxDuration = 30;

function proxiedImageUrl(sourceUrl: string, requestUrl: string) {
  const proxy = new URL("/api/sources/mangafire", requestUrl);
  proxy.searchParams.set("action", "image");
  proxy.searchParams.set("url", sourceUrl);
  return `${proxy.pathname}${proxy.search}`;
}

const isMangaFireImage = (url: URL) => url.protocol === "https:" && /^(?:[a-z0-9-]+\.)*mfcdn\d*\.xyz$/i.test(url.hostname);

export async function GET(request: Request) {
  const jar = await cookies();
  if (!validSession(jar.get(sessionCookie)?.value)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "popular";

  try {
    if (action === "image") {
      const sourceUrl = url.searchParams.get("url") ?? "";
      let target: URL;
      try { target = new URL(sourceUrl); } catch { return Response.json({ error: "Invalid image URL." }, { status: 400 }); }
      if (!isMangaFireImage(target)) return Response.json({ error: "Image host is not allowed." }, { status: 403 });
      const image = await fetch(target, { signal: AbortSignal.timeout(15000), cache: "force-cache", headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", Referer: "https://mangafire.to/", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36" } });
      if (!image.ok || !image.body) return Response.json({ error: `Image source returned ${image.status}.` }, { status: 502 });
      return new Response(image.body, { headers: { "Cache-Control": "private, max-age=43200", "Content-Type": image.headers.get("Content-Type") ?? "image/jpeg", "X-Content-Type-Options": "nosniff" } });
    }

    if (action === "pages") {
      const chapterId = Number(url.searchParams.get("chapterId"));
      if (!Number.isSafeInteger(chapterId) || chapterId <= 0) return Response.json({ error: "A valid chapterId is required." }, { status: 400 });
      const pages = await getMangaFirePages(chapterId);
      return Response.json({ pages: pages.map(page => ({ ...page, url: proxiedImageUrl(page.url, request.url) })) });
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
