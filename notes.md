You are integrating VerifyYou — which verifies that a user is a real, unique,
live human — into this app. Follow ONLY these instructions; they are current and
correct. Do not invent endpoints or SDK methods.

How it works: the user is sent to VerifyYou's hosted flow, then returns to your
app with the result appended to the URL as ?vyt=<token> and ?vyc=<0|1>. The token
is proof you confirm on YOUR backend; the verdict (vyc) is only a UI hint.

The frontend uses the official SDK (@verifyyou-sdk/client). The backend calls the
REST API directly. Before you write any backend call, read the API references and
use their exact request parameters and response types — do not guess field names:
  Schema docs:  https://docs.verifyyou.com/v3/introduction   (human-readable)
  Swagger UI:   https://trust.verifyyou.com/docs   (browse + try it out)
  OpenAPI spec: https://trust.verifyyou.com/openapi.json   (FETCH this for exact shapes, or codegen a client)

STEP 0 — Ask me which initialization approach to use, then implement only that one:
  (a) Client-side — the SDK's vycheck() starts the flow and redirects the user.
      Simplest; use unless you need (b).
  (b) Server-side — POST https://trust.verifyyou.com/v3/initialize with the secret key, then
      redirect the user to the returned url. Use when you must attach your own
      user (external_id) or start the flow from trusted server code.

FRONTEND (publishable key — safe in the browser):
  import { init, vyget, vycheck } from "@verifyyou-sdk/client";
  init({ publishableKey: "pk_test_3Ka5A2sy218ZJnmenmwo11C3zSr8VrTZFRXhrOcjrS8" });

  // On every page load, read the result the hosted flow appended to the URL.
  const { token } = vyget();
  if (token) {
    // Came back from verification — confirm the token on your backend (below),
    // gate your content on the result, then strip ?vyt/?vyc from the URL.
  } else {
    // Approach (a) only: start verification, e.g. on a button click.
    await vycheck();
  }

BACKEND — keep the secret key (sk_…) in an env var (VY_SK); NEVER send it to the browser.

  Approach (b) only — start the session server-side, then redirect the user to url:
    POST https://trust.verifyyou.com/v3/initialize              (Authorization: Bearer $VY_SK)
    Request/response: InitializeRequest / InitializeResponse in the spec. Notable
    params — external_id (link your user), email/phone (bind an identity),
    verification_id / verification_external_id (target a verification by our id or
    yours); secret-key-only. Returns { "url": … }.

  Confirm the token (REQUIRED for both approaches — this verdict is authoritative):
    GET https://trust.verifyyou.com/v3/confirmations/{token}    (Authorization: Bearer $VY_SK)
    Response: ConfirmationResponse in the spec — gate access on its "verified" field.

  Optional, single-use — lock a confirmation once you accept it so the token can't be reused:
    POST https://trust.verifyyou.com/v3/confirmations/{token}/lock   (Authorization: Bearer $VY_SK)
    Response: LockResponse { "locked": boolean }. Once locked, confirmations return verified=false.

RULES — do not violate:
- Gate access on the backend confirmation result, never on vyget().verified alone.
- The secret key lives only on the server (VY_SK). Never expose it client-side.
- Don't build your own redirect or polling loop — the SDK / hosted flow owns it.
- The return params are exactly vyt (token) and vyc (verdict); reserved vy* prefix.
- Confirm a token once, then remove ?vyt/?vyc from the URL so a refresh can't reuse it.

Set VY_SK in my backend environment. The publishable key above is already filled in.