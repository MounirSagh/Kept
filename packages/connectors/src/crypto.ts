// OAuth tokens are stored encrypted (AES-256-GCM). The OAuth `state` parameter is
// HMAC-signed so a callback can't be forged or replayed into another org.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_KEY_VERSION = 1;

function key(base64Key: string): Buffer {
  const k = Buffer.from(base64Key, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

/** Layout: 12-byte IV | 16-byte auth tag | ciphertext. */
export function encryptToken(plain: string, base64Key: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const out = new Uint8Array(new ArrayBuffer(12 + 16 + ciphertext.length));
  out.set(iv, 0);
  out.set(cipher.getAuthTag(), 12);
  out.set(ciphertext, 28);
  return out;
}

export function decryptToken(sealed: Uint8Array, base64Key: string): string {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", key(base64Key), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export interface OAuthState {
  provider: string;
  orgId: string;
  userId: string;
  /** Expiry, epoch ms. */
  exp: number;
  nonce: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;

export function signState(state: Omit<OAuthState, "exp" | "nonce">, secret: string, now = Date.now()): string {
  const payload: OAuthState = { ...state, exp: now + STATE_TTL_MS, nonce: randomBytes(8).toString("hex") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** Returns the state if the signature is valid and it hasn't expired, otherwise null. */
export function verifyState(token: string, secret: string, now = Date.now()): OAuthState | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    return state.exp > now ? state : null;
  } catch {
    return null;
  }
}
