/** API Key 加密：AES-256-GCM。密钥来自 FOLIO_SECRET，或数据目录下自动生成的 secret.key。 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface KeyCipher {
  encrypt(plain: string): string;
  decrypt(token: string): string;
}

/** 从任意长度的口令派生 32 字节密钥。 */
function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`folio:v1:${secret}`).digest();
}

export function createCipher(secret: string): KeyCipher {
  const key = deriveKey(secret);
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      const tag = c.getAuthTag();
      return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
    },
    decrypt(token: string): string {
      const [v, iv, tag, ct] = token.split(":");
      if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("无法识别的密文格式");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
    },
  };
}

/** 读取或生成数据目录下的 secret.key（32 字节随机数，hex）。 */
export function loadOrCreateSecret(dataDir: string, envSecret: string | null): string {
  if (envSecret) return envSecret;
  const file = join(dataDir, "secret.key");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** Key 的末四位提示，例如 `…a1b2`。 */
export function keyHint(key: string): string {
  const k = key.trim();
  return k.length <= 4 ? "…" : `…${k.slice(-4)}`;
}
