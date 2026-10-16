import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { TextEncoder } from "node:util";

import { findOrCreateUserByEmail, initializeDatabase } from "../dist/db.js";
import { getGitHubOAuthConfig } from "../dist/process-env.js";
import { handleRequest } from "../dist/server.js";

const encoder = new TextEncoder();
const SQLITE_BIN = "/usr/bin/sqlite3";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret-value";
const PUBLIC_BASE_URL = "https://todo.michaelgreen06.com";
const CALLBACK_URL = "https://todo.michaelgreen06.com/auth/github/callback";
const ACCESS_TOKEN = "gho_test_access_token_value";
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const MANAGED_ENV_NAMES = ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "PUBLIC_BASE_URL", "TODO_DATABASE_PATH"];
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const GITHUB_FAILURES = [
  "cancelled",
  "invalid-state",
  "missing-code",
  "upstream-error",
  "no-verified-email",
  "unknown-email",
  "ambiguous-email",
];

const GITHUB_ENABLED_ENV = {
  GITHUB_OAUTH_CLIENT_ID: CLIENT_ID,
  GITHUB_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
  PUBLIC_BASE_URL,
};

test("GitHub OAuth configuration", async (suite) => {
  await suite.test("is disabled when neither client variable is set", () => {
    withEnvironment({}, () => {
      assert.equal(getGitHubOAuthConfig(), null);
    });
  });

  await suite.test("requires both client variables together", () => {
    withEnvironment({ ...GITHUB_ENABLED_ENV, GITHUB_OAUTH_CLIENT_SECRET: undefined }, () => {
      assert.throws(() => getGitHubOAuthConfig(), (error) => {
        return error instanceof Error
          && error.message.includes("GITHUB_OAUTH_CLIENT_ID")
          && !error.message.includes(CLIENT_ID);
      });
    });
  });

  await suite.test("never echoes the client secret in configuration errors", () => {
    withEnvironment({ ...GITHUB_ENABLED_ENV, PUBLIC_BASE_URL: "ftp://bad.example.com" }, () => {
      assert.throws(() => getGitHubOAuthConfig(), (error) => {
        return error instanceof Error && !error.message.includes(CLIENT_SECRET);
      });
    });
  });

  await suite.test("requires PUBLIC_BASE_URL and derives the exact callback URL", () => {
    withEnvironment({ ...GITHUB_ENABLED_ENV, PUBLIC_BASE_URL: undefined }, () => {
      assert.throws(() => getGitHubOAuthConfig(), /PUBLIC_BASE_URL/u);
    });

    withEnvironment({ ...GITHUB_ENABLED_ENV, PUBLIC_BASE_URL: `${PUBLIC_BASE_URL}/some/path` }, () => {
      assert.throws(() => getGitHubOAuthConfig(), /PUBLIC_BASE_URL/u);
    });

    withEnvironment({ ...GITHUB_ENABLED_ENV, PUBLIC_BASE_URL: `${PUBLIC_BASE_URL}/` }, () => {
      const config = getGitHubOAuthConfig();
      assert.equal(config?.callbackUrl, CALLBACK_URL);
      assert.equal(config?.clientId, CLIENT_ID);
    });
  });

  await suite.test("GitHub start is disabled and callback safely redirects when unconfigured", async () => {
    await withDatabaseAndEnvironment({}, async () => {
      const start = await sendRequest({ method: "GET", url: "/auth/github/start" });
      const callback = await sendRequest({ method: "GET", url: "/auth/github/callback?code=secret-code&state=y" });
      const login = await sendRequest({ method: "GET", url: "/login" });

      assert.equal(start.statusCode, 404);
      assert.equal(callback.statusCode, 303);
      assert.equal(callback.headers["Location"], "/login");
      assert.equal(callback.body.includes("secret-code"), false);
      assert.equal(callback.headers["Cache-Control"], "no-store");
      assert.equal(callback.body.includes('action="/login"'), false);
      assert.equal(login.statusCode, 200);
      assert.equal(login.body.includes("/auth/github/start"), false);
      assert.equal(login.body.includes('action="/login"'), true);
    });
  });
});

test("GitHub sign-in start", async (suite) => {
  await suite.test("redirects to GitHub App without OAuth App scopes, with S256 PKCE and one-time state", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const start = await sendRequest({ method: "GET", url: "/auth/github/start" });
      const location = new globalThis.URL(start.headers["Location"]);

      assert.equal(start.statusCode, 303);
      assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
      assert.equal(location.searchParams.get("client_id"), CLIENT_ID);
      assert.equal(location.searchParams.get("redirect_uri"), CALLBACK_URL);
      assert.equal(location.searchParams.has("scope"), false);
      assert.equal(location.searchParams.get("code_challenge_method"), "S256");
      assert.match(location.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/u);
      assert.equal(location.searchParams.get("state"), readCookieValue(start, "todo_github_state"));
    });
  });

  await suite.test("sets a short-lived HttpOnly, SameSite=Lax, Secure state cookie under https", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const start = await sendRequest({ method: "GET", url: "/auth/github/start" });
      const cookie = readSetCookie(start, "todo_github_state");

      assert.match(cookie, /Max-Age=600(;|$)/u);
      assert.match(cookie, /Path=\/auth\/github(;|$)/u);
      assert.match(cookie, /HttpOnly/u);
      assert.match(cookie, /SameSite=Lax/u);
      assert.match(cookie, /Secure/u);
    });
  });

  await suite.test("omits the Secure flag on an http base URL", async () => {
    await withDatabaseAndEnvironment({ ...GITHUB_ENABLED_ENV, PUBLIC_BASE_URL: "http://localhost:3000" }, async () => {
      const start = await sendRequest({ method: "GET", url: "/auth/github/start" });
      const location = new globalThis.URL(start.headers["Location"]);

      assert.equal(location.searchParams.get("redirect_uri"), "http://localhost:3000/auth/github/callback");
      assert.doesNotMatch(readSetCookie(start, "todo_github_state"), /Secure/u);
    });
  });

  await suite.test("stores only a hash of the state, never the raw state", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async (databasePath) => {
      const start = await sendRequest({ method: "GET", url: "/auth/github/start" });
      const state = readCookieValue(start, "todo_github_state");
      const stored = sqlite(databasePath, "SELECT state_hash FROM github_oauth_states;");

      assert.notEqual(stored, state);
      assert.equal(stored, createHash("sha256").update(state, "utf8").digest("hex"));
    });
  });
});

test("GitHub sign-in callback", async (suite) => {
  await suite.test("signs in the existing user matched by a verified email and clears the state cookie", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async (databasePath) => {
      const existing = findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({
        emails: [
          { email: "Michael@Example.com", primary: true, verified: true, visibility: "public" },
          { email: "unverified@example.com", primary: false, verified: false, visibility: null },
        ],
      }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        assert.equal(callback.statusCode, 303);
        assert.equal(callback.headers["Location"], "/");
        assert.match(readSetCookie(callback, "todo_session"), /HttpOnly/u);
        assert.match(readSetCookie(callback, "todo_session"), /SameSite=Lax/u);
        assert.match(readSetCookie(callback, "todo_session"), /Secure/u);
        assert.match(readSetCookie(callback, "todo_session"), new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}(;|$)`, "u"));
        assert.match(readSetCookie(callback, "todo_github_state"), /Max-Age=0/u);

        const session = await sendRequest({ method: "GET", url: "/prompts", headers: { cookie: sessionCookie(callback) } });
        assert.equal(session.statusCode, 200);

        assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM users;"), "1");
        assert.equal(sqlite(databasePath, `SELECT id FROM users WHERE email = 'michael@example.com';`), existing.id);
        assertNoSecretsLeaked(callback, github.calls);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("exchanges the code with the PKCE verifier matching the authorize challenge", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const flow = await startFlow();
        await callbackRequest(flow, { code: "test-code" });

        const tokenCall = github.calls.find((call) => call.url === GITHUB_TOKEN_URL);
        assert.ok(tokenCall);
        assert.equal(tokenCall.init.method, "POST");
        assert.equal(tokenCall.init.headers["Accept"], "application/json");
        const body = JSON.parse(tokenCall.init.body);
        assert.equal(body.client_id, CLIENT_ID);
        assert.equal(body.client_secret, CLIENT_SECRET);
        assert.equal(body.code, "test-code");
        assert.equal(body.redirect_uri, CALLBACK_URL);
        assert.equal(createHash("sha256").update(body.code_verifier, "utf8").digest("base64url"), flow.challenge);

        const userCall = github.calls.find((call) => call.url === GITHUB_USER_URL);
        assert.equal(userCall?.init.headers["Authorization"], `Bearer ${ACCESS_TOKEN}`);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects an unknown verified email without creating a user", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async (databasePath) => {
      findOrCreateUserByEmail("someone-else@example.com");
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("stranger@example.com") }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        const login = await assertFailedSignIn(callback, "unknown-email", [flow.state, "test-code"]);
        assert.match(login.body, /No Todo account matches/u);
        assert.match(login.body, /Sign in with email/u);
        assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM users;"), "1");
        assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM sessions;"), "0");
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("never grants access from an unverified email that matches an existing user", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async (databasePath) => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({
        emails: [{ email: "michael@example.com", primary: true, verified: false, visibility: "public" }],
      }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        await assertFailedSignIn(callback, "no-verified-email", [flow.state, "test-code"]);
        assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM sessions;"), "0");
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects when verified emails match more than one existing user", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async (databasePath) => {
      findOrCreateUserByEmail("michael@example.com");
      findOrCreateUserByEmail("alt@example.com");
      const github = installGitHubMock(githubRoutes({
        emails: [
          { email: "michael@example.com", primary: true, verified: true, visibility: "public" },
          { email: "alt@example.com", primary: false, verified: true, visibility: "private" },
        ],
      }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        const login = await assertFailedSignIn(callback, "ambiguous-email", [flow.state, "test-code"]);
        assert.match(login.body, /more than one/u);
        assert.equal(sqlite(databasePath, "SELECT COUNT(*) FROM sessions;"), "0");
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("matches the stored email case-insensitively and only against existing users", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("case.user@example.com");
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("CASE.USER@EXAMPLE.COM") }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        assert.equal(callback.statusCode, 303);
        assert.notEqual(readSetCookieOrNull(callback, "todo_session"), null);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects a replayed callback and does not exchange the code twice", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const flow = await startFlow();
        const first = await callbackRequest(flow, { code: "test-code" });
        assert.equal(first.statusCode, 303);

        const tokenCallsBefore = github.calls.filter((call) => call.url === GITHUB_TOKEN_URL).length;
        const replay = await callbackRequest(flow, { code: "test-code" });
        const tokenCallsAfter = github.calls.filter((call) => call.url === GITHUB_TOKEN_URL).length;

        const login = await assertFailedSignIn(replay, "invalid-state", [flow.state, "test-code"]);
        assert.match(login.body, /invalid or expired/u);
        assert.equal(tokenCallsAfter, tokenCallsBefore);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects an expired state", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async (databasePath) => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const flow = await startFlow();
        sqlite(databasePath, "UPDATE github_oauth_states SET expires_at = '2000-01-01T00:00:00.000Z';");
        const callback = await callbackRequest(flow, { code: "test-code" });

        await assertFailedSignIn(callback, "invalid-state", [flow.state, "test-code"]);
        assert.equal(github.calls.length, 0);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects a mismatched state, burns the stored state, and clears the state cookie", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const flow = await startFlow();
        const mismatched = await callbackRequest(flow, { code: "test-code", stateOverride: "f".repeat(64) });
        const retry = await callbackRequest(flow, { code: "test-code" });

        await assertFailedSignIn(mismatched, "invalid-state", [flow.state, "test-code", "f".repeat(64)]);
        await assertFailedSignIn(retry, "invalid-state", [flow.state, "test-code"]);
        assert.equal(github.calls.length, 0);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects a callback without the state cookie without calling GitHub", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const callback = await sendRequest({
          method: "GET",
          url: "/auth/github/callback?code=test-code&state=no-cookie-state-value",
        });

        await assertFailedSignIn(callback, "invalid-state", ["test-code", "no-cookie-state-value"]);
        assert.equal(github.calls.length, 0);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("handles user denial without exchanging anything", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const flow = await startFlow();
        // The error callback also carries a code. It must never reach the redirect or the rendered page.
        const callback = await callbackRequest(flow, { code: "test-code", error: "access_denied" });

        const login = await assertFailedSignIn(callback, "cancelled", [flow.state, "test-code"]);
        assert.match(login.body, /cancelled/u);
        assert.equal(github.calls.length, 0);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects a callback with no code", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("michael@example.com") }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, {});

        await assertFailedSignIn(callback, "missing-code", [flow.state]);
        assert.equal(github.calls.length, 0);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("shows the email fallback when GitHub is unavailable (HTTP 503)", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock({
        [GITHUB_TOKEN_URL]: () => jsonResponse({ message: "unavailable" }, 503),
      });

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        const login = await assertFailedSignIn(callback, "upstream-error", [flow.state, "test-code"]);
        assert.match(login.body, /GitHub could not complete sign-in/u);
        assert.match(login.body, /Sign in with email/u);
        assertNoSecretsLeaked(callback, github.calls);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("shows the email fallback when the network request fails", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const github = installGitHubMock({
        [GITHUB_TOKEN_URL]: () => {
          throw new TypeError("fetch failed");
        },
      });

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        await assertFailedSignIn(callback, "upstream-error", [flow.state, "test-code"]);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("treats a GitHub error payload with HTTP 200 as a failed exchange", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const github = installGitHubMock({
        [GITHUB_TOKEN_URL]: () => jsonResponse({ error: "bad_verification_code" }),
      });

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "bad-code" });

        await assertFailedSignIn(callback, "upstream-error", [flow.state, "bad-code"]);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects malformed upstream JSON instead of trusting it", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({
        user: { id: "4242", login: "octocat" },
        emails: verifiedEmails("michael@example.com"),
      }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        await assertFailedSignIn(callback, "upstream-error", [flow.state, "test-code"]);
      } finally {
        github.restore();
      }
    });
  });

  await suite.test("rejects a GitHub account without a valid numeric identity", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      findOrCreateUserByEmail("michael@example.com");
      const github = installGitHubMock(githubRoutes({
        user: { id: 0, login: "octocat" },
        emails: verifiedEmails("michael@example.com"),
      }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });

        await assertFailedSignIn(callback, "upstream-error", [flow.state, "test-code"]);
      } finally {
        github.restore();
      }
    });
  });
});

test("GitHub sign-in login error messages", async (suite) => {
  await suite.test("maps every server-defined failure to a friendly notice on GET /login", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      for (const failure of GITHUB_FAILURES) {
        const login = await sendRequest({ method: "GET", url: `/login?githubError=${failure}` });

        assert.equal(login.statusCode, 200);
        assert.equal(login.headers["Cache-Control"], "no-store");
        assert.equal(login.headers["Referrer-Policy"], "no-referrer");
        assert.match(login.body, /class="notice error"/u);
        assert.match(login.body, /action="\/login"/u);
      }
    });
  });

  await suite.test("ignores forged or unknown githubError values instead of reflecting them", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const forged = await sendRequest({
        method: "GET",
        url: "/login?githubError=%3Cscript%3Ealert(1)%3C%2Fscript%3E",
      });
      const unknown = await sendRequest({ method: "GET", url: "/login?githubError=access_denied" });

      for (const login of [forged, unknown]) {
        assert.equal(login.statusCode, 200);
        assert.equal(login.body.includes("<script>"), false);
        assert.equal(login.body.includes("alert(1)"), false);
        assert.equal(login.body.includes("access_denied"), false);
        assert.doesNotMatch(login.body, /class="notice error"/u);
        assert.match(login.body, /action="\/login"/u);
      }
    });
  });

  await suite.test("keeps the email fallback usable after a failed GitHub callback", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const github = installGitHubMock(githubRoutes({ emails: verifiedEmails("stranger@example.com") }));

      try {
        const flow = await startFlow();
        const callback = await callbackRequest(flow, { code: "test-code" });
        const login = await assertFailedSignIn(callback, "unknown-email", [flow.state, "test-code"]);
        assert.match(login.body, /Use email sign-in instead/u);

        const logs = [];
        const restoreLog = captureConsoleLog(logs);
        try {
          const create = await sendRequest({
            method: "POST",
            url: "/login",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "email=fallback-after-error%40example.com",
          });
          assert.equal(create.statusCode, 303);
          assert.equal(create.headers["Location"], "/login?sent=1");
          assert.ok(logs.find((entry) => entry.includes("Magic login link for fallback-after-error@example.com")));
        } finally {
          restoreLog();
        }
      } finally {
        github.restore();
      }
    });
  });
});

test("email magic-link fallback and sessions", async (suite) => {
  await suite.test("magic-link sign-in still works with GitHub enabled and uses the 90-day session TTL", async () => {
    await withDatabaseAndEnvironment(GITHUB_ENABLED_ENV, async () => {
      const login = await sendRequest({ method: "GET", url: "/login" });
      assert.match(login.body, /action="\/login"/u);
      assert.match(login.body, /\/auth\/github\/start/u);

      const logs = [];
      const restoreLog = captureConsoleLog(logs);
      let consumed;
      try {
        const create = await sendRequest({
          method: "POST",
          url: "/login",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "email=fallback%40example.com",
        });
        assert.equal(create.statusCode, 303);
        assert.equal(create.headers["Location"], "/login?sent=1");
        const line = logs.find((entry) => entry.includes("Magic login link for fallback@example.com"));
        assert.ok(line);
        const loginUrl = new globalThis.URL(line.slice(line.indexOf("https://")));
        consumed = await sendRequest({ method: "GET", url: `${loginUrl.pathname}${loginUrl.search}` });
      } finally {
        restoreLog();
      }

      assert.equal(consumed?.statusCode, 303);
      assert.equal(consumed?.headers["Location"], "/");
      assert.match(readSetCookie(consumed, "todo_session"), new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}(;|$)`, "u"));
    });
  });

  await suite.test("sessions that have expired no longer authenticate", async () => {
    await withDatabaseAndEnvironment({ PUBLIC_BASE_URL }, async (databasePath) => {
      const logs = [];
      const restoreLog = captureConsoleLog(logs);
      let sessionCookieValue;
      try {
        await sendRequest({
          method: "POST",
          url: "/login",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "email=expiry%40example.com",
        });
        const line = logs.find((entry) => entry.includes("Magic login link"));
        const loginUrl = new globalThis.URL(line.slice(line.indexOf("https://")));
        const consumed = await sendRequest({ method: "GET", url: `${loginUrl.pathname}${loginUrl.search}` });
        sessionCookieValue = `todo_session=${readCookieValue(consumed, "todo_session")}`;
      } finally {
        restoreLog();
      }

      const before = await sendRequest({ method: "GET", url: "/prompts", headers: { cookie: sessionCookieValue } });
      assert.equal(before.statusCode, 200);

      sqlite(databasePath, "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z';");
      const after = await sendRequest({ method: "GET", url: "/prompts", headers: { cookie: sessionCookieValue } });
      assert.equal(after.statusCode, 303);
      assert.equal(after.headers["Location"], "/login");
    });
  });
});

async function startFlow() {
  const start = await sendRequest({ method: "GET", url: "/auth/github/start" });
  const authorizationUrl = new globalThis.URL(start.headers["Location"]);
  const state = authorizationUrl.searchParams.get("state");

  return {
    state,
    challenge: authorizationUrl.searchParams.get("code_challenge"),
    cookie: `todo_github_state=${readCookieValue(start, "todo_github_state")}`,
  };
}

// Every failed callback must redirect to the login page with a server-validated enum and nothing else.
// The response must not carry the authorization code, the state, or any token.
async function assertFailedSignIn(callback, failure, secrets) {
  assert.equal(callback.statusCode, 303);
  assert.equal(callback.headers["Location"], `/login?githubError=${failure}`);
  assert.equal(callback.body, "");
  assert.equal(callback.headers["Cache-Control"], "no-store");
  assert.equal(callback.headers["Referrer-Policy"], "no-referrer");
  assert.equal(readSetCookieOrNull(callback, "todo_session"), null);
  assert.match(readSetCookie(callback, "todo_github_state"), /Max-Age=0/u);

  for (const secret of secrets) {
    assert.equal(callback.headers["Location"].includes(secret), false);
    assert.equal(callback.body.includes(secret), false);
  }

  return await followLoginError(callback);
}

async function followLoginError(callback) {
  const login = await sendRequest({ method: "GET", url: callback.headers["Location"] });

  assert.equal(login.statusCode, 200);
  assert.equal(login.headers["Cache-Control"], "no-store");
  assert.equal(login.headers["Referrer-Policy"], "no-referrer");
  assert.match(login.body, /class="notice error"/u);
  assert.match(login.body, /action="\/login"/u);

  return login;
}

async function callbackRequest(flow, { code, error, stateOverride }) {
  const params = new globalThis.URLSearchParams();
  if (code !== undefined) params.set("code", code);
  if (error !== undefined) params.set("error", error);
  params.set("state", stateOverride ?? flow.state);

  return await sendRequest({
    method: "GET",
    url: `/auth/github/callback?${params.toString()}`,
    headers: { cookie: flow.cookie },
  });
}

function githubRoutes({
  user = { id: 4242, login: "octocat" },
  emails,
}) {
  return {
    [GITHUB_TOKEN_URL]: () => jsonResponse({ access_token: ACCESS_TOKEN, token_type: "bearer", scope: "" }),
    [GITHUB_USER_URL]: () => jsonResponse(user),
    [GITHUB_EMAILS_URL]: () => jsonResponse(emails),
  };
}

function verifiedEmails(email) {
  return [{ email, primary: true, verified: true, visibility: "public" }];
}

function jsonResponse(body, status = 200) {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installGitHubMock(routes) {
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];

    if (route === undefined) {
      throw new Error(`Unexpected outbound request in test: ${url}`);
    }

    return await route(init);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function assertNoSecretsLeaked(response, calls) {
  const outbound = JSON.stringify(calls.map((call) => ({ url: call.url, headers: call.init.headers })));
  const visible = `${response.body}${response.headers["Location"] ?? ""}`;

  assert.equal(visible.includes(ACCESS_TOKEN), false);
  assert.equal(visible.includes(CLIENT_SECRET), false);
  assert.equal(outbound.includes(CLIENT_SECRET), false);
}

function captureConsoleLog(logs) {
  const originalLog = globalThis.console.log;
  const originalError = globalThis.console.error;
  globalThis.console.log = (...values) => {
    logs.push(values.map(String).join(" "));
  };
  globalThis.console.error = (...values) => {
    logs.push(values.map(String).join(" "));
  };

  return () => {
    globalThis.console.log = originalLog;
    globalThis.console.error = originalError;
  };
}

function readSetCookieOrNull(response, name) {
  const headers = [].concat(response.headers["Set-Cookie"] ?? []);
  return headers.find((value) => value.startsWith(`${name}=`)) ?? null;
}

function readSetCookie(response, name) {
  const cookie = readSetCookieOrNull(response, name);
  assert.notEqual(cookie, null, `Missing Set-Cookie for ${name}`);
  return cookie;
}

function readCookieValue(response, name) {
  return readSetCookie(response, name).slice(`${name}=`.length).split(";")[0];
}

function sessionCookie(response) {
  return `todo_session=${readCookieValue(response, "todo_session")}`;
}

function sqlite(databasePath, statement) {
  return execFileSync(SQLITE_BIN, [databasePath, statement], { encoding: "utf8" }).trim();
}

function applyEnvironment(values) {
  const previous = new Map(MANAGED_ENV_NAMES.map((name) => [name, env[name]]));

  for (const name of MANAGED_ENV_NAMES) {
    const value = values[name];
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete env[name];
      } else {
        env[name] = value;
      }
    }
  };
}

function withEnvironment(values, run) {
  const restoreEnvironment = applyEnvironment(values);

  try {
    return run();
  } finally {
    restoreEnvironment();
  }
}

async function withDatabaseAndEnvironment(values, run) {
  const directory = mkdtempSync(join(tmpdir(), "todo1-github-auth-test-"));
  const databasePath = join(directory, "todo.sqlite");
  const restoreEnvironment = applyEnvironment({ ...values, TODO_DATABASE_PATH: databasePath });

  try {
    initializeDatabase();
    return await run(databasePath);
  } finally {
    restoreEnvironment();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function sendRequest({ method, url, headers = {}, body = "" }) {
  const request = {
    method,
    url,
    headers,
    on(event, listener) {
      if (event === "data" && body.length > 0) listener(encoder.encode(body));
      if (event === "end") listener();
    },
  };
  const response = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(responseBody = "") {
      this.body = responseBody;
    },
  };
  await handleRequest(request, response);
  return response;
}
