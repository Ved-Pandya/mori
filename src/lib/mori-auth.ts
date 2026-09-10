import { createHmac, timingSafeEqual } from "node:crypto";

const name = "mori_session";
const token = () => createHmac("sha256", process.env.MORI_API_TOKEN ?? "").update("mori-private-session").digest("base64url");
const same = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export const sessionCookie = name;
export const validPassword = (value: string) => !!process.env.MORI_APP_PASSWORD && same(value, process.env.MORI_APP_PASSWORD);
export const validSession = (value?: string) => !!process.env.MORI_API_TOKEN && !!value && same(value, token());
export const sessionValue = token;
