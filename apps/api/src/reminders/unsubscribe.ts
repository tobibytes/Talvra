const enc = new TextEncoder();

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function sign(secret: string, userId: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`unsubscribe:${userId}`)));
}

/** A link that turns off emails without signing in (works from any mail client). */
export async function unsubscribeUrl(appUrl: string, secret: string, userId: string) {
  return `${appUrl.replace(/\/$/, "")}/api/unsubscribe?token=${userId}.${await sign(secret, userId)}`;
}

/** The user id if the token is genuine, else null. */
export async function verifyUnsubscribe(secret: string, token: string) {
  const [userId, sig] = token.split(".");
  if (!userId || !sig || !/^[0-9a-f-]{36}$/.test(userId)) return null;
  const expected = await sign(secret, userId);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}
