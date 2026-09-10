import { cookies } from "next/headers";
import { sessionCookie, sessionValue, validPassword, validSession } from "@/lib/mori-auth";

export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  return Response.json({ authenticated: validSession(jar.get(sessionCookie)?.value) });
}

export async function POST(request: Request) {
  const { password } = await request.json() as { password?: string };
  if (!validPassword(password ?? "")) return Response.json({ error: "Incorrect passcode." }, { status: 401 });
  const jar = await cookies();
  jar.set(sessionCookie, sessionValue(), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return Response.json({ authenticated: true });
}
