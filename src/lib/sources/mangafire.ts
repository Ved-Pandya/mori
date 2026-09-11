// VRF algorithm adapted from Keiyoushi's Apache-2.0 MangaFire extension:
// https://github.com/keiyoushi/extensions-source/tree/main/src/all/mangafire

const BASE_URL = "https://mangafire.to";

const STAGES = [
  {
    table: "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==",
    key: "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
    iv: 0x5a,
  },
  {
    table: "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==",
    key: "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
    iv: 0x35,
  },
  {
    table: "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ==",
    key: "DELOJgPsVaCcblDtTGMdHzM=",
    iv: 0xba,
  },
] as const;

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export function signMangaFirePath(path: string) {
  let data = new TextEncoder().encode(path);
  for (const stage of STAGES) {
    const table = decodeBase64(stage.table);
    const key = decodeBase64(stage.key);
    const output = new Uint8Array(data.length);
    let previous: number = stage.iv;
    for (let index = 0; index < data.length; index += 1) {
      previous = table[(data[index] ^ key[index % key.length] ^ previous) & 0xff];
      output[index] = previous;
    }
    data = output;
  }
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signedUrl(path: string, parameters: Array<[string, string]>) {
  const sorted = [...parameters].sort(([left], [right]) => left.localeCompare(right));
  const signingQuery = sorted.map(([key, value]) => `${key}=${value}`).join("&");
  const signingPath = `${path.replace(/^\/api/, "")}${signingQuery ? `?${signingQuery}` : ""}`;
  const url = new URL(path, BASE_URL);
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  url.searchParams.set("vrf", signMangaFirePath(signingPath));
  return url;
}

type ApiMeta = { lastPage?: number; hasNext?: boolean };
type ApiResponse<T> = { items?: T[]; meta?: ApiMeta };

export type MangaFireTitle = {
  hid: string;
  slug?: string;
  title: string;
  type?: string;
  status?: string;
  latestChapter?: number;
  poster?: { small?: string; medium?: string; large?: string };
};

export type MangaFireDetails = MangaFireTitle & {
  type?: string;
  status?: string;
  synopsisHtml?: string;
  authors?: Array<{ title: string }>;
  artists?: Array<{ title: string }>;
  genres?: Array<{ title: string }>;
  themes?: Array<{ title: string }>;
};

export type MangaFireChapter = {
  id: number;
  number: number;
  name?: string;
  createdAt?: number;
  type?: string;
};

export class MangaFireError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function requestJson<T>(path: string, parameters: Array<[string, string]> = []): Promise<T> {
  const url = signedUrl(path, parameters);
  const headers: Record<string, string> = { Accept: "application/json" };
  // Browsers control User-Agent themselves. Supplying it there is forbidden and
  // can cause an otherwise valid device-side fallback request to be rejected.
  if (typeof window === "undefined") {
    headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers,
  });
  if (!response.ok) {
    const body = await response.text();
    const captcha = response.status === 403 && body.includes("captcha_required");
    throw new MangaFireError(captcha ? "MangaFire requires a browser captcha for this server." : `MangaFire request failed (${response.status}).`, response.status);
  }
  return response.json<T>();
}

export async function listMangaFireTitles(options: { type: "popular" | "latest" | "search"; query?: string; page?: number }) {
  const parameters: Array<[string, string]> = [];
  if (options.type === "search" && options.query?.trim()) parameters.push(["keyword", options.query.trim()]);
  const order = options.type === "popular" ? "views_30d" : options.type === "search" ? "relevance" : "chapter_updated_at";
  parameters.push([`order[${order}]`, "desc"]);
  parameters.push(["page", String(Math.max(1, options.page ?? 1))], ["limit", "50"]);
  return requestJson<ApiResponse<MangaFireTitle>>("/api/titles", parameters);
}

export async function getMangaFireDetails(hid: string) {
  const response = await requestJson<{ data: MangaFireDetails }>(`/api/titles/${encodeURIComponent(hid)}`);
  return response.data;
}

export async function getMangaFireChapters(hid: string, language = "en") {
  const parameters: Array<[string, string]> = [["language", language], ["sort", "number"], ["order", "desc"], ["page", "1"], ["limit", "200"]];
  const first = await requestJson<ApiResponse<MangaFireChapter>>(`/api/titles/${encodeURIComponent(hid)}/chapters`, parameters);
  const chapters = [...(first.items ?? [])];
  const lastPage = Math.max(1, first.meta?.lastPage ?? 1);
  for (let page = 2; page <= lastPage; page += 1) {
    const nextParameters = parameters.map(([key, value]) => [key, key === "page" ? String(page) : value] as [string, string]);
    const next = await requestJson<ApiResponse<MangaFireChapter>>(`/api/titles/${encodeURIComponent(hid)}/chapters`, nextParameters);
    chapters.push(...(next.items ?? []));
  }
  return chapters;
}
