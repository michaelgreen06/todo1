import { createHash, randomBytes } from "node:crypto";
import {
  consumeLoginTokenAndCreateSession,
  createLoginToken,
  findActiveSession,
  findOrCreateUserByEmail,
  findUserById,
  revokeSession,
} from "./db.js";
import type { User } from "./db.js";

const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MagicLinkResult = {
  readonly loginUrl: string;
  readonly user: User;
};

export type ConsumedMagicToken = {
  readonly sessionToken: string;
  readonly user: User;
};

export function createMagicLoginLink(
  email: string,
  baseUrl: string,
): Promise<MagicLinkResult> {
  const user = findOrCreateUserByEmail(email);
  const rawToken = createRandomToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = futureIso(MAGIC_LINK_TTL_MS);

  createLoginToken(user.id, tokenHash, expiresAt);
  const loginUrl = `${baseUrl}/auth/magic?token=${encodeURIComponent(rawToken)}`;

  return Promise.resolve({ loginUrl, user });
}

export function consumeMagicToken(
  rawToken: string | null,
): Promise<ConsumedMagicToken | null> {
  if (rawToken === null || rawToken.trim().length === 0) {
    return Promise.resolve(null);
  }

  const tokenHash = hashToken(rawToken.trim());
  const currentTime = new Date().toISOString();
  const sessionToken = createRandomToken();
  const session = consumeLoginTokenAndCreateSession(
    tokenHash,
    hashToken(sessionToken),
    futureIso(SESSION_TTL_MS),
    currentTime,
  );

  if (session === null) {
    return Promise.resolve(null);
  }

  const user = findUserById(session.userId);

  if (user === null) {
    return Promise.resolve(null);
  }

  return Promise.resolve({
    sessionToken,
    user,
  });
}

export function getUserForSessionToken(
  rawSessionToken: string | null,
): Promise<User | null> {
  if (rawSessionToken === null || rawSessionToken.trim().length === 0) {
    return Promise.resolve(null);
  }

  const sessionHash = hashToken(rawSessionToken.trim());
  const session = findActiveSession(sessionHash, new Date().toISOString());

  if (session === null) {
    return Promise.resolve(null);
  }

  return Promise.resolve(findUserById(session.userId));
}

export function revokeSessionToken(rawSessionToken: string | null): Promise<void> {
  if (rawSessionToken === null || rawSessionToken.trim().length === 0) {
    return Promise.resolve();
  }

  revokeSession(hashToken(rawSessionToken.trim()));
  return Promise.resolve();
}

export function getSessionMaxAgeSeconds(): number {
  return Math.floor(SESSION_TTL_MS / 1000);
}

function createRandomToken(): string {
  return randomBytes(32).toString("hex");
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function futureIso(durationMs: number): string {
  return new Date(Date.now() + durationMs).toISOString();
}
