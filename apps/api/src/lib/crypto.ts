/**
 * AES-256-GCM for secrets at rest (Canvas tokens). The user id is bound as
 * additional authenticated data, so a ciphertext copied onto another user's
 * row fails to decrypt.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(base64Key: string) {
  let key = keyCache.get(base64Key);
  if (!key) {
    const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
    if (raw.length !== 32) throw new Error("CANVAS_TOKEN_KEY must be 32 bytes (base64)");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(base64Key, key);
  }
  return key;
}

export async function encryptSecret(base64Key: string, plaintext: string, userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: enc.encode(userId) },
      await importKey(base64Key),
      enc.encode(plaintext),
    ),
  );
  return { ciphertext, iv };
}

export async function decryptSecret(
  base64Key: string,
  data: { ciphertext: Uint8Array; iv: Uint8Array },
  userId: string,
) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: data.iv, additionalData: enc.encode(userId) },
    await importKey(base64Key),
    data.ciphertext,
  );
  return dec.decode(plain);
}
