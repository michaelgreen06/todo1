import { execFileSync } from "node:child_process";
import { generateKeyBetween } from "fractional-indexing";

import { getTodoDatabasePath } from "./process-env.js";

export const STATUS_CATEGORIES = {
  active: "active",
  deferred: "deferred",
  completed: "completed",
  archived: "archived",
} as const;

export type StatusCategory = (typeof STATUS_CATEGORIES)[keyof typeof STATUS_CATEGORIES];

export type User = {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
};

export type LoginToken = {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly createdAt: string;
};

export type Session = {
  readonly id: string;
  readonly userId: string;
  readonly sessionHash: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
};

export type DeviceToken = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
};

export type Capture = {
  readonly id: string;
  readonly userId: string;
  readonly deviceTokenId: string;
  readonly clientCaptureId: string;
  readonly text: string;
  readonly capturedAt: string;
  readonly metadataJson: string;
  readonly createdAt: string;
};

export type CaptureInput = {
  readonly clientCaptureId: string;
  readonly text: string;
  readonly capturedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type CaptureIngestionResult = {
  readonly captureId: string;
  readonly routedItemId: string;
  readonly duplicate: boolean;
};

export type Status = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly category: StatusCategory;
  readonly showInTodoView: boolean;
  readonly isDefaultForNewItems: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Item = {
  readonly id: string;
  readonly userId: string;
  readonly nodeId: string | null;
  readonly statusId: string;
  readonly statusName: string;
  readonly statusCategory: StatusCategory;
  readonly kind: string;
  readonly title: string | null;
  readonly body: string;
  readonly sourceCaptureId: string | null;
  readonly statusChangedAt: string;
  readonly todoRank: string | null;
  readonly todoRankChangedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Folder = {
  readonly id: string;
  readonly userId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: string;
  readonly directItemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ItemStatusChange = {
  readonly id: string;
  readonly itemId: string;
  readonly fromStatusName: string | null;
  readonly toStatusName: string;
  readonly note: string | null;
  readonly changedAt: string;
};

export type ReorderItemInput = {
  readonly movedId: string;
  readonly previousId: string | null;
  readonly nextId: string | null;
};

type UnknownRecord = Readonly<Record<string, unknown>>;

const SQLITE_BIN = "/usr/bin/sqlite3";
const ITEM_KIND = "todo";

const SEEDED_STATUSES = [
  { name: "Active", category: STATUS_CATEGORIES.active, showInTodoView: true, isDefaultForNewItems: true },
  { name: "Deferred", category: STATUS_CATEGORIES.deferred, showInTodoView: false, isDefaultForNewItems: false },
  { name: "Completed", category: STATUS_CATEGORIES.completed, showInTodoView: false, isDefaultForNewItems: false },
  { name: "Archived", category: STATUS_CATEGORIES.archived, showInTodoView: false, isDefaultForNewItems: false },
] satisfies ReadonlyArray<{
  readonly name: string;
  readonly category: StatusCategory;
  readonly showInTodoView: boolean;
  readonly isDefaultForNewItems: boolean;
}>;

export function initializeDatabase(): void {
  executeSql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('active', 'deferred', 'completed', 'archived')),
      show_in_todo_view INTEGER NOT NULL CHECK (show_in_todo_view IN (0, 1)),
      is_default_for_new_items INTEGER NOT NULL CHECK (is_default_for_new_items IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, name)
    );

    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token_id TEXT NOT NULL REFERENCES device_tokens(id) ON DELETE RESTRICT,
      client_capture_id TEXT NOT NULL,
      text TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (device_token_id, client_capture_id)
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      node_id TEXT REFERENCES nodes(id) ON DELETE RESTRICT,
      status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      source_capture_id TEXT REFERENCES captures(id) ON DELETE RESTRICT,
      status_changed_at TEXT NOT NULL,
      todo_rank TEXT,
      todo_rank_changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_status_changes (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      from_status_id TEXT REFERENCES statuses(id) ON DELETE RESTRICT,
      to_status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE RESTRICT,
      note TEXT,
      changed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_login_tokens_hash ON login_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(session_hash);
    CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_nodes_user_parent ON nodes(user_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_statuses_user_lookup ON statuses(user_id, id);
    CREATE INDEX IF NOT EXISTS idx_items_visible_todo_rank
      ON items(user_id, status_id, todo_rank) WHERE todo_rank IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_items_user_node_todo_rank
      ON items(user_id, node_id, todo_rank);
    CREATE INDEX IF NOT EXISTS idx_item_status_changes_history
      ON item_status_changes(item_id, changed_at DESC);
  `);

  if (!tableHasColumn("items", "source_capture_id")) {
    executeSql("ALTER TABLE items ADD COLUMN source_capture_id TEXT REFERENCES captures(id) ON DELETE RESTRICT;");
  }

  if (!tableHasColumn("captures", "text")) {
    if (!tableHasColumn("captures", "transcript")) {
      throw new Error("Captures table does not have a compatible text column.");
    }

    executeSql(`
      BEGIN IMMEDIATE;
      ALTER TABLE captures ADD COLUMN text TEXT NOT NULL DEFAULT '';
      UPDATE captures SET text = transcript;
      COMMIT;
    `);
  }

  executeSql(`
    DROP INDEX IF EXISTS idx_nodes_sibling_name;
    DROP INDEX IF EXISTS idx_nodes_root_name;
    CREATE UNIQUE INDEX idx_nodes_sibling_name
      ON nodes(user_id, parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_nodes_root_name
      ON nodes(user_id, name COLLATE NOCASE) WHERE parent_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_capture
      ON items(source_capture_id) WHERE source_capture_id IS NOT NULL;
  `);

  backfillMissingTodoRanks();
}

export function findOrCreateUserByEmail(email: string): User {
  const existingUser = findUserByEmail(email);

  if (existingUser !== null) {
    return existingUser;
  }

  const user: User = {
    id: globalThis.crypto.randomUUID(),
    email,
    createdAt: nowIso(),
  };
  const statusInserts = SEEDED_STATUSES.map((status) => {
    return `INSERT INTO statuses (
      id, user_id, name, category, show_in_todo_view, is_default_for_new_items, created_at, updated_at
    ) VALUES (
      ${sql(globalThis.crypto.randomUUID())}, ${sql(user.id)}, ${sql(status.name)}, ${sql(status.category)},
      ${sql(status.showInTodoView)}, ${sql(status.isDefaultForNewItems)}, ${sql(user.createdAt)}, ${sql(user.createdAt)}
    );`;
  }).join("\n");

  executeSql(`
    BEGIN IMMEDIATE;
    INSERT INTO users (id, email, created_at)
    VALUES (${sql(user.id)}, ${sql(user.email)}, ${sql(user.createdAt)});
    ${statusInserts}
    COMMIT;
  `);

  return user;
}

export function findUserById(userId: string): User | null {
  const row = firstRow(queryRows(`
    SELECT id, email, created_at
    FROM users
    WHERE id = ${sql(userId)}
    LIMIT 1;
  `));

  return row === null ? null : mapUser(row);
}

export function createLoginToken(userId: string, tokenHash: string, expiresAt: string): LoginToken {
  const token: LoginToken = {
    id: globalThis.crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
    usedAt: null,
    createdAt: nowIso(),
  };

  executeSql(`
    INSERT INTO login_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
    VALUES (${sql(token.id)}, ${sql(token.userId)}, ${sql(token.tokenHash)}, ${sql(token.expiresAt)}, NULL, ${sql(token.createdAt)});
  `);

  return token;
}

export function findActiveSession(sessionHash: string, currentTime: string): Session | null {
  const row = firstRow(queryRows(`
    SELECT id, user_id, session_hash, expires_at, created_at, revoked_at
    FROM sessions
    WHERE session_hash = ${sql(sessionHash)}
      AND revoked_at IS NULL
      AND expires_at > ${sql(currentTime)}
    LIMIT 1;
  `));

  return row === null ? null : mapSession(row);
}

export function revokeSession(sessionHash: string): void {
  executeSql(`
    UPDATE sessions
    SET revoked_at = ${sql(nowIso())}
    WHERE session_hash = ${sql(sessionHash)} AND revoked_at IS NULL;
  `);
}

export function createDeviceToken(userId: string, name: string, tokenHash: string): DeviceToken {
  const deviceToken: DeviceToken = {
    id: globalThis.crypto.randomUUID(),
    userId,
    name,
    tokenHash,
    createdAt: nowIso(),
    revokedAt: null,
  };

  executeSql(`
    INSERT INTO device_tokens (id, user_id, name, token_hash, created_at, revoked_at)
    VALUES (
      ${sql(deviceToken.id)}, ${sql(deviceToken.userId)}, ${sql(deviceToken.name)},
      ${sql(deviceToken.tokenHash)}, ${sql(deviceToken.createdAt)}, NULL
    );
  `);

  return deviceToken;
}

export function findActiveDeviceToken(tokenHash: string): DeviceToken | null {
  const row = firstRow(queryRows(`
    SELECT id, user_id, name, token_hash, created_at, revoked_at
    FROM device_tokens
    WHERE token_hash = ${sql(tokenHash)} AND revoked_at IS NULL
    LIMIT 1;
  `));

  return row === null ? null : mapDeviceToken(row);
}

export function revokeDeviceToken(tokenHash: string): void {
  executeSql(`
    UPDATE device_tokens
    SET revoked_at = ${sql(nowIso())}
    WHERE token_hash = ${sql(tokenHash)} AND revoked_at IS NULL;
  `);
}

export function routeCaptureForMvp(deviceToken: DeviceToken, input: CaptureInput): CaptureIngestionResult {
  const existingCapture = findCaptureForDeviceToken(deviceToken.id, input.clientCaptureId);

  if (existingCapture !== null) {
    return getCaptureIngestionResult(existingCapture, true);
  }

  const defaultStatus = findDefaultStatus(deviceToken.userId);

  if (defaultStatus === null) {
    throw new Error("User does not have a default status.");
  }

  const capture: Capture = {
    id: globalThis.crypto.randomUUID(),
    userId: deviceToken.userId,
    deviceTokenId: deviceToken.id,
    clientCaptureId: input.clientCaptureId,
    text: input.text,
    capturedAt: input.capturedAt,
    metadataJson: JSON.stringify(input.metadata),
    createdAt: nowIso(),
  };
  const itemId = globalThis.crypto.randomUUID();
  const historyId = globalThis.crypto.randomUUID();
  const todoRank = generateTopTodoRank(deviceToken.userId, null);
  const captureInsert = tableHasColumn("captures", "transcript")
    ? `INSERT OR IGNORE INTO captures (
      id, user_id, device_token_id, client_capture_id, text, transcript, captured_at, metadata_json, created_at
    ) VALUES (
      ${sql(capture.id)}, ${sql(capture.userId)}, ${sql(capture.deviceTokenId)}, ${sql(capture.clientCaptureId)},
      ${sql(capture.text)}, ${sql(capture.text)}, ${sql(capture.capturedAt)}, ${sql(capture.metadataJson)},
      ${sql(capture.createdAt)}
    );`
    : `INSERT OR IGNORE INTO captures (
      id, user_id, device_token_id, client_capture_id, text, captured_at, metadata_json, created_at
    ) VALUES (
      ${sql(capture.id)}, ${sql(capture.userId)}, ${sql(capture.deviceTokenId)}, ${sql(capture.clientCaptureId)},
      ${sql(capture.text)}, ${sql(capture.capturedAt)}, ${sql(capture.metadataJson)}, ${sql(capture.createdAt)}
    );`;

  executeSql(`
    BEGIN IMMEDIATE;
    ${captureInsert}
    INSERT INTO items (
      id, user_id, node_id, status_id, kind, title, body, source_capture_id, status_changed_at,
      todo_rank, todo_rank_changed_at, created_at, updated_at
    )
    SELECT
      ${sql(itemId)}, ${sql(capture.userId)}, NULL, ${sql(defaultStatus.id)}, ${sql(ITEM_KIND)}, NULL,
      ${sql(capture.text)}, ${sql(capture.id)}, ${sql(capture.createdAt)}, ${sql(todoRank)}, NULL,
      ${sql(capture.createdAt)}, ${sql(capture.createdAt)}
    FROM captures
    WHERE id = ${sql(capture.id)};
    INSERT INTO item_status_changes (id, item_id, from_status_id, to_status_id, note, changed_at)
    SELECT ${sql(historyId)}, ${sql(itemId)}, NULL, ${sql(defaultStatus.id)}, NULL, ${sql(capture.createdAt)}
    FROM items
    WHERE id = ${sql(itemId)};
    COMMIT;
  `);

  const persistedCapture = findCaptureForDeviceToken(deviceToken.id, input.clientCaptureId);

  if (persistedCapture === null) {
    throw new Error("Newly created capture could not be found.");
  }

  return getCaptureIngestionResult(persistedCapture, persistedCapture.id !== capture.id);
}

export function consumeLoginTokenAndCreateSession(
  tokenHash: string,
  sessionHash: string,
  sessionExpiresAt: string,
  currentTime: string,
): Session | null {
  const sessionId = globalThis.crypto.randomUUID();
  executeSql(`
    BEGIN IMMEDIATE;
    UPDATE login_tokens
    SET used_at = ${sql(currentTime)}
    WHERE token_hash = ${sql(tokenHash)}
      AND used_at IS NULL
      AND expires_at > ${sql(currentTime)};
    INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at, revoked_at)
    SELECT ${sql(sessionId)}, user_id, ${sql(sessionHash)}, ${sql(sessionExpiresAt)}, ${sql(currentTime)}, NULL
    FROM login_tokens
    WHERE token_hash = ${sql(tokenHash)}
      AND used_at = ${sql(currentTime)}
      AND expires_at > ${sql(currentTime)};
    COMMIT;
  `);

  return findActiveSession(sessionHash, currentTime);
}

export function listStatuses(userId: string): Array<Status> {
  return queryRows(`
    SELECT id, user_id, name, category, show_in_todo_view, is_default_for_new_items, created_at, updated_at
    FROM statuses
    WHERE user_id = ${sql(userId)}
    ORDER BY name ASC;
  `).map(mapStatus);
}

export function listVisibleTodoItems(userId: string): Array<Item> {
  return queryRows(`
    ${itemSelect()}
    WHERE items.user_id = ${sql(userId)}
      AND items.node_id IS NULL
      AND statuses.show_in_todo_view = 1
      AND items.todo_rank IS NOT NULL
    ORDER BY items.todo_rank ASC, items.created_at ASC;
  `).map(mapItem);
}

export function listTodoItems(userId: string, nodeId: string | null, statusIds: ReadonlyArray<string>): Array<Item> {
  if (statusIds.length === 0) {
    return [];
  }

  return queryRows(`
    ${itemSelect()}
    WHERE items.user_id = ${sql(userId)}
      AND ${nodeCondition("items.node_id", nodeId)}
      AND items.status_id IN (${sqlList(statusIds)})
      AND items.todo_rank IS NOT NULL
    ORDER BY items.todo_rank ASC, items.created_at ASC;
  `).map(mapItem);
}

export function listFolders(userId: string, statusIds: ReadonlyArray<string>): Array<Folder> {
  const itemJoin = statusIds.length === 0
    ? "AND 0 = 1"
    : `AND items.status_id IN (${sqlList(statusIds)})`;

  return queryRows(`
    SELECT nodes.id, nodes.user_id, nodes.parent_id, nodes.name, nodes.kind,
      COUNT(items.id) AS direct_item_count, nodes.created_at, nodes.updated_at
    FROM nodes
    LEFT JOIN items ON items.node_id = nodes.id AND items.user_id = nodes.user_id ${itemJoin}
    WHERE nodes.user_id = ${sql(userId)} AND nodes.kind = ${sql("folder")}
    GROUP BY nodes.id
    ORDER BY nodes.name COLLATE NOCASE ASC, nodes.created_at ASC;
  `).map(mapFolder);
}

export function countInboxItems(userId: string, statusIds: ReadonlyArray<string>): number {
  if (statusIds.length === 0) {
    return 0;
  }

  const row = firstRow(queryRows(`
    SELECT COUNT(*) AS count
    FROM items
    WHERE user_id = ${sql(userId)}
      AND node_id IS NULL
      AND status_id IN (${sqlList(statusIds)});
  `));

  return row === null ? 0 : getRequiredNumber(row, "count");
}

export function findFolderForUser(folderId: string, userId: string): Folder | null {
  const row = firstRow(queryRows(`
    SELECT nodes.id, nodes.user_id, nodes.parent_id, nodes.name, nodes.kind,
      0 AS direct_item_count, nodes.created_at, nodes.updated_at
    FROM nodes
    WHERE nodes.id = ${sql(folderId)} AND nodes.user_id = ${sql(userId)} AND nodes.kind = ${sql("folder")}
    LIMIT 1;
  `));

  return row === null ? null : mapFolder(row);
}

export function listFolderAncestors(folderId: string, userId: string): Array<Folder> {
  return queryRows(`
    WITH RECURSIVE ancestors(id, user_id, parent_id, name, kind, created_at, updated_at, depth) AS (
      SELECT id, user_id, parent_id, name, kind, created_at, updated_at, 0
      FROM nodes
      WHERE id = ${sql(folderId)} AND user_id = ${sql(userId)} AND kind = ${sql("folder")}
      UNION ALL
      SELECT nodes.id, nodes.user_id, nodes.parent_id, nodes.name, nodes.kind,
        nodes.created_at, nodes.updated_at, ancestors.depth + 1
      FROM nodes
      JOIN ancestors ON ancestors.parent_id = nodes.id
      WHERE nodes.user_id = ${sql(userId)} AND nodes.kind = ${sql("folder")}
    )
    SELECT id, user_id, parent_id, name, kind, 0 AS direct_item_count, created_at, updated_at
    FROM ancestors
    ORDER BY depth DESC;
  `).map(mapFolder);
}

export function createFolderPath(userId: string, segments: ReadonlyArray<string>): Folder {
  let parentId: string | null = null;
  let folder: Folder | null = null;

  for (const name of segments) {
    folder = findSiblingFolder(userId, parentId, name);

    if (folder === null) {
      const timestamp = nowIso();
      const folderId = globalThis.crypto.randomUUID();
      executeSql(`
        INSERT INTO nodes (id, user_id, parent_id, name, kind, created_at, updated_at)
        VALUES (${sql(folderId)}, ${sql(userId)}, ${sql(parentId)}, ${sql(name)}, ${sql("folder")}, ${sql(timestamp)}, ${sql(timestamp)});
      `);
      folder = findFolderForUser(folderId, userId);
    }

    if (folder === null) {
      throw new Error("Newly created folder could not be found.");
    }

    parentId = folder.id;
  }

  if (folder === null) {
    throw new Error("Folder path must include at least one segment.");
  }

  return folder;
}

export function renameFolder(folderId: string, userId: string, name: string): "renamed" | "not-found" | "duplicate" {
  const folder = findFolderForUser(folderId, userId);

  if (folder === null) {
    return "not-found";
  }

  const duplicate = findSiblingFolder(userId, folder.parentId, name);

  if (duplicate !== null && duplicate.id !== folder.id) {
    return "duplicate";
  }

  executeSql(`
    UPDATE nodes
    SET name = ${sql(name)}, updated_at = ${sql(nowIso())}
    WHERE id = ${sql(folder.id)} AND user_id = ${sql(userId)};
  `);
  return "renamed";
}

export function deleteEmptyLeafFolder(folderId: string, userId: string): "deleted" | "not-found" | "not-empty" {
  const folder = findFolderForUser(folderId, userId);

  if (folder === null) {
    return "not-found";
  }

  const row = firstRow(queryRows(`
    SELECT
      EXISTS(SELECT 1 FROM items WHERE node_id = ${sql(folder.id)}) AS has_items,
      EXISTS(SELECT 1 FROM nodes WHERE parent_id = ${sql(folder.id)}) AS has_children;
  `));

  if (row === null || getRequiredBoolean(row, "has_items") || getRequiredBoolean(row, "has_children")) {
    return "not-empty";
  }

  executeSql(`DELETE FROM nodes WHERE id = ${sql(folder.id)} AND user_id = ${sql(userId)};`);
  return "deleted";
}

export function findItemForUser(itemId: string, userId: string): Item | null {
  const row = firstRow(queryRows(`
    ${itemSelect()}
    WHERE items.id = ${sql(itemId)} AND items.user_id = ${sql(userId)}
    LIMIT 1;
  `));

  return row === null ? null : mapItem(row);
}

export function listItemStatusChanges(itemId: string, userId: string): Array<ItemStatusChange> {
  return queryRows(`
    SELECT item_status_changes.id, item_status_changes.item_id,
      from_status.name AS from_status_name, to_status.name AS to_status_name,
      item_status_changes.note, item_status_changes.changed_at
    FROM item_status_changes
    JOIN items ON items.id = item_status_changes.item_id
    LEFT JOIN statuses AS from_status ON from_status.id = item_status_changes.from_status_id
    JOIN statuses AS to_status ON to_status.id = item_status_changes.to_status_id
    WHERE item_status_changes.item_id = ${sql(itemId)} AND items.user_id = ${sql(userId)}
    ORDER BY item_status_changes.changed_at DESC, item_status_changes.id DESC;
  `).map(mapItemStatusChange);
}

export function createTodoItem(userId: string, title: string | null, body: string, nodeId: string | null = null): Item {
  const defaultStatus = findDefaultStatus(userId);

  if (defaultStatus === null || (nodeId !== null && findFolderForUser(nodeId, userId) === null)) {
    throw new Error("User does not have a default status.");
  }

  const timestamp = nowIso();
  const itemId = globalThis.crypto.randomUUID();
  const todoRank = generateTopTodoRank(userId, nodeId);
  executeSql(`
    BEGIN IMMEDIATE;
    INSERT INTO items (
      id, user_id, node_id, status_id, kind, title, body, source_capture_id, status_changed_at,
      todo_rank, todo_rank_changed_at, created_at, updated_at
    ) VALUES (
      ${sql(itemId)}, ${sql(userId)}, ${sql(nodeId)}, ${sql(defaultStatus.id)}, ${sql(ITEM_KIND)}, ${sql(title)}, ${sql(body)},
      NULL, ${sql(timestamp)}, ${sql(todoRank)}, NULL, ${sql(timestamp)}, ${sql(timestamp)}
    );
    INSERT INTO item_status_changes (id, item_id, from_status_id, to_status_id, note, changed_at)
    VALUES (${sql(globalThis.crypto.randomUUID())}, ${sql(itemId)}, NULL, ${sql(defaultStatus.id)}, NULL, ${sql(timestamp)});
    COMMIT;
  `);

  const item = findItemForUser(itemId, userId);

  if (item === null) {
    throw new Error("Newly created item could not be found.");
  }

  return item;
}

export function updateTodoItem(itemId: string, userId: string, title: string | null, body: string): boolean {
  executeSql(`
    UPDATE items
    SET title = ${sql(title)}, body = ${sql(body)}, updated_at = ${sql(nowIso())}
    WHERE id = ${sql(itemId)} AND user_id = ${sql(userId)};
  `);

  return findItemForUser(itemId, userId) !== null;
}

export function changeItemStatus(itemId: string, userId: string, statusId: string, note: string | null): boolean {
  const item = findItemForUser(itemId, userId);
  const status = findStatusForUser(statusId, userId);

  if (item === null || status === null || item.statusId === status.id) {
    return false;
  }

  const timestamp = nowIso();
  executeSql(`
    BEGIN IMMEDIATE;
    UPDATE items
    SET status_id = ${sql(status.id)}, status_changed_at = ${sql(timestamp)}, updated_at = ${sql(timestamp)}
    WHERE id = ${sql(item.id)} AND user_id = ${sql(userId)};
    INSERT INTO item_status_changes (id, item_id, from_status_id, to_status_id, note, changed_at)
    VALUES (${sql(globalThis.crypto.randomUUID())}, ${sql(item.id)}, ${sql(item.statusId)}, ${sql(status.id)}, ${sql(note)}, ${sql(timestamp)});
    COMMIT;
  `);

  return true;
}

export function moveTodoItemToLocation(itemId: string, userId: string, nodeId: string | null): boolean {
  const item = findItemForUser(itemId, userId);

  if (item === null || (nodeId !== null && findFolderForUser(nodeId, userId) === null)) {
    return false;
  }

  const timestamp = nowIso();
  executeSql(`
    UPDATE items
    SET node_id = ${sql(nodeId)}, todo_rank = ${sql(generateTopTodoRank(userId, nodeId))},
      todo_rank_changed_at = ${sql(timestamp)}, updated_at = ${sql(timestamp)}
    WHERE id = ${sql(item.id)} AND user_id = ${sql(userId)};
  `);
  return true;
}

export function moveVisibleTodoItem(
  userId: string,
  itemId: string,
  direction: "up" | "down",
  nodeId: string | null = null,
  statusIds: ReadonlyArray<string> | null = null,
): boolean {
  const items = statusIds === null ? listVisibleTodoItems(userId) : listTodoItems(userId, nodeId, statusIds);
  const currentIndex = items.findIndex((item) => item.id === itemId);

  if (currentIndex === -1) {
    return false;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= items.length) {
    return false;
  }

  const withoutMoved = items.filter((item) => item.id !== itemId);
  const insertionIndex = direction === "up" ? targetIndex : targetIndex;
  return reorderVisibleTodoItem(userId, {
    movedId: itemId,
    previousId: withoutMoved[insertionIndex - 1]?.id ?? null,
    nextId: withoutMoved[insertionIndex]?.id ?? null,
  }, nodeId, statusIds);
}

export function reorderVisibleTodoItem(
  userId: string,
  input: ReorderItemInput,
  nodeId: string | null = null,
  statusIds: ReadonlyArray<string> | null = null,
): boolean {
  const items = statusIds === null ? listVisibleTodoItems(userId) : listTodoItems(userId, nodeId, statusIds);
  const movedItem = items.find((item) => item.id === input.movedId);

  if (movedItem === undefined || input.previousId === input.movedId || input.nextId === input.movedId) {
    return false;
  }

  const withoutMoved = items.filter((item) => item.id !== input.movedId);
  const expectedNeighbors = findInsertionNeighbors(withoutMoved, input.previousId, input.nextId);

  if (expectedNeighbors === null) {
    return false;
  }

  const timestamp = nowIso();
  const todoRank = generateKeyBetween(expectedNeighbors.previousRank, expectedNeighbors.nextRank);
  executeSql(`
    UPDATE items
    SET todo_rank = ${sql(todoRank)}, todo_rank_changed_at = ${sql(timestamp)}, updated_at = ${sql(timestamp)}
    WHERE id = ${sql(movedItem.id)} AND user_id = ${sql(userId)};
  `);

  return true;
}

function findUserByEmail(email: string): User | null {
  const row = firstRow(queryRows(`
    SELECT id, email, created_at
    FROM users
    WHERE email = ${sql(email)}
    LIMIT 1;
  `));

  return row === null ? null : mapUser(row);
}

function findDefaultStatus(userId: string): Status | null {
  const row = firstRow(queryRows(`
    SELECT id, user_id, name, category, show_in_todo_view, is_default_for_new_items, created_at, updated_at
    FROM statuses
    WHERE user_id = ${sql(userId)} AND is_default_for_new_items = 1
    LIMIT 1;
  `));

  return row === null ? null : mapStatus(row);
}

function findCaptureForDeviceToken(deviceTokenId: string, clientCaptureId: string): Capture | null {
  const row = firstRow(queryRows(`
    SELECT id, user_id, device_token_id, client_capture_id, text, captured_at, metadata_json, created_at
    FROM captures
    WHERE device_token_id = ${sql(deviceTokenId)} AND client_capture_id = ${sql(clientCaptureId)}
    LIMIT 1;
  `));

  return row === null ? null : mapCapture(row);
}

function getCaptureIngestionResult(capture: Capture, duplicate: boolean): CaptureIngestionResult {
  const itemRow = firstRow(queryRows(`
    SELECT id
    FROM items
    WHERE source_capture_id = ${sql(capture.id)}
    LIMIT 1;
  `));

  if (itemRow === null) {
    throw new Error("Capture does not have a routed item.");
  }

  return {
    captureId: capture.id,
    routedItemId: getRequiredString(itemRow, "id"),
    duplicate,
  };
}

function findStatusForUser(statusId: string, userId: string): Status | null {
  const row = firstRow(queryRows(`
    SELECT id, user_id, name, category, show_in_todo_view, is_default_for_new_items, created_at, updated_at
    FROM statuses
    WHERE id = ${sql(statusId)} AND user_id = ${sql(userId)}
    LIMIT 1;
  `));

  return row === null ? null : mapStatus(row);
}

function findSiblingFolder(userId: string, parentId: string | null, name: string): Folder | null {
  const row = firstRow(queryRows(`
    SELECT nodes.id, nodes.user_id, nodes.parent_id, nodes.name, nodes.kind,
      0 AS direct_item_count, nodes.created_at, nodes.updated_at
    FROM nodes
    WHERE nodes.user_id = ${sql(userId)}
      AND ${nodeCondition("nodes.parent_id", parentId)}
      AND nodes.name = ${sql(name)} COLLATE NOCASE
      AND nodes.kind = ${sql("folder")}
    LIMIT 1;
  `));

  return row === null ? null : mapFolder(row);
}

function generateTopTodoRank(userId: string, nodeId: string | null): string {
  const row = firstRow(queryRows(`
    SELECT todo_rank
    FROM items
    WHERE user_id = ${sql(userId)}
      AND ${nodeCondition("node_id", nodeId)}
      AND todo_rank IS NOT NULL
    ORDER BY todo_rank ASC, created_at ASC
    LIMIT 1;
  `));
  return generateKeyBetween(null, row === null ? null : getRequiredString(row, "todo_rank"));
}

function generateBottomTodoRank(userId: string, nodeId: string | null): string {
  const row = firstRow(queryRows(`
    SELECT todo_rank
    FROM items
    WHERE user_id = ${sql(userId)}
      AND ${nodeCondition("node_id", nodeId)}
      AND todo_rank IS NOT NULL
    ORDER BY todo_rank DESC, created_at DESC
    LIMIT 1;
  `));
  return generateKeyBetween(row === null ? null : getRequiredString(row, "todo_rank"), null);
}

function backfillMissingTodoRanks(): void {
  const rows = queryRows(`
    SELECT id, user_id, node_id
    FROM items
    WHERE todo_rank IS NULL
    ORDER BY user_id ASC, COALESCE(node_id, '') ASC, created_at ASC, id ASC;
  `);

  for (const row of rows) {
    const itemId = getRequiredString(row, "id");
    const userId = getRequiredString(row, "user_id");
    const nodeId = getOptionalString(row, "node_id");
    executeSql(`
      UPDATE items
      SET todo_rank = ${sql(generateBottomTodoRank(userId, nodeId))}
      WHERE id = ${sql(itemId)} AND todo_rank IS NULL;
    `);
  }
}

function findInsertionNeighbors(
  items: ReadonlyArray<Item>,
  previousId: string | null,
  nextId: string | null,
): { readonly previousRank: string | null; readonly nextRank: string | null } | null {
  const insertionIndex = previousId === null ? 0 : items.findIndex((item) => item.id === previousId) + 1;

  if (insertionIndex < 0) {
    return null;
  }

  const previousItem = items[insertionIndex - 1];
  const nextItem = items[insertionIndex];

  if ((previousItem?.id ?? null) !== previousId || (nextItem?.id ?? null) !== nextId) {
    return null;
  }

  return {
    previousRank: previousItem?.todoRank ?? null,
    nextRank: nextItem?.todoRank ?? null,
  };
}

function itemSelect(): string {
  return `SELECT items.id, items.user_id, items.node_id, items.status_id,
    statuses.name AS status_name, statuses.category AS status_category,
    items.kind, items.title, items.body, items.source_capture_id, items.status_changed_at,
    items.todo_rank, items.todo_rank_changed_at, items.created_at, items.updated_at
    FROM items
    JOIN statuses ON statuses.id = items.status_id`;
}

function nodeCondition(column: string, nodeId: string | null): string {
  return nodeId === null ? `${column} IS NULL` : `${column} = ${sql(nodeId)}`;
}

function sqlList(values: ReadonlyArray<string>): string {
  return values.map((value) => sql(value)).join(", ");
}

function executeSql(statement: string): void {
  execFileSync(SQLITE_BIN, [getTodoDatabasePath(), `PRAGMA foreign_keys = ON;\n${statement}`], { encoding: "utf8" });
}

function queryRows(statement: string): Array<UnknownRecord> {
  const output = execFileSync(SQLITE_BIN, ["-json", getTodoDatabasePath(), `PRAGMA foreign_keys = ON;\n${statement}`], {
    encoding: "utf8",
  });
  const trimmedOutput = output.trim();

  if (trimmedOutput.length === 0) {
    return [];
  }

  const parsed: unknown = JSON.parse(trimmedOutput);

  if (!Array.isArray(parsed) || parsed.some((row) => !isRecord(row))) {
    throw new Error("SQLite returned an unexpected result shape.");
  }

  return parsed.filter(isRecord);
}

function tableHasColumn(tableName: string, columnName: string): boolean {
  return queryRows(`PRAGMA table_info(${tableName});`).some((row) => row["name"] === columnName);
}

function firstRow(rows: ReadonlyArray<UnknownRecord>): UnknownRecord | null {
  return rows[0] ?? null;
}

function sql(value: string | number | boolean | null): string {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : "NULL";
  }

  return `'${value.replaceAll("'", "''")}'`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapUser(row: UnknownRecord): User {
  return {
    id: getRequiredString(row, "id"),
    email: getRequiredString(row, "email"),
    createdAt: getRequiredString(row, "created_at"),
  };
}

function mapSession(row: UnknownRecord): Session {
  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    sessionHash: getRequiredString(row, "session_hash"),
    expiresAt: getRequiredString(row, "expires_at"),
    createdAt: getRequiredString(row, "created_at"),
    revokedAt: getOptionalString(row, "revoked_at"),
  };
}

function mapDeviceToken(row: UnknownRecord): DeviceToken {
  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    name: getRequiredString(row, "name"),
    tokenHash: getRequiredString(row, "token_hash"),
    createdAt: getRequiredString(row, "created_at"),
    revokedAt: getOptionalString(row, "revoked_at"),
  };
}

function mapCapture(row: UnknownRecord): Capture {
  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    deviceTokenId: getRequiredString(row, "device_token_id"),
    clientCaptureId: getRequiredString(row, "client_capture_id"),
    text: getRequiredString(row, "text"),
    capturedAt: getRequiredString(row, "captured_at"),
    metadataJson: getRequiredString(row, "metadata_json"),
    createdAt: getRequiredString(row, "created_at"),
  };
}

function mapStatus(row: UnknownRecord): Status {
  const category = getRequiredString(row, "category");

  if (!isStatusCategory(category)) {
    throw new Error("SQLite returned an invalid status category.");
  }

  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    name: getRequiredString(row, "name"),
    category,
    showInTodoView: getRequiredBoolean(row, "show_in_todo_view"),
    isDefaultForNewItems: getRequiredBoolean(row, "is_default_for_new_items"),
    createdAt: getRequiredString(row, "created_at"),
    updatedAt: getRequiredString(row, "updated_at"),
  };
}

function mapFolder(row: UnknownRecord): Folder {
  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    parentId: getOptionalString(row, "parent_id"),
    name: getRequiredString(row, "name"),
    kind: getRequiredString(row, "kind"),
    directItemCount: getRequiredNumber(row, "direct_item_count"),
    createdAt: getRequiredString(row, "created_at"),
    updatedAt: getRequiredString(row, "updated_at"),
  };
}

function mapItem(row: UnknownRecord): Item {
  const statusCategory = getRequiredString(row, "status_category");

  if (!isStatusCategory(statusCategory)) {
    throw new Error("SQLite returned an invalid status category.");
  }

  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    nodeId: getOptionalString(row, "node_id"),
    statusId: getRequiredString(row, "status_id"),
    statusName: getRequiredString(row, "status_name"),
    statusCategory,
    kind: getRequiredString(row, "kind"),
    title: getOptionalString(row, "title"),
    body: getRequiredString(row, "body"),
    sourceCaptureId: getOptionalString(row, "source_capture_id"),
    statusChangedAt: getRequiredString(row, "status_changed_at"),
    todoRank: getOptionalString(row, "todo_rank"),
    todoRankChangedAt: getOptionalString(row, "todo_rank_changed_at"),
    createdAt: getRequiredString(row, "created_at"),
    updatedAt: getRequiredString(row, "updated_at"),
  };
}

function mapItemStatusChange(row: UnknownRecord): ItemStatusChange {
  return {
    id: getRequiredString(row, "id"),
    itemId: getRequiredString(row, "item_id"),
    fromStatusName: getOptionalString(row, "from_status_name"),
    toStatusName: getRequiredString(row, "to_status_name"),
    note: getOptionalString(row, "note"),
    changedAt: getRequiredString(row, "changed_at"),
  };
}

function isStatusCategory(value: string): value is StatusCategory {
  return Object.values(STATUS_CATEGORIES).some((category) => category === value);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getRequiredString(row: UnknownRecord, key: string): string {
  const value = row[key];

  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string.`);
  }

  return value;
}

function getOptionalString(row: UnknownRecord, key: string): string | null {
  const value = row[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string or null.`);
  }

  return value;
}

function getRequiredBoolean(row: UnknownRecord, key: string): boolean {
  const value = row[key];

  if (value !== 0 && value !== 1) {
    throw new Error(`Expected ${key} to be a SQLite boolean.`);
  }

  return value === 1;
}

function getRequiredNumber(row: UnknownRecord, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new Error(`Expected ${key} to be a number.`);
  }

  return value;
}
