import { cookies } from "next/headers";
import { sessionCookie, validSession } from "@/lib/mori-auth";

export const runtime = "nodejs";

async function proxy(request: Request) {
  const jar = await cookies();
  if (!validSession(jar.get(sessionCookie)?.value)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const base = process.env.MORI_WORKER_URL;
  const token = process.env.MORI_API_TOKEN;
  if (!base || !token) return Response.json({ error: "Cloud library is not configured." }, { status: 503 });
  const response = await fetch(`${base}/api/library/manage`, {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: await request.text(),
    cache: "no-store",
  });
  return new Response(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) { return proxy(request); }
export async function DELETE(request: Request) { return proxy(request); }

