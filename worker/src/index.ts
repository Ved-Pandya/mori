type Env = Cloudflare.Env & {
  API_TOKEN: string;
};

type ImportManga = {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  coverUrl?: string;
  latestChapter?: number;
  category: string;
  categories?: string[];
  chapters: number;
  unread: number;
  progress: number;
};

const json = (data: unknown, status = 200, origin = "*") => Response.json(data, { status, headers: { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } });
const originFor = (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  return origin.startsWith("http://localhost:") || origin.endsWith(".vercel.app") ? origin : "*";
};

const isAuthorized = (request: Request, env: Env) => request.headers.get("Authorization") === `Bearer ${env.API_TOKEN}`;
const sourceId = (name: string) => `source:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const categoryId = (name: string) => `category:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
const normalizedTitle = (title: string) => title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const providerKey = (item: { id: string; source: string }) => {
  if (item.source.toLocaleLowerCase() !== "mangafire") return null;
  const match = item.id.match(/(?:\/title\/([a-z0-9]+)-[^/]+|\/manga\/[^/]+\.([a-z0-9]+))\/?$/i);
  return match ? `mangafire:${(match[1] || match[2]).toLocaleLowerCase()}` : null;
};

type DuplicateItem = {
  id: string;
  title: string;
  source: string;
  chapters: number;
  unread: number;
  progress: number;
  last_read_at: number | null;
  categories: string[];
};

type DuplicateGroup = {
  id: string;
  reason: "Same provider entry" | "Same title";
  confidence: "strong" | "review";
  items: DuplicateItem[];
};

export default {
  async fetch(request, env): Promise<Response> {
    const origin = originFor(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" } });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, origin);

    if (url.pathname.startsWith("/api/") && !isAuthorized(request, env)) return json({ error: "Unauthorized" }, 401, origin);

    if (request.method === "GET" && url.pathname === "/api/library") {
      const { results } = await env.DB.prepare(`SELECT manga.id, manga.title, manga.source_name AS source, manga.source_url, manga.cover_url, manga.latest_chapter_number, manga.chapter_count AS chapters, manga.unread_count AS unread, COALESCE((SELECT json_group_array(categories.name) FROM manga_categories JOIN categories ON categories.id = manga_categories.category_id WHERE manga_categories.manga_id = manga.id), '[]') AS categories_json, COALESCE(reading_progress.progress_percent, 0) AS progress, reading_progress.last_read_at FROM manga LEFT JOIN reading_progress ON reading_progress.manga_id = manga.id WHERE manga.in_library = 1 ORDER BY manga.title`).all();
      const manga = results.map((row) => { const item = row as Record<string, unknown>; const categories = JSON.parse(String(item.categories_json || "[]")) as string[]; const { categories_json: _, ...rest } = item; void _; return { ...rest, categories, category: categories[0] || "Uncategorized" }; });
      return json({ manga }, 200, origin);
    }

    if (request.method === "GET" && url.pathname === "/api/library/duplicates") {
      const { results } = await env.DB.prepare(`SELECT manga.id, manga.title, manga.source_name AS source, manga.chapter_count AS chapters, manga.unread_count AS unread, COALESCE(reading_progress.progress_percent, 0) AS progress, reading_progress.last_read_at, COALESCE((SELECT json_group_array(categories.name) FROM manga_categories JOIN categories ON categories.id = manga_categories.category_id WHERE manga_categories.manga_id = manga.id), '[]') AS categories_json FROM manga LEFT JOIN reading_progress ON reading_progress.manga_id = manga.id WHERE manga.in_library = 1 ORDER BY manga.title`).all();
      const items = results.map((row) => {
        const item = row as Record<string, unknown>;
        return {
          id: String(item.id), title: String(item.title), source: String(item.source),
          chapters: Number(item.chapters) || 0, unread: Number(item.unread) || 0,
          progress: Number(item.progress) || 0, last_read_at: item.last_read_at == null ? null : Number(item.last_read_at),
          categories: JSON.parse(String(item.categories_json || "[]")) as string[],
        } satisfies DuplicateItem;
      });

      const groups: DuplicateGroup[] = [];
      const seen = new Set<string>();
      const addGroups = (buckets: Map<string, DuplicateItem[]>, reason: DuplicateGroup["reason"], confidence: DuplicateGroup["confidence"]) => {
        for (const [key, candidates] of buckets) {
          if (candidates.length < 2) continue;
          const signature = candidates.map((item) => item.id).sort().join("|");
          if (seen.has(signature)) continue;
          seen.add(signature);
          groups.push({ id: `${confidence}:${key}`, reason, confidence, items: candidates });
        }
      };

      const providerGroups = new Map<string, DuplicateItem[]>();
      for (const item of items) {
        const key = providerKey(item);
        if (key) providerGroups.set(key, [...(providerGroups.get(key) ?? []), item]);
      }
      addGroups(providerGroups, "Same provider entry", "strong");

      const titleGroups = new Map<string, DuplicateItem[]>();
      for (const item of items) {
        const key = normalizedTitle(item.title);
        titleGroups.set(key, [...(titleGroups.get(key) ?? []), item]);
      }
      addGroups(titleGroups, "Same title", "review");

      groups.sort((left, right) => left.confidence === right.confidence ? left.items[0].title.localeCompare(right.items[0].title) : left.confidence === "strong" ? -1 : 1);
      return json({ groups }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/api/library/duplicates") {
      const payload = await request.json() as { canonicalId?: string; duplicateIds?: string[] };
      const canonicalId = payload.canonicalId?.trim();
      const duplicateIds = [...new Set((payload.duplicateIds ?? []).filter((id) => id && id !== canonicalId))];
      if (!canonicalId || !duplicateIds.length || duplicateIds.length > 20) return json({ error: "Choose one entry to keep and at least one to merge." }, 400, origin);

      const memberIds = [canonicalId, ...duplicateIds];
      const placeholders = memberIds.map(() => "?").join(",");
      const { results } = await env.DB.prepare(`SELECT manga.id, manga.title, manga.source_name AS source, manga.chapter_count, manga.unread_count, COALESCE(reading_progress.progress_percent, 0) AS progress, reading_progress.last_read_at FROM manga LEFT JOIN reading_progress ON reading_progress.manga_id = manga.id WHERE manga.id IN (${placeholders})`).bind(...memberIds).all();
      if (results.length !== memberIds.length) return json({ error: "One or more entries no longer exist. Refresh duplicate review." }, 409, origin);
      const canonical = results.find((row) => String(row.id) === canonicalId);
      const canonicalProvider = canonical ? providerKey({ id: canonicalId, source: String(canonical.source) }) : null;
      const validGroup = canonical && results.every((row) => {
        if (String(row.id) === canonicalId) return true;
        const sameTitle = normalizedTitle(String(row.title)) === normalizedTitle(String(canonical.title));
        const candidateProvider = providerKey({ id: String(row.id), source: String(row.source) });
        return sameTitle || Boolean(canonicalProvider && candidateProvider === canonicalProvider);
      });
      if (!validGroup) return json({ error: "These entries are not a recognized duplicate group." }, 400, origin);

      const mergedChapters = Math.max(...results.map((row) => Number(row.chapter_count) || 0));
      const readChapters = Math.max(...results.map((row) => Math.max(0, (Number(row.chapter_count) || 0) - (Number(row.unread_count) || 0))));
      const mergedUnread = Math.max(0, mergedChapters - readChapters);
      const mergedProgress = mergedChapters ? Math.round((readChapters / mergedChapters) * 100) : Math.max(...results.map((row) => Number(row.progress) || 0));
      const lastRead = Math.max(...results.map((row) => Number(row.last_read_at) || 0));
      const duplicatePlaceholders = duplicateIds.map(() => "?").join(",");
      const statements = [
        env.DB.prepare(`INSERT OR IGNORE INTO manga_categories (manga_id, category_id) SELECT ?, category_id FROM manga_categories WHERE manga_id IN (${duplicatePlaceholders})`).bind(canonicalId, ...duplicateIds),
        env.DB.prepare("UPDATE manga SET chapter_count = ?, unread_count = ?, updated_at = unixepoch() WHERE id = ?").bind(mergedChapters, mergedUnread, canonicalId),
        env.DB.prepare("INSERT INTO reading_progress (manga_id, progress_percent, last_read_at) VALUES (?, ?, ?) ON CONFLICT(manga_id) DO UPDATE SET progress_percent = excluded.progress_percent, last_read_at = excluded.last_read_at").bind(canonicalId, mergedProgress, lastRead),
        env.DB.prepare(`UPDATE manga_aliases SET canonical_id = ? WHERE canonical_id IN (${duplicatePlaceholders})`).bind(canonicalId, ...duplicateIds),
        ...duplicateIds.map((id) => env.DB.prepare("INSERT INTO manga_aliases (alias_id, canonical_id) VALUES (?, ?) ON CONFLICT(alias_id) DO UPDATE SET canonical_id = excluded.canonical_id").bind(id, canonicalId)),
        env.DB.prepare(`DELETE FROM manga WHERE id IN (${duplicatePlaceholders})`).bind(...duplicateIds),
      ];
      await env.DB.batch(statements);
      return json({ merged: duplicateIds.length, canonicalId }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/api/library/import") {
      const payload = await request.json() as { manga?: ImportManga[] };
      const supplied = payload.manga ?? [];
      if (!supplied.length) return json({ error: "No manga supplied." }, 400, origin);
      const { results: aliasRows } = await env.DB.prepare("SELECT alias_id FROM manga_aliases").all();
      const aliases = new Set(aliasRows.map((row) => String(row.alias_id)));
      const manga = supplied.filter((item) => !aliases.has(item.id));
      if (!manga.length) return json({ imported: 0, skippedAliases: supplied.length }, 200, origin);
      const statements = manga.flatMap((item) => {
        const source = sourceId(item.source);
        const categories = [...new Set((item.categories?.length ? item.categories : [item.category]).filter(Boolean))];
        return [
          env.DB.prepare("INSERT INTO sources (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(source, item.source),
          env.DB.prepare("INSERT INTO manga (id, source_id, title, source_name, source_url, cover_url, latest_chapter_number, chapter_count, unread_count, in_library, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch()) ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, title = excluded.title, source_name = excluded.source_name, source_url = COALESCE(excluded.source_url, manga.source_url), cover_url = COALESCE(excluded.cover_url, manga.cover_url), latest_chapter_number = COALESCE(excluded.latest_chapter_number, manga.latest_chapter_number), chapter_count = excluded.chapter_count, unread_count = excluded.unread_count, updated_at = unixepoch()").bind(item.id, source, item.title, item.source, item.sourceUrl ?? null, item.coverUrl ?? null, item.latestChapter ?? null, item.chapters, item.unread),
          env.DB.prepare("DELETE FROM manga_categories WHERE manga_id = ?").bind(item.id),
          ...categories.flatMap((name) => [
            env.DB.prepare("INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(categoryId(name), name),
            env.DB.prepare("INSERT INTO manga_categories (manga_id, category_id) VALUES (?, ?)").bind(item.id, categoryId(name)),
          ]),
          env.DB.prepare("INSERT INTO reading_progress (manga_id, progress_percent, last_read_at) VALUES (?, ?, unixepoch()) ON CONFLICT(manga_id) DO UPDATE SET progress_percent = excluded.progress_percent").bind(item.id, Math.max(0, Math.min(100, item.progress))),
        ];
      });
      for (let index = 0; index < statements.length; index += 250) await env.DB.batch(statements.slice(index, index + 250));
      return json({ imported: manga.length, skippedAliases: supplied.length - manga.length }, 201, origin);
    }

    if (request.method === "POST" && url.pathname === "/api/library/refresh") {
      const payload = await request.json() as { updates?: Array<{ id?: string; latestChapter?: number }> };
      const updates = (payload.updates ?? []).filter((item): item is { id: string; latestChapter: number } => Boolean(item.id) && Number.isFinite(item.latestChapter)).slice(0, 10);
      if (!updates.length) return json({ error: "No source updates supplied." }, 400, origin);
      const ids = updates.map((item) => item.id);
      const placeholders = ids.map(() => "?").join(",");
      const { results } = await env.DB.prepare(`SELECT id, chapter_count, unread_count, latest_chapter_number FROM manga WHERE id IN (${placeholders})`).bind(...ids).all();
      const rows = new Map(results.map((row) => [String(row.id), row]));
      const applied = updates.flatMap((update) => {
        const row = rows.get(update.id);
        if (!row) return [];
        const previous = row.latest_chapter_number == null ? null : Number(row.latest_chapter_number);
        const delta = previous == null || update.latestChapter <= previous ? 0 : Math.max(1, Math.floor(update.latestChapter - previous));
        return [{ id: update.id, latestChapter: update.latestChapter, delta, chapters: (Number(row.chapter_count) || 0) + delta, unread: (Number(row.unread_count) || 0) + delta }];
      });
      if (applied.length) await env.DB.batch(applied.map((item) => env.DB.prepare("UPDATE manga SET latest_chapter_number = ?, chapter_count = ?, unread_count = ?, updated_at = unixepoch() WHERE id = ?").bind(item.latestChapter, item.chapters, item.unread, item.id)));
      return json({ updates: applied }, 200, origin);
    }

    if (request.method === "PATCH" && url.pathname === "/api/library/progress") {
      const payload = await request.json() as { mangaId?: string; progress?: number; unread?: number };
      if (!payload.mangaId) return json({ error: "mangaId is required." }, 400, origin);
      const progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
      const unread = Math.max(0, Number(payload.unread) || 0);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO reading_progress (manga_id, progress_percent, last_read_at) VALUES (?, ?, unixepoch()) ON CONFLICT(manga_id) DO UPDATE SET progress_percent = excluded.progress_percent, last_read_at = unixepoch()").bind(payload.mangaId, progress),
        env.DB.prepare("UPDATE manga SET unread_count = ?, updated_at = unixepoch() WHERE id = ?").bind(unread, payload.mangaId),
      ]);
      return json({ saved: true }, 200, origin);
    }

    return json({ error: "Not found" }, 404, origin);
  },
} satisfies ExportedHandler<Env>;
