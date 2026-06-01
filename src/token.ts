import { createHash, randomBytes } from "node:crypto";

export function createRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashRawToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
