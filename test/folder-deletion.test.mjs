import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import {
  changeItemStatus,
  createFolderPath,
  createTodoItem,
  deleteFolderMovingNonDeferredItems,
  findItemForUser,
  findOrCreateUserByEmail,
  initializeDatabase,
  listItemStatusChanges,
  listStatuses,
  listFolders,
} from "../dist/db.js";

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "todo1-folder-delete-"));
  const previous = env.TODO_DATABASE_PATH;
  env.TODO_DATABASE_PATH = join(directory, "todo.sqlite");
  try {
    initializeDatabase();
    return run();
  } finally {
    if (previous === undefined) delete env.TODO_DATABASE_PATH;
    else env.TODO_DATABASE_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

function statusId(userId, category) {
  const status = listStatuses(userId).find((entry) => entry.category === category);
  assert.ok(status);
  return status.id;
}

test("deletion moves active, completed, and archived items to parent without changing status or history", () => {
  withDatabase(() => {
    const user = findOrCreateUserByEmail("folder-delete@example.com");
    const folder = createFolderPath(user.id, ["Actions", "Casco"]);
    const parent = listFolders(user.id, []).find((entry) => entry.id === folder.parentId);
    assert.ok(parent);
    const existing = createTodoItem(user.id, "Existing", "Existing", parent.id);
    const active = createTodoItem(user.id, "Active", "Active", folder.id);
    const completed = createTodoItem(user.id, "Completed", "Completed", folder.id);
    const archived = createTodoItem(user.id, "Archived", "Archived", folder.id);
    assert.equal(changeItemStatus(completed.id, user.id, statusId(user.id, "completed"), null), true);
    assert.equal(changeItemStatus(archived.id, user.id, statusId(user.id, "archived"), null), true);
    const before = [active, completed, archived].map((item) => findItemForUser(item.id, user.id));
    const historyBefore = [active, completed, archived].map((item) => listItemStatusChanges(item.id, user.id));

    assert.equal(deleteFolderMovingNonDeferredItems(folder.id, user.id), "deleted");
    assert.equal(listFolders(user.id, []).some((entry) => entry.id === folder.id), false);
    for (const [index, item] of [active, completed, archived].entries()) {
      const moved = findItemForUser(item.id, user.id);
      assert.equal(moved?.nodeId, parent.id);
      assert.equal(moved?.statusId, before[index]?.statusId);
      assert.equal(moved?.statusChangedAt, before[index]?.statusChangedAt);
      assert.equal(moved?.kind, before[index]?.kind);
      assert.deepEqual(listItemStatusChanges(item.id, user.id), historyBefore[index]);
    }
    const parentItems = listFolders(user.id, [statusId(user.id, "active")]).find((entry) => entry.id === parent.id);
    assert.equal(parentItems?.directItemCount, 2);
    assert.equal(findItemForUser(existing.id, user.id)?.nodeId, parent.id);
    assert.equal(new Set([existing, active, completed, archived].map((item) => findItemForUser(item.id, user.id)?.todoRank)).size, 4);
  });
});

test("deferred items and child folders block deletion without moving anything", () => {
  withDatabase(() => {
    const user = findOrCreateUserByEmail("folder-block@example.com");
    const folder = createFolderPath(user.id, ["Actions", "Casco"]);
    const active = createTodoItem(user.id, "Active", "Active", folder.id);
    const deferred = createTodoItem(user.id, "Deferred", "Deferred", folder.id);
    assert.equal(changeItemStatus(deferred.id, user.id, statusId(user.id, "deferred"), null), true);
    assert.equal(deleteFolderMovingNonDeferredItems(folder.id, user.id), "not-empty");
    assert.equal(findItemForUser(active.id, user.id)?.nodeId, folder.id);
    assert.equal(findItemForUser(deferred.id, user.id)?.nodeId, folder.id);

    const emptyParent = createFolderPath(user.id, ["Actions", "With Child"]);
    createFolderPath(user.id, ["Actions", "With Child", "Nested"]);
    assert.equal(deleteFolderMovingNonDeferredItems(emptyParent.id, user.id), "not-empty");
    assert.equal(listFolders(user.id, []).some((entry) => entry.id === emptyParent.id), true);
  });
});

test("empty leaf folder deletion still succeeds; unknown folder remains not-found", () => {
  withDatabase(() => {
    const user = findOrCreateUserByEmail("folder-empty@example.com");
    const folder = createFolderPath(user.id, ["Actions", "Empty"]);
    assert.equal(deleteFolderMovingNonDeferredItems(folder.id, user.id), "deleted");
    assert.equal(deleteFolderMovingNonDeferredItems(folder.id, user.id), "not-found");
  });
});
