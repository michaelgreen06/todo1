import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";
import { TextEncoder } from "node:util";

import {
  changeItemStatus,
  consumeLoginTokenAndCreateSession,
  createFolderPath,
  createLoginToken,
  createTodoItem,
  deleteEmptyLeafFolder,
  findOrCreateUserByEmail,
  initializeDatabase,
  listFolders,
  listStatuses,
  listTodoItems,
  moveTodoItemToLocation,
  renameFolder,
  reorderVisibleTodoItem,
} from "../dist/db.js";
import { handleRequest } from "../dist/server.js";
import { hashRawToken } from "../dist/token.js";

const encoder = new TextEncoder();

test("folder hierarchy and inbox", async (suite) => {
  await suite.test("files items directly, reuses case-insensitive paths, and reports direct counts", () => {
    withDatabase(() => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("folders@example.com");
      const activeId = statusId(user.id, "Active");
      const regen = createFolderPath(user.id, ["Meetings", "Regen Hub"]);
      const dated = createFolderPath(user.id, ["meetings", "regen hub", "2026-06-03"]);
      const reused = createFolderPath(user.id, ["MEETINGS", "REGEN HUB"]);
      const inbox = createTodoItem(user.id, "Inbox only", "Inbox body");
      const filed = createTodoItem(user.id, "Direct only", "Folder body", regen.id);
      createTodoItem(user.id, "Deep only", "Deep body", dated.id);

      assert.equal(reused.id, regen.id);
      assert.equal(reused.name, "Regen Hub");
      assert.deepEqual(listTodoItems(user.id, null, [activeId]).map((item) => item.id), [inbox.id]);
      assert.deepEqual(listTodoItems(user.id, regen.id, [activeId]).map((item) => item.id), [filed.id]);
      assert.deepEqual(listFolders(user.id, [activeId]).map((folder) => [folder.name, folder.directItemCount]), [
        ["2026-06-03", 1],
        ["Meetings", 0],
        ["Regen Hub", 1],
      ]);
    });
  });

  await suite.test("moves to destination top and preserves folder rank through status changes", () => {
    withDatabase(() => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("ordering@example.com");
      const statuses = listStatuses(user.id);
      const activeId = requiredStatusId(statuses, "Active");
      const archivedId = requiredStatusId(statuses, "Archived");
      const costco = createFolderPath(user.id, ["Errands", "Costco"]);
      const oldCostco = createTodoItem(user.id, "Paper towels", "Buy towels", costco.id);
      const peanutButter = createTodoItem(user.id, "Peanut butter", "Buy peanut butter");

      assert.equal(moveTodoItemToLocation(peanutButter.id, user.id, costco.id), true);
      const moved = listTodoItems(user.id, costco.id, [activeId])[0];
      assert.equal(moved?.id, peanutButter.id);
      assert.ok((moved?.todoRank ?? "") < (oldCostco.todoRank ?? ""));

      const rankBeforeArchive = moved?.todoRank;
      assert.equal(changeItemStatus(peanutButter.id, user.id, archivedId, null), true);
      const archived = listTodoItems(user.id, costco.id, [archivedId])[0];
      assert.equal(archived?.nodeId, costco.id);
      assert.equal(archived?.todoRank, rankBeforeArchive);
      assert.deepEqual(listTodoItems(user.id, costco.id, [activeId]).map((item) => item.id), [oldCostco.id]);
    });
  });

  await suite.test("reorders visible filtered items while hidden item ranks remain unchanged", () => {
    withDatabase(() => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("filtered-order@example.com");
      const statuses = listStatuses(user.id);
      const activeId = requiredStatusId(statuses, "Active");
      const archivedId = requiredStatusId(statuses, "Archived");
      const folder = createFolderPath(user.id, ["Project"]);
      const first = createTodoItem(user.id, "First", "First", folder.id);
      const hidden = createTodoItem(user.id, "Hidden", "Hidden", folder.id);
      const third = createTodoItem(user.id, "Third", "Third", folder.id);
      assert.equal(changeItemStatus(hidden.id, user.id, archivedId, null), true);
      const hiddenRank = listTodoItems(user.id, folder.id, [archivedId])[0]?.todoRank;

      assert.equal(reorderVisibleTodoItem(user.id, {
        movedId: first.id,
        previousId: null,
        nextId: third.id,
      }, folder.id, [activeId]), true);
      assert.deepEqual(listTodoItems(user.id, folder.id, [activeId]).map((item) => item.id), [first.id, third.id]);
      assert.equal(listTodoItems(user.id, folder.id, [archivedId])[0]?.todoRank, hiddenRank);
    });
  });

  await suite.test("renames uniquely and deletes only empty leaf folders", () => {
    withDatabase(() => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("mutation@example.com");
      const alpha = createFolderPath(user.id, ["Alpha"]);
      const beta = createFolderPath(user.id, ["Beta"]);
      const child = createFolderPath(user.id, ["Alpha", "Child"]);

      assert.equal(renameFolder(beta.id, user.id, "alpha"), "duplicate");
      assert.equal(renameFolder(beta.id, user.id, "Gamma"), "renamed");
      assert.equal(deleteEmptyLeafFolder(alpha.id, user.id), "not-empty");
      assert.equal(deleteEmptyLeafFolder(child.id, user.id), "deleted");
      createTodoItem(user.id, "Filed", "Filed", alpha.id);
      assert.equal(deleteEmptyLeafFolder(alpha.id, user.id), "not-empty");
    });
  });

  await suite.test("protects folder pages and mutations by ownership", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const owner = findOrCreateUserByEmail("owner@example.com");
      const intruder = findOrCreateUserByEmail("intruder@example.com");
      const secret = createFolderPath(owner.id, ["Secret"]);
      const intruderItem = createTodoItem(intruder.id, "Intruder item", "Intruder body");
      const cookie = createSessionCookie(intruder.id);

      const readResponse = await sendRequest({ method: "GET", url: `/folders/${secret.id}`, headers: { cookie } });
      assert.equal(readResponse.statusCode, 404);

      const moveResponse = await sendRequest({
        method: "POST",
        url: `/todos/${intruderItem.id}/location`,
        headers: { cookie },
        body: `folderId=${encodeURIComponent(secret.id)}&returnTo=%2F`,
      });
      assert.equal(moveResponse.statusCode, 404);

      const pathMoveResponse = await sendRequest({
        method: "POST",
        url: `/todos/${secret.id}/location`,
        headers: { cookie },
        body: "folderPath=Should+Not+Exist&returnTo=%2F",
      });
      assert.equal(pathMoveResponse.statusCode, 404);
      assert.deepEqual(listFolders(intruder.id, []), []);
    });
  });

  await suite.test("creates folders and web items in the viewed location through SSR forms", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("forms@example.com");
      const cookie = createSessionCookie(user.id);
      const folderResponse = await sendRequest({
        method: "POST",
        url: "/folders",
        headers: { cookie },
        body: "folderPath=Meetings+%2F+Regen+Hub&returnTo=%2F",
      });
      assert.equal(folderResponse.statusCode, 303);
      const regen = listFolders(user.id, []).find((folder) => folder.name === "Regen Hub");
      assert.notEqual(regen, undefined);

      const createResponse = await sendRequest({
        method: "POST",
        url: "/todos",
        headers: { cookie },
        body: `title=Agenda&body=Prepare+agenda&folderId=${encodeURIComponent(regen.id)}&returnTo=${encodeURIComponent(folderResponse.headers.Location)}`,
      });
      assert.equal(createResponse.statusCode, 303);
      const activeId = statusId(user.id, "Active");
      assert.deepEqual(listTodoItems(user.id, regen.id, [activeId]).map((item) => item.title), ["Agenda"]);
      assert.deepEqual(listTodoItems(user.id, null, [activeId]), []);
    });
  });

  await suite.test("renders default Active filter and preserves multi-status folder navigation", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("render@example.com");
      const statuses = listStatuses(user.id);
      const activeId = requiredStatusId(statuses, "Active");
      const archivedId = requiredStatusId(statuses, "Archived");
      const folder = createFolderPath(user.id, ["Visible Folder"]);
      const active = createTodoItem(user.id, "Active visible", "Active body", folder.id);
      const archived = createTodoItem(user.id, "Archived hidden by default", "Archived body", folder.id);
      changeItemStatus(archived.id, user.id, archivedId, null);
      const cookie = createSessionCookie(user.id);

      const defaultResponse = await sendRequest({ method: "GET", url: `/folders/${folder.id}`, headers: { cookie } });
      assert.equal(defaultResponse.statusCode, 200);
      assert.match(defaultResponse.body, /Active visible/u);
      assert.doesNotMatch(defaultResponse.body, /Archived hidden by default/u);

      const query = `status=${encodeURIComponent(activeId)}&status=${encodeURIComponent(archivedId)}`;
      const filteredResponse = await sendRequest({ method: "GET", url: `/folders/${folder.id}?${query}`, headers: { cookie } });
      assert.equal(filteredResponse.statusCode, 200);
      assert.match(filteredResponse.body, /Archived hidden by default/u);
      assert.match(filteredResponse.body, new RegExp(`/\\?status=${activeId}&amp;status=${archivedId}`, "u"));
      assert.equal(listTodoItems(user.id, folder.id, [activeId]).map((item) => item.id)[0], active.id);
    });
  });
});

function requiredStatusId(statuses, name) {
  const status = statuses.find((candidate) => candidate.name === name);
  assert.notEqual(status, undefined);
  return status.id;
}

function statusId(userId, name) {
  return requiredStatusId(listStatuses(userId), name);
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
  const directory = mkdtempSync(join(tmpdir(), "todo1-folders-test-"));
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
  const directory = mkdtempSync(join(tmpdir(), "todo1-folders-test-"));
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
