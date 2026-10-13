import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { TextEncoder } from "node:util";

import {
  changeItemStatus,
  consumeLoginTokenAndCreateSession,
  createDeviceToken,
  createFolderPath,
  createLoginToken,
  createTodoItem,
  deleteTodoItemsForUser,
  findFolderForUser,
  findItemForUser,
  findOrCreateUserByEmail,
  initializeDatabase,
  listStatuses,
  routeCaptureForMvp,
} from "../dist/db.js";
import { handleRequest } from "../dist/server.js";
import { hashRawToken } from "../dist/token.js";

const encoder = new TextEncoder();
const SQLITE_BIN = "/usr/bin/sqlite3";

test("item delete", async (suite) => {
  await suite.test("deletes owned items and cascades their status history", () => {
    withDatabase((databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-owned@example.com");
      const archivedId = requiredStatusId(user.id, "Archived");
      const first = createTodoItem(user.id, "First", "First body");
      const second = createTodoItem(user.id, "Second", "Second body");
      const keeper = createTodoItem(user.id, "Keeper", "Keeper body");
      assert.equal(changeItemStatus(first.id, user.id, archivedId, "moved"), true);
      assert.equal(countStatusChanges(databasePath, first.id), 2);

      assert.equal(deleteTodoItemsForUser(user.id, [first.id, second.id]), "deleted");

      assert.equal(findItemForUser(first.id, user.id), null);
      assert.equal(findItemForUser(second.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, first.id), 0);
      assert.equal(countStatusChanges(databasePath, second.id), 0);
      assert.notEqual(findItemForUser(keeper.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, keeper.id), 1);
    });
  });

  await suite.test("rejects the whole batch when any id is foreign, unknown, or a folder", () => {
    withDatabase((databasePath) => {
      initializeDatabase();
      const owner = findOrCreateUserByEmail("delete-owner@example.com");
      const other = findOrCreateUserByEmail("delete-other@example.com");
      const ownedItem = createTodoItem(owner.id, "Owned", "Owned body");
      const foreignItem = createTodoItem(other.id, "Foreign", "Foreign body");
      const folder = createFolderPath(owner.id, ["Errands"]);

      assert.equal(deleteTodoItemsForUser(owner.id, [ownedItem.id, foreignItem.id]), "not-found");
      assert.equal(deleteTodoItemsForUser(owner.id, [ownedItem.id, "missing-item-id"]), "not-found");
      assert.equal(deleteTodoItemsForUser(owner.id, [ownedItem.id, folder.id]), "not-found");

      assert.notEqual(findItemForUser(ownedItem.id, owner.id), null);
      assert.notEqual(findItemForUser(foreignItem.id, other.id), null);
      assert.equal(countStatusChanges(databasePath, ownedItem.id), 1);
      assert.equal(countStatusChanges(databasePath, foreignItem.id), 1);
      assert.notEqual(findFolderForUser(folder.id, owner.id), null);
    });
  });

  await suite.test("keeps the capture record when the item created from it is deleted", () => {
    withDatabase((databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-capture@example.com");
      const deviceToken = createDeviceToken(user.id, "Delete test phone", hashRawToken("delete-capture-device"));
      const captured = routeCaptureForMvp(deviceToken, {
        clientCaptureId: "delete-capture-1",
        text: "Buy paper towels",
        capturedAt: "2026-06-04T12:00:00.000Z",
        metadata: {},
      });
      const capturedItem = findItemForUser(captured.routedItemId, user.id);
      assert.equal(capturedItem?.sourceCaptureId, captured.captureId);

      assert.equal(deleteTodoItemsForUser(user.id, [captured.routedItemId]), "deleted");

      assert.equal(findItemForUser(captured.routedItemId, user.id), null);
      assert.equal(queryScalar(databasePath, `SELECT text FROM captures WHERE id = '${captured.captureId}';`), "Buy paper towels");
      assert.equal(queryScalar(databasePath, `SELECT COUNT(*) FROM captures WHERE user_id = '${user.id}';`), "1");
    });
  });

  await suite.test("API requires an authenticated session", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-auth@example.com");
      const item = createTodoItem(user.id, "Guarded", "Guarded body");

      const response = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/bulk/delete",
        body: { itemIds: [item.id], view: "inbox", folderId: null, statusIds: [] },
      });

      assert.equal(response.statusCode, 401);
      assert.notEqual(findItemForUser(item.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, item.id), 1);
    });
  });

  await suite.test("API rejects empty, malformed, duplicated-but-invalid, and oversized id lists before mutating", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-validation@example.com");
      const cookie = createSessionCookie(user.id);
      const item = createTodoItem(user.id, "Validated", "Validated body");
      const tooMany = Array.from({ length: 1_001 }, (_value, index) => `missing-${index.toString()}`);
      const invalidPayloads = [
        { itemIds: [] },
        { itemIds: [""] },
        { itemIds: ["   "] },
        { itemIds: [` ${item.id}`] },
        { itemIds: [item.id, 42] },
        { itemIds: [item.id, null] },
        { itemIds: "not-an-array" },
        { itemIds: [item.id.repeat(3)] },
        { itemIds: tooMany },
        {},
      ];

      for (const body of invalidPayloads) {
        const response = await sendJsonRequest({
          method: "POST",
          url: "/api/todos/bulk/delete",
          cookie,
          body: { view: "inbox", folderId: null, statusIds: [], ...body },
        });

        assert.equal(response.statusCode, 400, JSON.stringify(body));
      }

      assert.notEqual(findItemForUser(item.id, user.id), null);
    });
  });

  await suite.test("API deletes a deduplicated batch and returns the refreshed workspace", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-batch@example.com");
      const cookie = createSessionCookie(user.id);
      const first = createTodoItem(user.id, "Batch one", "Batch one body");
      const second = createTodoItem(user.id, "Batch two", "Batch two body");
      const kept = createTodoItem(user.id, "Kept", "Kept body");

      const response = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/bulk/delete",
        cookie,
        body: { itemIds: [first.id, first.id, second.id], view: "inbox", folderId: null, statusIds: ["active"] },
      });

      assert.equal(response.statusCode, 200);
      const payload = JSON.parse(response.body);
      const remainingIds = payload.workspace.todos.map((todo) => todo.id);
      assert.deepEqual(remainingIds, [kept.id]);
      assert.equal(findItemForUser(first.id, user.id), null);
      assert.equal(findItemForUser(second.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, first.id), 0);
    });
  });

  await suite.test("API deletes a single item when the batch has one id", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-single-api@example.com");
      const cookie = createSessionCookie(user.id);
      const item = createTodoItem(user.id, "Single", "Single body");

      const response = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/bulk/delete",
        cookie,
        body: { itemIds: [item.id], view: "inbox", folderId: null, statusIds: ["active"] },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(findItemForUser(item.id, user.id), null);
    });
  });

  await suite.test("API returns 404 for mixed owned and foreign ids and deletes nothing", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const owner = findOrCreateUserByEmail("delete-mixed-owner@example.com");
      const other = findOrCreateUserByEmail("delete-mixed-other@example.com");
      const cookie = createSessionCookie(owner.id);
      const ownedItem = createTodoItem(owner.id, "Mine", "Mine body");
      const foreignItem = createTodoItem(other.id, "Theirs", "Theirs body");

      const response = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/bulk/delete",
        cookie,
        body: { itemIds: [ownedItem.id, foreignItem.id], view: "inbox", folderId: null, statusIds: ["active"] },
      });

      assert.equal(response.statusCode, 404);
      assert.notEqual(findItemForUser(ownedItem.id, owner.id), null);
      assert.notEqual(findItemForUser(foreignItem.id, other.id), null);
      assert.equal(countStatusChanges(databasePath, ownedItem.id), 1);
      assert.equal(countStatusChanges(databasePath, foreignItem.id), 1);
    });
  });

  await suite.test("SSR single-item delete asks for confirmation before deleting", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-ssr@example.com");
      const cookie = createSessionCookie(user.id);
      const item = createTodoItem(user.id, "SSR item", "SSR body");
      const returnTo = encodeURIComponent("/");

      const confirmation = await sendRequest({
        method: "GET",
        url: `/todos/${item.id}/delete?returnTo=${returnTo}`,
        headers: { cookie },
      });

      assert.equal(confirmation.statusCode, 200);
      assert.match(confirmation.body, new RegExp(`<form action="/todos/${item.id}/delete" method="post"`, "u"));
      assert.match(confirmation.body, /Delete permanently/u);
      assert.match(confirmation.body, /cannot be undone/u);
      assert.notEqual(findItemForUser(item.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, item.id), 1);
    });
  });

  await suite.test("SSR confirmation and delete require an authenticated session", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-ssr-auth@example.com");
      const item = createTodoItem(user.id, "Guarded SSR", "Guarded SSR body");

      const confirmation = await sendRequest({ method: "GET", url: `/todos/${item.id}/delete` });
      const deletion = await sendRequest({
        method: "POST",
        url: `/todos/${item.id}/delete`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "returnTo=%2F",
      });

      assert.equal(confirmation.statusCode, 303);
      assert.equal(confirmation.headers["Location"], "/login");
      assert.equal(deletion.statusCode, 303);
      assert.equal(deletion.headers["Location"], "/login");
      assert.notEqual(findItemForUser(item.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, item.id), 1);
    });
  });

  await suite.test("SSR delete removes an owned item and returns to a safe location", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("delete-ssr-post@example.com");
      const cookie = createSessionCookie(user.id);
      const item = createTodoItem(user.id, "SSR delete", "SSR delete body");

      const response = await sendRequest({
        method: "POST",
        url: `/todos/${item.id}/delete`,
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: `returnTo=${encodeURIComponent("/")}`,
      });

      assert.equal(response.statusCode, 303);
      assert.equal(response.headers["Location"], "/");
      assert.equal(findItemForUser(item.id, user.id), null);
      assert.equal(countStatusChanges(databasePath, item.id), 0);
    });
  });

  await suite.test("SSR delete returns 404 for another user's item and deletes nothing", async () => {
    await withDatabaseAsync(async (databasePath) => {
      initializeDatabase();
      const owner = findOrCreateUserByEmail("delete-ssr-owner@example.com");
      const other = findOrCreateUserByEmail("delete-ssr-other@example.com");
      const cookie = createSessionCookie(other.id);
      const item = createTodoItem(owner.id, "Not yours", "Not yours body");

      const response = await sendRequest({
        method: "POST",
        url: `/todos/${item.id}/delete`,
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: "returnTo=%2F",
      });

      assert.equal(response.statusCode, 404);
      assert.notEqual(findItemForUser(item.id, owner.id), null);
      assert.equal(countStatusChanges(databasePath, item.id), 1);
    });
  });
});

function requiredStatusId(userId, name) {
  const status = listStatuses(userId).find((candidate) => candidate.name === name);
  assert.ok(status, `Missing status ${name}`);
  return status.id;
}

function countStatusChanges(databasePath, itemId) {
  return Number(queryScalar(databasePath, `SELECT COUNT(*) FROM item_status_changes WHERE item_id = '${itemId}';`));
}

function queryScalar(databasePath, statement) {
  return execFileSync(SQLITE_BIN, [databasePath], {
    encoding: "utf8",
    input: `PRAGMA foreign_keys = ON;\n${statement}`,
  }).trim();
}

function createSessionCookie(userId) {
  const rawLoginToken = `login-${userId}`;
  const rawSessionToken = `session-${userId}`;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60_000).toISOString();
  createLoginToken(userId, hashRawToken(rawLoginToken), expires);
  const session = consumeLoginTokenAndCreateSession(hashRawToken(rawLoginToken), hashRawToken(rawSessionToken), expires, now);
  assert.notEqual(session, null);
  return `todo_session=${rawSessionToken}`;
}

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "todo1-item-delete-test-"));
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
  const directory = mkdtempSync(join(tmpdir(), "todo1-item-delete-test-"));
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

function restoreDatabasePath(previousDatabasePath) {
  if (previousDatabasePath === undefined) {
    delete env.TODO_DATABASE_PATH;
  } else {
    env.TODO_DATABASE_PATH = previousDatabasePath;
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

async function sendJsonRequest({ method, url, cookie, body }) {
  return await sendRequest({
    method,
    url,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
