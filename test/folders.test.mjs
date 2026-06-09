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
import { CAPTURE_PROMPT_RULES } from "../dist/capture-router.js";
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
      assert.deepEqual(
        listFolders(user.id, [activeId])
          .filter((folder) => folder.name !== "Actions" && folder.name !== "Reference")
          .map((folder) => [folder.name, folder.directItemCount]),
        [
        ["2026-06-03", 1],
        ["Meetings", 0],
        ["Regen Hub", 1],
        ],
      );
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

  await suite.test("seeds reserved roots and reclassifies items when moving between inbox, actions, and reference", () => {
    withDatabase(() => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("root-seeding@example.com");
      const activeId = statusId(user.id, "Active");
      const folderNames = listFolders(user.id, []).map((folder) => folder.name);
      const actionsFolder = createFolderPath(user.id, ["Actions", "Errands"]);
      const referenceFolder = createFolderPath(user.id, ["Reference", "Garden"]);
      const item = createTodoItem(user.id, "Classify me", "Body");

      assert.deepEqual(folderNames, ["Actions", "Reference"]);
      assert.equal(listTodoItems(user.id, null, [activeId])[0]?.kind, "todo");

      assert.equal(moveTodoItemToLocation(item.id, user.id, actionsFolder.id), true);
      assert.equal(listTodoItems(user.id, actionsFolder.id, [activeId])[0]?.kind, "todo");

      assert.equal(moveTodoItemToLocation(item.id, user.id, referenceFolder.id), true);
      assert.equal(listTodoItems(user.id, referenceFolder.id, [activeId])[0]?.kind, "reference");

      assert.equal(moveTodoItemToLocation(item.id, user.id, null), true);
      const returnedToInbox = listTodoItems(user.id, null, [activeId])[0];
      assert.equal(returnedToInbox?.nodeId, null);
      assert.equal(returnedToInbox?.kind, "reference");
    });
  });

  await suite.test("creates relative move paths under the selected destination root", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("relative-move@example.com");
      const cookie = createSessionCookie(user.id);
      const item = createTodoItem(user.id, "Feedback", "Capture body");
      const referenceRoot = listFolders(user.id, []).find((folder) => folder.name === "Reference");

      assert.notEqual(referenceRoot, undefined);

      const response = await sendJsonRequest({
        method: "POST",
        url: `/api/todos/${item.id}/location`,
        cookie,
        body: {
          view: "inbox",
          folderId: referenceRoot.id,
          folderPath: "devstuff / app feedback",
        },
      });

      assert.equal(response.statusCode, 200);
      const moved = JSON.parse(response.body).item;
      const appFeedback = listFolders(user.id, []).find((folder) => folder.name === "app feedback");
      assert.notEqual(appFeedback, undefined);
      assert.equal(moved.nodeId, appFeedback.id);
      assert.equal(moved.kind, "reference");
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
        body: "folderPath=Actions+%2F+Should+Not+Exist&returnTo=%2F",
      });
      assert.equal(pathMoveResponse.statusCode, 404);
      assert.deepEqual(listFolders(intruder.id, []).map((folder) => folder.name), ["Actions", "Reference"]);
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
        body: "folderPath=Meetings+%2F+Regen+Hub&returnTo=%2Factions",
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

  await suite.test("changes status through shared form endpoint with long notes", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("status-form@example.com");
      const statuses = listStatuses(user.id);
      const activeId = requiredStatusId(statuses, "Active");
      const completedId = requiredStatusId(statuses, "Completed");
      const item = createTodoItem(user.id, "Archive docs", "Check IDrive backup");
      const cookie = createSessionCookie(user.id);
      const note = "Here is a quick summary of my file storage situation: all of my files are backed up to idrive. I am happy w/ 320/500gb.";

      const response = await sendRequest({
        method: "POST",
        url: "/todos/status",
        headers: { cookie },
        body: `itemId=${encodeURIComponent(item.id)}&statusId=${encodeURIComponent(completedId)}&note=${encodeURIComponent(note)}&returnTo=${encodeURIComponent(`/?status=${activeId}`)}`,
      });

      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.Location, `/?status=${activeId}`);
      assert.deepEqual(listTodoItems(user.id, null, [completedId]).map((todo) => todo.id), [item.id]);
    });
  });

  await suite.test("moves multiple selected items to a new location through bulk endpoint", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("bulk-move@example.com");
      const activeId = statusId(user.id, "Active");
      const first = createTodoItem(user.id, "First bulk", "First body");
      const second = createTodoItem(user.id, "Second bulk", "Second body");
      const unselected = createTodoItem(user.id, "Stay inbox", "Stay body");
      const cookie = createSessionCookie(user.id);

      const response = await sendRequest({
        method: "POST",
        url: "/todos/bulk/location",
        headers: { cookie },
        body: `itemId=${encodeURIComponent(first.id)}&itemId=${encodeURIComponent(second.id)}&folderPath=Actions+%2F+Projects+%2F+Bulk&returnTo=${encodeURIComponent(`/?status=${activeId}`)}`,
      });

      assert.equal(response.statusCode, 303);
      assert.equal(response.headers.Location, `/?status=${activeId}`);
      const bulkFolder = listFolders(user.id, [activeId]).find((folder) => folder.name === "Bulk");
      assert.notEqual(bulkFolder, undefined);
      assert.deepEqual(
        listTodoItems(user.id, bulkFolder.id, [activeId]).map((todo) => todo.id).sort(),
        [first.id, second.id].sort(),
      );
      assert.deepEqual(listTodoItems(user.id, null, [activeId]).map((todo) => todo.id), [unselected.id]);
    });
  });

  await suite.test("rejects bulk move with another user's item before creating folders", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const owner = findOrCreateUserByEmail("bulk-owner@example.com");
      const intruder = findOrCreateUserByEmail("bulk-intruder@example.com");
      const ownerItem = createTodoItem(owner.id, "Owner only", "Owner body");
      const intruderItem = createTodoItem(intruder.id, "Intruder item", "Intruder body");
      const activeId = statusId(intruder.id, "Active");
      const cookie = createSessionCookie(intruder.id);

      const response = await sendRequest({
        method: "POST",
        url: "/todos/bulk/location",
        headers: { cookie },
        body: `itemId=${encodeURIComponent(intruderItem.id)}&itemId=${encodeURIComponent(ownerItem.id)}&folderPath=Actions+%2F+Should+Not+Exist&returnTo=${encodeURIComponent(`/?status=${activeId}`)}`,
      });

      assert.equal(response.statusCode, 404);
      assert.deepEqual(listFolders(intruder.id, []).map((folder) => folder.name), ["Actions", "Reference"]);
      assert.deepEqual(listTodoItems(intruder.id, null, [activeId]).map((todo) => todo.id), [intruderItem.id]);
    });
  });

  await suite.test("serves folder shell and preserves multi-status folder API filtering", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("render@example.com");
      const statuses = listStatuses(user.id);
      const activeId = requiredStatusId(statuses, "Active");
      const archivedId = requiredStatusId(statuses, "Archived");
      const folder = createFolderPath(user.id, ["Actions", "Visible Folder"]);
      const active = createTodoItem(user.id, "Active visible", "Active body", folder.id);
      const archived = createTodoItem(user.id, "Archived hidden by default", "Archived body", folder.id);
      changeItemStatus(archived.id, user.id, archivedId, null);
      const cookie = createSessionCookie(user.id);

      const defaultResponse = await sendRequest({ method: "GET", url: `/folders/${folder.id}`, headers: { cookie } });
      assert.equal(defaultResponse.statusCode, 200);
      assert.match(defaultResponse.body, /<div id="root"><\/div>/u);
      assert.doesNotMatch(defaultResponse.body, /Active visible/u);

      const defaultViewResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/workspace/view",
        cookie,
        body: { view: "actions", folderId: folder.id, statusIds: null },
      });
      assert.equal(defaultViewResponse.statusCode, 200);
      assert.deepEqual(JSON.parse(defaultViewResponse.body).workspace.todos.map((todo) => todo.id), [active.id]);

      const filteredViewResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/workspace/view",
        cookie,
        body: { view: "actions", folderId: folder.id, statusIds: [activeId, archivedId] },
      });
      assert.equal(filteredViewResponse.statusCode, 200);
      assert.deepEqual(JSON.parse(filteredViewResponse.body).workspace.todos.map((todo) => todo.id).sort(), [active.id, archived.id].sort());
      assert.equal(listTodoItems(user.id, folder.id, [activeId]).map((item) => item.id)[0], active.id);
    });
  });

  await suite.test("serves authenticated prompts page with capture routing examples", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("prompts@example.com");
      const cookie = createSessionCookie(user.id);

      const unauthenticated = await sendRequest({ method: "GET", url: "/prompts" });
      assert.equal(unauthenticated.statusCode, 303);
      assert.equal(unauthenticated.headers.Location, "/login");

      const response = await sendRequest({ method: "GET", url: "/prompts", headers: { cookie } });
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /<h1 id="prompts-heading">Prompts<\/h1>/u);
      assert.match(response.body, /href="\/"/u);

      for (const rule of CAPTURE_PROMPT_RULES) {
        assert.match(response.body, new RegExp(escapeRegExp(rule.spokenPattern), "u"));
        assert.match(response.body, new RegExp(escapeRegExp(rule.destination), "u"));
        assert.match(response.body, new RegExp(escapeRegExp(rule.itemBody), "u"));
      }
    });
  });

  await suite.test("serves authenticated JSON workspace APIs", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("api-workspace@example.com");
      const activeId = statusId(user.id, "Active");
      const completedId = statusId(user.id, "Completed");
      const folder = createFolderPath(user.id, ["Actions", "Projects"]);
      const item = createTodoItem(user.id, "API item", "API body", folder.id);
      const cookie = createSessionCookie(user.id);

      const unauthenticated = await sendRequest({ method: "GET", url: "/api/workspace/default" });
      assert.equal(unauthenticated.statusCode, 401);

      const defaultResponse = await sendRequest({ method: "GET", url: "/api/workspace/default", headers: { cookie } });
      assert.equal(defaultResponse.statusCode, 200);
      const defaultWorkspace = JSON.parse(defaultResponse.body).workspace;
      assert.equal(defaultWorkspace.view, "inbox");
      assert.deepEqual(defaultWorkspace.selectedStatusIds, [activeId]);
      assert.equal(defaultWorkspace.roots.actions.name, "Actions");
      assert.equal(defaultWorkspace.roots.reference.name, "Reference");

      const viewResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/workspace/view",
        cookie,
        body: { view: "actions", folderId: folder.id, statusIds: [activeId, completedId] },
      });
      assert.equal(viewResponse.statusCode, 200);
      const view = JSON.parse(viewResponse.body).workspace;
      assert.equal(view.folder.id, folder.id);
      assert.deepEqual(view.todos.map((todo) => todo.id), [item.id]);
    });
  });

  await suite.test("mutates todos and folders through authenticated JSON APIs", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const user = findOrCreateUserByEmail("api-mutations@example.com");
      const activeId = statusId(user.id, "Active");
      const completedId = statusId(user.id, "Completed");
      const cookie = createSessionCookie(user.id);

      const folderResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/folders",
        cookie,
        body: { view: "actions", folderPath: "Projects / API", folderId: null, statusIds: [activeId] },
      });
      assert.equal(folderResponse.statusCode, 201);
      const folder = JSON.parse(folderResponse.body).folder;

      const createResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/todos",
        cookie,
        body: { title: "Created", body: "Created body", folderId: folder.id },
      });
      assert.equal(createResponse.statusCode, 201);
      const created = JSON.parse(createResponse.body).item;

      const updateResponse = await sendJsonRequest({
        method: "PATCH",
        url: `/api/todos/${created.id}`,
        cookie,
        body: { title: "Edited", body: "Edited body", folderId: null },
      });
      assert.equal(updateResponse.statusCode, 200);
      assert.equal(JSON.parse(updateResponse.body).item.nodeId, null);

      const statusResponse = await sendJsonRequest({
        method: "POST",
        url: `/api/todos/${created.id}/status`,
        cookie,
        body: { statusId: completedId, note: "Done by API" },
      });
      assert.equal(statusResponse.statusCode, 200);
      assert.equal(JSON.parse(statusResponse.body).item.statusId, completedId);

      const moveResponse = await sendJsonRequest({
        method: "POST",
        url: `/api/todos/${created.id}/location`,
        cookie,
        body: { folderId: folder.id, folderPath: "" },
      });
      assert.equal(moveResponse.statusCode, 200);
      assert.equal(JSON.parse(moveResponse.body).item.nodeId, folder.id);

      const renamedResponse = await sendJsonRequest({
        method: "POST",
        url: `/api/folders/${folder.id}/rename`,
        cookie,
        body: { view: "actions", name: "API Renamed", folderId: folder.id, statusIds: [activeId, completedId] },
      });
      assert.equal(renamedResponse.statusCode, 200);
      assert.equal(JSON.parse(renamedResponse.body).workspace.folder.name, "API Renamed");
    });
  });

  await suite.test("bulk move and reorder JSON APIs preserve ownership checks", async () => {
    await withDatabaseAsync(async () => {
      initializeDatabase();
      const owner = findOrCreateUserByEmail("api-owner@example.com");
      const intruder = findOrCreateUserByEmail("api-intruder@example.com");
      const ownerItem = createTodoItem(owner.id, "Owner", "Owner body");
      const first = createTodoItem(intruder.id, "First", "First body");
      const second = createTodoItem(intruder.id, "Second", "Second body");
      const activeId = statusId(intruder.id, "Active");
      const cookie = createSessionCookie(intruder.id);

      const blockedResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/bulk/location",
        cookie,
        body: { view: "inbox", itemIds: [first.id, ownerItem.id], folderId: null, folderPath: "Actions / Should Not Exist", statusIds: [activeId] },
      });
      assert.equal(blockedResponse.statusCode, 404);
      assert.deepEqual(listFolders(intruder.id, []).map((folder) => folder.name), ["Actions", "Reference"]);

      const bulkResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/bulk/location",
        cookie,
        body: { view: "inbox", itemIds: [first.id, second.id], folderId: null, folderPath: "Actions / Moved", statusIds: [activeId] },
      });
      assert.equal(bulkResponse.statusCode, 200);
      const movedFolder = listFolders(intruder.id, [activeId]).find((folder) => folder.name === "Moved");
      assert.notEqual(movedFolder, undefined);

      const reorderResponse = await sendJsonRequest({
        method: "POST",
        url: "/api/todos/reorder",
        cookie,
        body: {
          movedId: second.id,
          previousId: first.id,
          nextId: null,
          view: "actions",
          folderId: movedFolder.id,
          statusIds: [activeId],
        },
      });
      assert.equal(reorderResponse.statusCode, 200);
      assert.deepEqual(listTodoItems(intruder.id, movedFolder.id, [activeId]).map((todo) => todo.id), [first.id, second.id]);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

async function sendJsonRequest({ method, url, cookie, body }) {
  return await sendRequest({
    method,
    url,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
