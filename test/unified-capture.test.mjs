import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { URL, fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";

import {
  createDeviceToken,
  createFolderPath,
  createTodoItem,
  findOrCreateUserByEmail,
  initializeDatabase,
  revokeDeviceToken,
} from "../dist/db.js";
import {
  getHost,
  getPort,
  getPublicBaseUrl,
  getTodoDatabasePath,
} from "../dist/process-env.js";
import { handleRequest } from "../dist/server.js";
import { hashRawToken } from "../dist/token.js";

const encoder = new TextEncoder();
const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const validCapture = {
  client_capture_id: "12d78b1a-62e7-49af-ae2f-1a6ebfc83c39",
  text: "Call the dentist tomorrow",
  captured_at: "2026-05-31T17:30:00.000Z",
  metadata: { source: "phone", locale: "en-US" },
};

test("unified capture server MVP", async (suite) => {
  await suite.test("defaults TODO_DATABASE_PATH to todo.sqlite", () => {
    const previousDatabasePath = env.TODO_DATABASE_PATH;
    delete env.TODO_DATABASE_PATH;

    try {
      assert.equal(getTodoDatabasePath(), "todo.sqlite");
    } finally {
      restoreDatabasePath(previousDatabasePath);
    }
  });

  await suite.test("defaults HOST and PORT and leaves PUBLIC_BASE_URL unset", () => {
    withEnvironment({ HOST: undefined, PORT: undefined, PUBLIC_BASE_URL: undefined }, () => {
      assert.equal(getHost(), "127.0.0.1");
      assert.equal(getPort(), 3000);
      assert.equal(getPublicBaseUrl(), null);
    });
  });

  await suite.test("reads configured HOST PORT and PUBLIC_BASE_URL", () => {
    withEnvironment({
      HOST: "0.0.0.0",
      PORT: "4312",
      PUBLIC_BASE_URL: "https://todo.example.com/",
    }, () => {
      assert.equal(getHost(), "0.0.0.0");
      assert.equal(getPort(), 4312);
      assert.equal(getPublicBaseUrl(), "https://todo.example.com");
    });
  });

  await suite.test("rejects invalid HOST PORT and PUBLIC_BASE_URL values", () => {
    withEnvironment({ HOST: "   " }, () => {
      assert.throws(() => {
        getHost();
      }, /HOST must not be empty\./u);
    });

    for (const port of ["0", "65536", "abc", "12.3"]) {
      withEnvironment({ PORT: port }, () => {
        assert.throws(() => {
          getPort();
        }, /PORT must be an integer between 1 and 65535\./u);
      });
    }

    for (const publicBaseUrl of [
      "   ",
      "/relative",
      "ftp://todo.example.com",
      "https://user:pass@todo.example.com",
      "https://todo.example.com?debug=1",
      "https://todo.example.com#hash",
      "https://todo.example.com/app",
    ]) {
      withEnvironment({ PUBLIC_BASE_URL: publicBaseUrl }, () => {
        assert.throws(() => {
          getPublicBaseUrl();
        }, /PUBLIC_BASE_URL/u);
      });
    }
  });

  await suite.test("migrates an existing database additively", () => {
    withDatabase((databasePath) => {
      executeSql(databasePath, `
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
        CREATE TABLE statuses (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
          category TEXT NOT NULL, show_in_todo_view INTEGER NOT NULL, is_default_for_new_items INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (user_id, name)
        );
        CREATE TABLE items (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), node_id TEXT,
          status_id TEXT NOT NULL REFERENCES statuses(id), kind TEXT NOT NULL, title TEXT, body TEXT NOT NULL,
          status_changed_at TEXT NOT NULL, todo_rank TEXT, todo_rank_changed_at TEXT, created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO users VALUES ('old-user', 'old@example.com', '2026-01-01T00:00:00.000Z');
        INSERT INTO statuses VALUES (
          'old-active', 'old-user', 'Active', 'active', 1, 1,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO items VALUES (
          'old-item', 'old-user', NULL, 'old-active', 'todo', NULL, 'Keep me',
          '2026-01-01T00:00:00.000Z', 'a0', NULL,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);

      initializeDatabase();

      assert.equal(queryRows(databasePath, "SELECT source_capture_id FROM items WHERE id = 'old-item';")[0]?.source_capture_id, null);
      assert.deepEqual(
        queryRows(databasePath, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('captures', 'device_tokens') ORDER BY name;"),
        [{ name: "captures" }, { name: "device_tokens" }],
      );
      assert.deepEqual(
        queryRows(databasePath, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_items_source_capture';"),
        [{ name: "idx_items_source_capture" }],
      );
      assert.deepEqual(
        queryRows(databasePath, "SELECT name FROM pragma_table_info('captures') WHERE name IN ('text', 'transcript') ORDER BY name;"),
        [{ name: "text" }],
      );
    });
  });

  await suite.test("migrates interim capture transcripts to text without losing data or constraints", () => {
    withDatabase((databasePath) => {
      executeSql(databasePath, `
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
        CREATE TABLE device_tokens (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT
        );
        CREATE TABLE captures (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_token_id TEXT NOT NULL REFERENCES device_tokens(id) ON DELETE RESTRICT,
          client_capture_id TEXT NOT NULL, transcript TEXT NOT NULL, captured_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (device_token_id, client_capture_id)
        );
        INSERT INTO users VALUES ('interim-user', 'interim@example.com', '2026-01-01T00:00:00.000Z');
        INSERT INTO device_tokens VALUES (
          'interim-device', 'interim-user', 'Interim phone', 'interim-hash', '2026-01-01T00:00:00.000Z', NULL
        );
        INSERT INTO captures VALUES (
          'interim-capture', 'interim-user', 'interim-device', 'interim-client-capture', 'Keep transcript',
          '2026-01-02T03:04:05.000Z', '{"source":"interim"}', '2026-01-02T03:04:06.000Z'
        );
      `);

      initializeDatabase();

      assert.deepEqual(
        queryRows(databasePath, `SELECT text, captured_at, metadata_json FROM captures WHERE id = 'interim-capture';`),
        [{ text: "Keep transcript", captured_at: "2026-01-02T03:04:05.000Z", metadata_json: '{"source":"interim"}' }],
      );
      assert.deepEqual(
        queryRows(databasePath, `SELECT name, type, "notnull" AS is_not_null FROM pragma_table_info('captures') WHERE name = 'text';`),
        [{ name: "text", type: "TEXT", is_not_null: 1 }],
      );
      assert.throws(() => {
        executeSql(databasePath, `
          INSERT INTO captures (
            id, user_id, device_token_id, client_capture_id, transcript, captured_at, metadata_json, created_at
          ) VALUES (
            'duplicate-capture', 'interim-user', 'interim-device', 'interim-client-capture', 'Duplicate',
            '2026-01-03T00:00:00.000Z', '{}', '2026-01-03T00:00:00.000Z'
          );
        `);
      }, /UNIQUE constraint failed: captures\.device_token_id, captures\.client_capture_id/u);
      assert.throws(() => {
        executeSql(databasePath, `
          INSERT INTO captures (
            id, user_id, device_token_id, client_capture_id, transcript, captured_at, metadata_json, created_at
          ) VALUES (
            'invalid-user-capture', 'missing-user', 'interim-device', 'new-client-capture', 'Invalid',
            '2026-01-03T00:00:00.000Z', '{}', '2026-01-03T00:00:00.000Z'
          );
        `);
      }, /FOREIGN KEY constraint failed/u);
    });
  });

  await suite.test("ingests and replays text captures after migrating an interim transcript schema", async () => {
    await withDatabaseAsync(async (databasePath) => {
      executeSql(databasePath, `
        CREATE TABLE captures (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_token_id TEXT NOT NULL REFERENCES device_tokens(id) ON DELETE RESTRICT,
          client_capture_id TEXT NOT NULL, transcript TEXT NOT NULL, captured_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (device_token_id, client_capture_id)
        );
      `);

      initializeDatabase();
      const user = findOrCreateUserByEmail("migrated-ingest@example.com");
      const rawToken = "migrated-ingestion-token";
      createDeviceToken(user.id, "Migrated phone", hashRawToken(rawToken));

      const initialResponse = await postCapture(`Bearer ${rawToken}`, validCapture);
      assert.equal(initialResponse.statusCode, 201);
      const initialBody = JSON.parse(initialResponse.body);
      assert.equal(initialBody.duplicate, false);
      assert.deepEqual(
        queryRows(databasePath, "SELECT text, transcript FROM captures;"),
        [{ text: validCapture.text, transcript: validCapture.text }],
      );

      const replayResponse = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        text: "A replay cannot rewrite migrated capture text",
      });
      assert.equal(replayResponse.statusCode, 201);
      assert.deepEqual(JSON.parse(replayResponse.body), {
        capture_id: initialBody.capture_id,
        routed_item_id: initialBody.routed_item_id,
        duplicate: true,
      });
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM captures;")[0]?.count, 1);
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM items;")[0]?.count, 1);
      assert.deepEqual(
        queryRows(databasePath, "SELECT text, transcript FROM captures;"),
        [{ text: validCapture.text, transcript: validCapture.text }],
      );
    });
  });

  await suite.test("creates a normalized hashed device token through the CLI", () => {
    withDatabase((databasePath) => {
      const result = spawnSync(
        "npm",
        ["run", "--silent", "create-device-token", "--", "  USER@Example.COM ", "Michael phone"],
        {
          cwd: projectDirectory,
          encoding: "utf8",
          env: { ...env, TODO_DATABASE_PATH: databasePath },
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const rawToken = result.stdout.trim();
      assert.match(rawToken, /^[0-9a-f]{64}$/u);
      assert.equal(result.stdout.match(new RegExp(rawToken, "gu"))?.length, 1);
      assert.deepEqual(queryRows(databasePath, "SELECT email FROM users;"), [{ email: "user@example.com" }]);
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM statuses;")[0]?.count, 4);
      assert.deepEqual(
        queryRows(databasePath, "SELECT name, token_hash FROM device_tokens;"),
        [{ name: "Michael phone", token_hash: hashRawToken(rawToken) }],
      );
      assert.equal(queryRows(databasePath, `SELECT COUNT(*) AS count FROM device_tokens WHERE token_hash = '${rawToken}';`)[0]?.count, 0);
    });
  });

  await suite.test("returns JSON 401 for missing, unknown, and revoked bearer tokens", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("auth@example.com");
      const revokedRawToken = "revoked-token";
      createDeviceToken(user.id, "Revoked phone", hashRawToken(revokedRawToken));
      revokeDeviceToken(hashRawToken(revokedRawToken));

      for (const authorization of [undefined, "Bearer unknown-token", `Bearer ${revokedRawToken}`]) {
        const response = await postCapture(authorization, validCapture);
        assert.equal(response.statusCode, 401);
        assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized" });
        assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
      }
    });
  });

  await suite.test("serves unauthenticated healthz after init", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const response = await sendRequest({ method: "GET", url: "/healthz" });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
      assert.deepEqual(JSON.parse(response.body), { ok: true });
    });
  });

  await suite.test("uses request host for magic links when PUBLIC_BASE_URL is unset", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();

      await withEnvironment({ PUBLIC_BASE_URL: undefined }, async () => {
        const capturedLogs = captureConsoleLogs();

        try {
          const response = await sendRequest({
            method: "POST",
            url: "/login",
            headers: { host: "127.0.0.1:4010" },
            body: "email=person%40example.com",
          });

          assert.equal(response.statusCode, 303);
          assert.equal(response.headers.Location, "/login?sent=1");
          assert.match(capturedLogs.lines.at(-1) ?? "", /http:\/\/127\.0\.0\.1:4010\/auth\/magic\?token=/u);
        } finally {
          capturedLogs.restore();
        }
      });
    });
  });

  await suite.test("uses HTTPS PUBLIC_BASE_URL for magic links and secure session cookies", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();

      await withEnvironment({ PUBLIC_BASE_URL: "https://todo.example.com" }, async () => {
        const capturedLogs = captureConsoleLogs();

        try {
          const loginResponse = await sendRequest({
            method: "POST",
            url: "/login",
            headers: { host: "127.0.0.1:3000" },
            body: "email=secure%40example.com",
          });

          assert.equal(loginResponse.statusCode, 303);
          assert.equal(loginResponse.headers.Location, "/login?sent=1");

          const magicLinkLog = capturedLogs.lines.at(-1) ?? "";
          assert.match(magicLinkLog, /https:\/\/todo\.example\.com\/auth\/magic\?token=/u);

          const magicLinkUrl = new URL(extractMagicLink(magicLinkLog));
          const authResponse = await sendRequest({
            method: "GET",
            url: `${magicLinkUrl.pathname}${magicLinkUrl.search}`,
            headers: { host: "127.0.0.1:3000" },
          });

          assert.equal(authResponse.statusCode, 303);
          assert.equal(authResponse.headers.Location, "/");
          assert.match(
            authResponse.headers["Set-Cookie"] ?? "",
            /^todo_session=[^;]+; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax; Secure$/u,
          );
        } finally {
          capturedLogs.restore();
        }
      });
    });
  });

  await suite.test("rejects malformed capture envelopes and phone routing fields", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("validation@example.com");
      const rawToken = "validation-token";
      createDeviceToken(user.id, "Validation phone", hashRawToken(rawToken));
      const malformedCaptures = [
        { ...validCapture, client_capture_id: "not-a-uuid" },
        { ...validCapture, text: "  " },
        { ...validCapture, captured_at: "tomorrow" },
        { ...validCapture, captured_at: "2026-02-31T17:30:00.000Z" },
        { ...validCapture, metadata: [] },
        { ...validCapture, transcript: "Old protocol field" },
        { ...validCapture, status: "Active" },
        { ...validCapture, status_id: "active" },
        { ...validCapture, kind: "todo" },
        { ...validCapture, rank: "a0" },
        { ...validCapture, routing_instructions: "put it in Deferred" },
      ];

      for (const capture of malformedCaptures) {
        const response = await postCapture(`Bearer ${rawToken}`, capture);
        assert.equal(response.statusCode, 400);
        assert.equal(typeof JSON.parse(response.body).error, "string");
      }

      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM captures;")[0]?.count, 0);
    });
  });

  await suite.test("rejects oversized capture request bodies with JSON 400", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("body-limit@example.com");
      const rawToken = "body-limit-token";
      createDeviceToken(user.id, "Large payload phone", hashRawToken(rawToken));

      const response = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        text: "x".repeat(1_050_000),
      });

      assert.equal(response.statusCode, 400);
      assert.deepEqual(JSON.parse(response.body), { error: "Request body is too large." });
      assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM captures;")[0]?.count, 0);
    });
  });

  await suite.test("routes a capture once and replays without inserts", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("ingest@example.com");
      const browserItem = createTodoItem(user.id, "Browser todo", "Created in browser");
      const rawToken = "ingestion-token";
      createDeviceToken(user.id, "Michael phone", hashRawToken(rawToken));

      const initialResponse = await postCapture(`Bearer ${rawToken}`, validCapture);
      assert.equal(initialResponse.statusCode, 201);
      const initialBody = JSON.parse(initialResponse.body);
      assert.equal(initialBody.duplicate, false);

      const captureRows = queryRows(databasePath, "SELECT id, text, captured_at, metadata_json FROM captures;");
      assert.deepEqual(captureRows, [{
        id: initialBody.capture_id,
        text: validCapture.text,
        captured_at: validCapture.captured_at,
        metadata_json: JSON.stringify(validCapture.metadata),
      }]);

      const routedRows = queryRows(databasePath, `
        SELECT items.id, items.node_id, items.status_id, statuses.name AS status_name, items.kind,
          items.title, items.body, items.source_capture_id, items.todo_rank, items.todo_rank_changed_at
        FROM items
        JOIN statuses ON statuses.id = items.status_id
        WHERE items.id = '${initialBody.routed_item_id}';
      `);
      assert.equal(routedRows.length, 1);
      assert.equal(routedRows[0]?.node_id, null);
      assert.equal(routedRows[0]?.status_name, "Active");
      assert.equal(routedRows[0]?.kind, "todo");
      assert.equal(routedRows[0]?.title, null);
      assert.equal(routedRows[0]?.body, validCapture.text);
      assert.equal(routedRows[0]?.source_capture_id, initialBody.capture_id);
      assert.equal(routedRows[0]?.todo_rank_changed_at, null);
      assert.ok(routedRows[0]?.todo_rank < browserItem.todoRank);
      assert.equal(queryRows(databasePath, `SELECT source_capture_id FROM items WHERE id = '${browserItem.id}';`)[0]?.source_capture_id, null);
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM item_status_changes;")[0]?.count, 2);

      const replayResponse = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        text: "A replay cannot rewrite immutable capture text",
      });
      assert.equal(replayResponse.statusCode, 201);
      assert.deepEqual(JSON.parse(replayResponse.body), {
        capture_id: initialBody.capture_id,
        routed_item_id: initialBody.routed_item_id,
        duplicate: true,
      });
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM captures;")[0]?.count, 1);
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM items;")[0]?.count, 2);
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM item_status_changes;")[0]?.count, 2);
      assert.equal(queryRows(databasePath, "SELECT text FROM captures;")[0]?.text, validCapture.text);
    });
  });

  await suite.test("routes spoken list captures into Errands list folders and reuses existing folders", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("list-route@example.com");
      const existingCostco = createFolderPath(user.id, ["Errands", "Costco"]);
      const rawToken = "list-route-token";
      createDeviceToken(user.id, "Michael phone", hashRawToken(rawToken));

      const initialResponse = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        client_capture_id: "7f0d5e94-3d3f-44b7-a60a-cc1d6a989f5d",
        text: "add peanut butter to my costco list",
      });
      assert.equal(initialResponse.statusCode, 201);
      const initialBody = JSON.parse(initialResponse.body);
      assert.equal(initialBody.duplicate, false);

      const routedRows = queryRows(databasePath, `
        SELECT items.node_id, items.title, items.body, items.source_capture_id
        FROM items
        WHERE items.id = '${initialBody.routed_item_id}';
      `);
      assert.deepEqual(routedRows, [{
        node_id: existingCostco.id,
        title: null,
        body: "peanut butter",
        source_capture_id: initialBody.capture_id,
      }]);
      assert.equal(queryRows(databasePath, `SELECT COUNT(*) AS count FROM nodes WHERE user_id = '${user.id}';`)[0]?.count, 2);

      const replayResponse = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        client_capture_id: "7f0d5e94-3d3f-44b7-a60a-cc1d6a989f5d",
        text: "add something else to my costco list",
      });
      assert.equal(replayResponse.statusCode, 201);
      assert.deepEqual(JSON.parse(replayResponse.body), {
        capture_id: initialBody.capture_id,
        routed_item_id: initialBody.routed_item_id,
        duplicate: true,
      });
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM captures;")[0]?.count, 1);
      assert.equal(queryRows(databasePath, "SELECT COUNT(*) AS count FROM items;")[0]?.count, 1);
      assert.equal(queryRows(databasePath, `SELECT COUNT(*) AS count FROM nodes WHERE user_id = '${user.id}';`)[0]?.count, 2);
    });
  });

  await suite.test("routes agent captures into a reused top-level Agent folder", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("agent-route@example.com");
      const existingAgent = createFolderPath(user.id, ["agent"]);
      const rawToken = "agent-route-token";
      createDeviceToken(user.id, "Michael phone", hashRawToken(rawToken));

      const response = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        client_capture_id: "69ec2fb7-d7f4-4d2e-8ea4-d0829ba97456",
        text: "agent, search facebook marketplace for swingtop bottles",
      });
      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.equal(body.duplicate, false);

      assert.deepEqual(queryRows(databasePath, `
        SELECT items.node_id, items.title, items.body, items.source_capture_id
        FROM items
        WHERE items.id = '${body.routed_item_id}';
      `), [{
        node_id: existingAgent.id,
        title: null,
        body: "search facebook marketplace for swingtop bottles",
        source_capture_id: body.capture_id,
      }]);
      assert.deepEqual(queryRows(databasePath, `SELECT name, parent_id FROM nodes WHERE user_id = '${user.id}';`), [{
        name: "agent",
        parent_id: null,
      }]);
    });
  });

  await suite.test("routes issue and meeting note captures into their folder trees", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("issue-meeting-route@example.com");
      const rawToken = "issue-meeting-route-token";
      createDeviceToken(user.id, "Michael phone", hashRawToken(rawToken));

      const issueResponse = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        client_capture_id: "124f49c5-3a65-4d2a-98d0-072b791bdf90",
        text: "add an issue for kitchen sink that order a replacement aerator",
      });
      assert.equal(issueResponse.statusCode, 201);
      const issueBody = JSON.parse(issueResponse.body);

      const meetingResponse = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        client_capture_id: "922bf999-134c-479c-960c-e0425731d2e6",
        text: "add meeting note to regen hub that ask about the launch checklist",
      });
      assert.equal(meetingResponse.statusCode, 201);
      const meetingBody = JSON.parse(meetingResponse.body);

      assert.deepEqual(queryRows(databasePath, `
        SELECT parent.name AS parent_name, child.name AS child_name, items.title, items.body
        FROM items
        JOIN nodes AS child ON child.id = items.node_id
        JOIN nodes AS parent ON parent.id = child.parent_id
        WHERE items.id IN ('${issueBody.routed_item_id}', '${meetingBody.routed_item_id}')
        ORDER BY parent.name;
      `), [
        {
          parent_name: "Issues",
          child_name: "kitchen sink",
          title: null,
          body: "order a replacement aerator",
        },
        {
          parent_name: "Meetings",
          child_name: "regen hub",
          title: null,
          body: "ask about the launch checklist",
        },
      ]);
    });
  });

  await suite.test("routes message captures into Messages", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("message-route@example.com");
      const rawToken = "message-route-token";
      createDeviceToken(user.id, "Michael phone", hashRawToken(rawToken));

      const response = await postCapture(`Bearer ${rawToken}`, {
        ...validCapture,
        client_capture_id: "d6246e69-7d4c-41f5-90d0-741865da4a29",
        text: "message Sam that I am running ten minutes late",
      });
      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body);

      assert.deepEqual(queryRows(databasePath, `
        SELECT nodes.name AS folder_name, items.title, items.body, items.source_capture_id
        FROM items
        JOIN nodes ON nodes.id = items.node_id
        WHERE items.id = '${body.routed_item_id}';
      `), [{
        folder_name: "Messages",
        title: null,
        body: "Sam that I am running ten minutes late",
        source_capture_id: body.capture_id,
      }]);
    });
  });
});

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "todo1-test-"));
  const databasePath = join(directory, "todo.sqlite");
  const previousDatabasePath = env.TODO_DATABASE_PATH;
  env.TODO_DATABASE_PATH = databasePath;

  try {
    return run(databasePath);
  } finally {
    restoreDatabasePath(previousDatabasePath);
    rmSync(directory, { recursive: true, force: true });
  }
}

async function withDatabaseAsync(run) {
  const directory = mkdtempSync(join(tmpdir(), "todo1-test-"));
  const databasePath = join(directory, "todo.sqlite");
  const previousDatabasePath = env.TODO_DATABASE_PATH;
  env.TODO_DATABASE_PATH = databasePath;

  try {
    return await run(databasePath);
  } finally {
    restoreDatabasePath(previousDatabasePath);
    rmSync(directory, { recursive: true, force: true });
  }
}

function withEnvironment(updates, run) {
  const previousValues = {
    HOST: env.HOST,
    PORT: env.PORT,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
  };

  for (const [name, value] of Object.entries(updates)) {
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }

  try {
    const result = run();

    if (result !== null && typeof result === "object" && "then" in result) {
      return result.finally(() => {
        restoreEnvironmentValue("HOST", previousValues.HOST);
        restoreEnvironmentValue("PORT", previousValues.PORT);
        restoreEnvironmentValue("PUBLIC_BASE_URL", previousValues.PUBLIC_BASE_URL);
      });
    }

    restoreEnvironmentValue("HOST", previousValues.HOST);
    restoreEnvironmentValue("PORT", previousValues.PORT);
    restoreEnvironmentValue("PUBLIC_BASE_URL", previousValues.PUBLIC_BASE_URL);
    return result;
  } catch (error) {
    restoreEnvironmentValue("HOST", previousValues.HOST);
    restoreEnvironmentValue("PORT", previousValues.PORT);
    restoreEnvironmentValue("PUBLIC_BASE_URL", previousValues.PUBLIC_BASE_URL);
    throw error;
  }
}

function restoreDatabasePath(previousDatabasePath) {
  if (previousDatabasePath === undefined) {
    delete env.TODO_DATABASE_PATH;
  } else {
    env.TODO_DATABASE_PATH = previousDatabasePath;
  }
}

function restoreEnvironmentValue(name, previousValue) {
  if (previousValue === undefined) {
    delete env[name];
  } else {
    env[name] = previousValue;
  }
}

async function postCapture(authorization, capture) {
  const headers = authorization === undefined ? {} : { authorization };
  return sendRequest({ method: "POST", url: "/items", headers, body: JSON.stringify(capture) });
}

async function sendRequest({ method, url, headers = {}, body = "" }) {
  const request = createRequest({ method, url, headers, body });
  const response = createResponse();
  await handleRequest(request, response);
  return response;
}

function createRequest({ method, url, headers, body }) {
  return {
    method,
    url,
    headers,
    on(event, listener) {
      if (event === "data" && body.length > 0) {
        listener(encoder.encode(body));
      }

      if (event === "end") {
        listener();
      }
    },
  };
}

function captureConsoleLogs() {
  const lines = [];
  const previousLog = globalThis.console.log;

  globalThis.console.log = (...args) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };

  return {
    lines,
    restore() {
      globalThis.console.log = previousLog;
    },
  };
}

function extractMagicLink(logLine) {
  const match = /https?:\/\/\S+/u.exec(logLine);

  if (match === null) {
    throw new Error(`Expected magic link in log line: ${logLine}`);
  }

  return match[0];
}

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function executeSql(databasePath, statement) {
  execFileSync("/usr/bin/sqlite3", [databasePath, `PRAGMA foreign_keys = ON;\n${statement}`], { encoding: "utf8" });
}

function queryRows(databasePath, statement) {
  const output = execFileSync("/usr/bin/sqlite3", ["-json", databasePath, statement], { encoding: "utf8" }).trim();
  return output.length === 0 ? [] : JSON.parse(output);
}
