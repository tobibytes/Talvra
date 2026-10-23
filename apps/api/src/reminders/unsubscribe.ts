const enc = new TextEncoder();

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`unsubscribe:v1:${payload}`)));
}

/** Links stay valid for a year (emails get old; they shouldn't work forever). */
const VALID_DAYS = 366;
const today = () => Math.floor(Date.now() / 86_400_000);

/** A link that turns off emails without signing in (works from any mail client). */
export async function unsubscribeUrl(appUrl: string, secret: string, userId: string) {
  const payload = `${userId}.${today()}`;
  return `${appUrl.replace(/\/$/, "")}/api/unsubscribe?token=${payload}.${await sign(secret, payload)}`;
}

/** The user id if the token is genuine and not expired, else null. */
export async function verifyUnsubscribe(secret: string, token: string) {
  const [userId, day, sig] = token.split(".");
  if (!userId || !day || !sig || !/^[0-9a-f-]{36}$/.test(userId) || !/^\d{1,6}$/.test(day))
    return null;
  if (today() - Number(day) > VALID_DAYS) return null;
  const expected = await sign(secret, `${userId}.${day}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}
