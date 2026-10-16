import { createHash } from "node:crypto";

import { createSessionTokenForUser } from "./auth.js";
import { consumeGitHubOAuthState, createGitHubOAuthState, findUsersByEmails } from "./db.js";
import { createRawToken, hashRawToken } from "./token.js";
import { validateEmail } from "./validation.js";
import type { GitHubOAuthConfig } from "./process-env.js";

export const GITHUB_STATE_COOKIE_NAME = "todo_github_state";
export const GITHUB_STATE_TTL_SECONDS = 10 * 60;

const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_USER_EMAILS_URL = "https://api.github.com/user/emails";
const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "todo-mvp";

export type GitHubSignInStart = {
  readonly state: string;
  readonly authorizationUrl: string;
};

export type GitHubCallbackParams = {
  readonly stateCookie: string | null;
  readonly state: string | null;
  readonly code: string | null;
  readonly error: string | null;
};

export type GitHubSignInFailure =
  | "cancelled"
  | "invalid-state"
  | "missing-code"
  | "upstream-error"
  | "no-verified-email"
  | "unknown-email"
  | "ambiguous-email";

export type GitHubSignInResult =
  | { readonly ok: true; readonly sessionToken: string }
  | { readonly ok: false; readonly failure: GitHubSignInFailure };

const GITHUB_SIGN_IN_FAILURES: ReadonlyArray<GitHubSignInFailure> = [
  "cancelled",
  "invalid-state",
  "missing-code",
  "upstream-error",
  "no-verified-email",
  "unknown-email",
  "ambiguous-email",
];

type GitHubEmailEntry = {
  readonly email: string;
  readonly verified: boolean;
};

class GitHubUpstreamError extends Error {
  public constructor(message: string) {
    super(message);
  }
}

export function startGitHubSignIn(config: GitHubOAuthConfig): GitHubSignInStart {
  const state = createRawToken();
  const codeVerifier = createRawToken();
  const now = new Date();

  createGitHubOAuthState(
    hashRawToken(state),
    codeVerifier,
    new Date(now.getTime() + GITHUB_STATE_TTL_SECONDS * 1000).toISOString(),
    now.toISOString(),
  );

  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    state,
    code_challenge: createHash("sha256").update(codeVerifier, "utf8").digest("base64url"),
    code_challenge_method: "S256",
  });

  return {
    state,
    authorizationUrl: `${GITHUB_AUTHORIZE_URL}?${query.toString()}`,
  };
}

// Single entry point for the callback. The state cookie is consumed exactly once, before any
// GitHub request, so replays and mismatches never reach the network.
export async function completeGitHubSignIn(
  config: GitHubOAuthConfig,
  params: GitHubCallbackParams,
): Promise<GitHubSignInResult> {
  if (params.stateCookie === null || params.stateCookie.length === 0) {
    return { ok: false, failure: "invalid-state" };
  }

  const codeVerifier = consumeGitHubOAuthState(hashRawToken(params.stateCookie), new Date().toISOString());

  if (codeVerifier === null || params.state !== params.stateCookie) {
    return { ok: false, failure: "invalid-state" };
  }

  if (params.error !== null) {
    return { ok: false, failure: "cancelled" };
  }

  if (params.code === null || params.code.length === 0) {
    return { ok: false, failure: "missing-code" };
  }

  try {
    const accessToken = await exchangeCodeForAccessToken(config, params.code, codeVerifier);
    const identity = await fetchGitHubIdentity(accessToken);
    return matchVerifiedEmail(identity.verifiedEmails);
  } catch (error: unknown) {
    if (error instanceof GitHubUpstreamError) {
      console.error(`GitHub sign-in failed: ${error.message}`);
      return { ok: false, failure: "upstream-error" };
    }

    throw error;
  }
}

// Accepts only server-defined failure codes. Anything else, including attacker-supplied query values, yields null.
export function parseGitHubSignInFailure(value: string | null): GitHubSignInFailure | null {
  return GITHUB_SIGN_IN_FAILURES.find((failure) => failure === value) ?? null;
}

export function describeGitHubSignInFailure(failure: GitHubSignInFailure): {
  readonly statusCode: 400 | 502;
  readonly message: string;
} {
  switch (failure) {
    case "cancelled":
      return { statusCode: 400, message: "GitHub sign-in was cancelled. You can try again or use email sign-in." };
    case "invalid-state":
      return { statusCode: 400, message: "This GitHub sign-in link is invalid or expired. Start again or use email sign-in." };
    case "missing-code":
      return { statusCode: 400, message: "GitHub did not return a sign-in code. Try again or use email sign-in." };
    case "upstream-error":
      return { statusCode: 502, message: "GitHub could not complete sign-in. Try again later or use email sign-in." };
    case "no-verified-email":
      return { statusCode: 400, message: "This GitHub account has no verified email. Verify one on GitHub or use email sign-in." };
    case "unknown-email":
      return { statusCode: 400, message: "No Todo account matches a verified email on this GitHub account. Use email sign-in instead." };
    case "ambiguous-email":
      return { statusCode: 400, message: "Verified emails on this GitHub account match more than one Todo account. Use email sign-in instead." };
  }
}

function matchVerifiedEmail(verifiedEmails: ReadonlyArray<string>): GitHubSignInResult {
  if (verifiedEmails.length === 0) {
    return { ok: false, failure: "no-verified-email" };
  }

  // Matches existing users only. Accounts are never created from GitHub sign-in.
  const users = findUsersByEmails(verifiedEmails);

  if (users.length === 0) {
    return { ok: false, failure: "unknown-email" };
  }

  if (users.length > 1) {
    return { ok: false, failure: "ambiguous-email" };
  }

  const [user] = users;

  if (user === undefined) {
    return { ok: false, failure: "unknown-email" };
  }

  return { ok: true, sessionToken: createSessionTokenForUser(user.id) };
}

async function exchangeCodeForAccessToken(
  config: GitHubOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const body = await requestGitHub(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
      code_verifier: codeVerifier,
    }),
  }, "GitHub token exchange");

  // GitHub reports bad codes as HTTP 200 with an `error` field, so the access token must be present.
  const accessToken = isRecord(body) ? body["access_token"] : undefined;

  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new GitHubUpstreamError("GitHub token exchange returned no access token.");
  }

  return accessToken;
}

async function fetchGitHubIdentity(accessToken: string): Promise<{
  readonly id: number;
  readonly verifiedEmails: ReadonlyArray<string>;
}> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };

  const userBody = await requestGitHub(GITHUB_USER_URL, { method: "GET", headers }, "GitHub user lookup");
  const emailsBody = await requestGitHub(GITHUB_USER_EMAILS_URL, { method: "GET", headers }, "GitHub email lookup");

  return {
    id: readGitHubUserId(userBody),
    verifiedEmails: readVerifiedEmails(readGitHubEmailEntries(emailsBody)),
  };
}

async function requestGitHub(url: string, init: RequestInit, description: string): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS) });
  } catch {
    throw new GitHubUpstreamError(`${description} request failed.`);
  }

  if (!response.ok) {
    throw new GitHubUpstreamError(`${description} returned HTTP ${response.status.toString()}.`);
  }

  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw new GitHubUpstreamError(`${description} returned invalid JSON.`);
  }
}

function readGitHubUserId(body: unknown): number {
  const id = isRecord(body) ? body["id"] : undefined;

  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw new GitHubUpstreamError("GitHub user lookup returned an invalid identity.");
  }

  return id;
}

function readGitHubEmailEntries(body: unknown): ReadonlyArray<GitHubEmailEntry> {
  if (!Array.isArray(body)) {
    throw new GitHubUpstreamError("GitHub email lookup returned an invalid list.");
  }

  const items: ReadonlyArray<unknown> = body;

  return items.map((item) => {
    const email = isRecord(item) ? item["email"] : undefined;
    const verified = isRecord(item) ? item["verified"] : undefined;

    if (typeof email !== "string" || typeof verified !== "boolean") {
      throw new GitHubUpstreamError("GitHub email lookup returned an invalid entry.");
    }

    return { email, verified };
  });
}

function readVerifiedEmails(entries: ReadonlyArray<GitHubEmailEntry>): ReadonlyArray<string> {
  const emails = entries.flatMap((entry) => {
    if (!entry.verified) {
      return [];
    }

    const result = validateEmail(entry.email);
    return result.ok ? [result.value] : [];
  });

  return [...new Set(emails)];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
