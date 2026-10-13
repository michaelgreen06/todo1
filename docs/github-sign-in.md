# GitHub Sign-In (optional)

Status: draft. Email magic-link sign-in remains available and is the fallback.

GitHub sign-in is for existing Todo accounts. It does not create accounts or grant access from unverified email; it matches a verified GitHub email to an existing Todo email, without storing a permanent GitHub account link.

## Callback URL

Register this exact URL as the **Authorization callback URL** of the GitHub OAuth App:

```text
https://todo.michaelgreen06.com/auth/github/callback
```

The redirect URI sent to GitHub is built only from `PUBLIC_BASE_URL` plus `/auth/github/callback`. The request host is never used.

## Railway environment variables

Set these on the Railway service. Do not commit values.

| Variable | Required | Value |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | Yes, with the secret | Client ID from the GitHub OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | Yes, with the ID | Client secret from the GitHub OAuth App (treat as a secret) |
| `PUBLIC_BASE_URL` | Yes, when GitHub is enabled | `https://todo.michaelgreen06.com` (origin only: no path, query, or trailing data) |

Rules, enforced at startup in `src/process-env.ts`:

- Set both client variables or neither. Setting only one stops the server with an error that names the variables but not their values.
- With both set, `PUBLIC_BASE_URL` must be a valid `http` or `https` origin. Otherwise the server does not start.
- With neither set, the GitHub button and `/auth/github/start` are disabled (404). The callback safely redirects to `/login` without exposing any code. Email sign-in is unchanged.

## GitHub OAuth App setup

1. In GitHub: Settings → Developer settings → OAuth Apps → New OAuth App. Use an OAuth App, not a GitHub App.
2. Homepage URL: `https://todo.michaelgreen06.com`
3. Authorization callback URL: `https://todo.michaelgreen06.com/auth/github/callback`
4. Generate a client secret and copy it into Railway. Do not enable device flow.
5. The app requests only the `user:email` scope. It requests no repository access.

For local testing, use a separate OAuth App whose callback is `http://localhost:3000/auth/github/callback`, with `PUBLIC_BASE_URL=http://localhost:3000`.

## How sign-in works

1. `GET /auth/github/start` creates a random one-time state and a PKCE verifier. It stores only the SHA-256 hash of the state, with the verifier, for 10 minutes. It sets a `todo_github_state` cookie (HttpOnly, SameSite=Lax, Path=/auth/github, Secure under https, Max-Age 600) and redirects to GitHub with `code_challenge_method=S256`.
2. GitHub redirects to `/auth/github/callback`. The server clears the state cookie on every callback and sends no-store/no-referrer headers. It consumes the stored state in a single atomic step. An unknown, expired, reused, or mismatched state is rejected before any GitHub request; failed callbacks redirect to `/login` with only a fixed error code, never the OAuth code.
3. If the user cancels, the server shows a message and makes no GitHub request.
4. The server exchanges the code at GitHub's token endpoint from the backend, with the client secret and PKCE verifier. It calls `GET /user` and `GET /user/emails` with the token. Responses are validated with type guards. A missing or invalid GitHub numeric ID, or a malformed response, fails the sign-in.
5. The GitHub token is used for these calls only. It is never stored, logged, or put in a URL.

## Account matching

Only an existing account can sign in:

- Only emails GitHub reports as `verified: true` are considered.
- Verified emails are normalized (trimmed, lowercased) and matched case-insensitively against `users.email`.
- Exactly one matching user signs in. No match shows "No Todo account matches". More than one match is rejected as ambiguous.
- No user is created. Unverified emails never grant access.

GitHub's numeric ID is validated but not stored. Storing it would require a schema change and is not part of this draft.

## Sessions

- Sign-in creates the same kind of session cookie as email sign-in (HttpOnly, SameSite=Lax, Secure under https).
- New sessions last 90 days (previously 30). Sessions that already exist keep their stored expiry.
- Magic-link sign-in also creates 90-day sessions.

## Rollback

1. Delete `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` from Railway and redeploy or restart.
2. The GitHub button disappears and `/auth/github/start` returns 404. The callback redirects to `/login` without exposing a code. Email sign-in is unaffected.
3. Optional: remove the GitHub OAuth App in GitHub.
4. Sessions created through GitHub remain valid until they expire, as with any session. To end them early, revoke them manually. This is a data change and is not part of rollback.

The `github_oauth_states` table is created by `CREATE TABLE IF NOT EXISTS` at startup. It contains only short-lived state hashes and can be dropped if GitHub sign-in is removed permanently.
