export interface Env {
  DB: D1Database;
  API_TOKEN: string;
}

type ImportManga = {
  id: string;
  title: string;
  source: string;
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

export default {
  async fetch(request, env): Promise<Response> {
    const origin = originFor(request);
    if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" } });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, origin);

    if (url.pathname.startsWith("/api/") && !isAuthorized(request, env)) return json({ error: "Unauthorized" }, 401, origin);

    if (request.method === "GET" && url.pathname === "/api/library") {
      const { results } = await env.DB.prepare(`SELECT manga.id, manga.title, manga.source_name AS source, manga.cover_url, manga.chapter_count AS chapters, manga.unread_count AS unread, COALESCE((SELECT json_group_array(categories.name) FROM manga_categories JOIN categories ON categories.id = manga_categories.category_id WHERE manga_categories.manga_id = manga.id), '[]') AS categories_json, COALESCE(reading_progress.progress_percent, 0) AS progress, reading_progress.last_read_at FROM manga LEFT JOIN reading_progress ON reading_progress.manga_id = manga.id WHERE manga.in_library = 1 ORDER BY manga.title`).all();
      const manga = results.map((row) => { const item = row as Record<string, unknown>; const categories = JSON.parse(String(item.categories_json || "[]")) as string[]; const { categories_json: _, ...rest } = item; void _; return { ...rest, categories, category: categories[0] || "Uncategorized" }; });
      return json({ manga }, 200, origin);
    }

    if (request.method === "POST" && url.pathname === "/api/library/import") {
      const payload = await request.json() as { manga?: ImportManga[] };
      const manga = payload.manga ?? [];
      if (!manga.length) return json({ error: "No manga supplied." }, 400, origin);
      const statements = manga.flatMap((item) => {
        const source = sourceId(item.source);
        const categories = [...new Set((item.categories?.length ? item.categories : [item.category]).filter(Boolean))];
        return [
          env.DB.prepare("INSERT INTO sources (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(source, item.source),
          env.DB.prepare("INSERT INTO manga (id, source_id, title, source_name, chapter_count, unread_count, in_library, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch()) ON CONFLICT(id) DO UPDATE SET title = excluded.title, source_name = excluded.source_name, chapter_count = excluded.chapter_count, unread_count = excluded.unread_count, updated_at = unixepoch()").bind(item.id, source, item.title, item.source, item.chapters, item.unread),
          env.DB.prepare("DELETE FROM manga_categories WHERE manga_id = ?").bind(item.id),
          ...categories.flatMap((name) => [
            env.DB.prepare("INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name").bind(categoryId(name), name),
            env.DB.prepare("INSERT INTO manga_categories (manga_id, category_id) VALUES (?, ?)").bind(item.id, categoryId(name)),
          ]),
          env.DB.prepare("INSERT INTO reading_progress (manga_id, progress_percent, last_read_at) VALUES (?, ?, unixepoch()) ON CONFLICT(manga_id) DO UPDATE SET progress_percent = excluded.progress_percent").bind(item.id, Math.max(0, Math.min(100, item.progress))),
        ];
      });
      for (let index = 0; index < statements.length; index += 250) await env.DB.batch(statements.slice(index, index + 250));
      return json({ imported: manga.length }, 201, origin);
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
