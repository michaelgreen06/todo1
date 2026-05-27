import { execFileSync } from "node:child_process";

export const ACTIVE_STATUS = "active";
export const COMPLETED_STATUS = "completed";
export const ARCHIVED_STATUS = "archived";

export type TodoStatus =
  | typeof ACTIVE_STATUS
  | typeof COMPLETED_STATUS
  | typeof ARCHIVED_STATUS;

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

export type TodoItem = {
  readonly id: string;
  readonly userId: string;
  readonly title: string | null;
  readonly body: string;
  readonly status: TodoStatus;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type UnknownRecord = Readonly<Record<string, unknown>>;

const SQLITE_BIN = "/usr/bin/sqlite3";
const DATABASE_PATH = "todo.sqlite";

export function initializeDatabase(): void {
  executeSql(`
    PRAGMA foreign_keys = ON;

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

    CREATE TABLE IF NOT EXISTS todo_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived')),
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_login_tokens_hash ON login_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(session_hash);
    CREATE INDEX IF NOT EXISTS idx_todo_items_user_status_order
      ON todo_items(user_id, status, sort_order);
  `);
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

  executeSql(
    `INSERT INTO users (id, email, created_at)
     VALUES (${sql(user.id)}, ${sql(user.email)}, ${sql(user.createdAt)});`,
  );

  return user;
}

export function findUserById(userId: string): User | null {
  const row = firstRow(
    queryRows(
      `SELECT id, email, created_at
       FROM users
       WHERE id = ${sql(userId)}
       LIMIT 1;`,
    ),
  );

  return row === null ? null : mapUser(row);
}

export function createLoginToken(
  userId: string,
  tokenHash: string,
  expiresAt: string,
): LoginToken {
  const token: LoginToken = {
    id: globalThis.crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
    usedAt: null,
    createdAt: nowIso(),
  };

  executeSql(
    `INSERT INTO login_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
     VALUES (${sql(token.id)}, ${sql(token.userId)}, ${sql(token.tokenHash)}, ${sql(token.expiresAt)}, NULL, ${sql(token.createdAt)});`,
  );

  return token;
}

export function findUsableLoginToken(tokenHash: string, currentTime: string): LoginToken | null {
  const row = firstRow(
    queryRows(
      `SELECT id, user_id, token_hash, expires_at, used_at, created_at
       FROM login_tokens
       WHERE token_hash = ${sql(tokenHash)}
         AND used_at IS NULL
         AND expires_at > ${sql(currentTime)}
       LIMIT 1;`,
    ),
  );

  return row === null ? null : mapLoginToken(row);
}

export function markLoginTokenUsed(tokenId: string): void {
  executeSql(
    `UPDATE login_tokens
     SET used_at = ${sql(nowIso())}
     WHERE id = ${sql(tokenId)} AND used_at IS NULL;`,
  );
}

export function createSession(
  userId: string,
  sessionHash: string,
  expiresAt: string,
): Session {
  const session: Session = {
    id: globalThis.crypto.randomUUID(),
    userId,
    sessionHash,
    expiresAt,
    createdAt: nowIso(),
    revokedAt: null,
  };

  executeSql(
    `INSERT INTO sessions (id, user_id, session_hash, expires_at, created_at, revoked_at)
     VALUES (${sql(session.id)}, ${sql(session.userId)}, ${sql(session.sessionHash)}, ${sql(session.expiresAt)}, ${sql(session.createdAt)}, NULL);`,
  );

  return session;
}

export function findActiveSession(sessionHash: string, currentTime: string): Session | null {
  const row = firstRow(
    queryRows(
      `SELECT id, user_id, session_hash, expires_at, created_at, revoked_at
       FROM sessions
       WHERE session_hash = ${sql(sessionHash)}
         AND revoked_at IS NULL
         AND expires_at > ${sql(currentTime)}
       LIMIT 1;`,
    ),
  );

  return row === null ? null : mapSession(row);
}

export function revokeSession(sessionHash: string): void {
  executeSql(
    `UPDATE sessions
     SET revoked_at = ${sql(nowIso())}
     WHERE session_hash = ${sql(sessionHash)} AND revoked_at IS NULL;`,
  );
}

export function consumeLoginTokenAndCreateSession(
  tokenHash: string,
  sessionHash: string,
  sessionExpiresAt: string,
  currentTime: string,
): Session | null {
  const sessionId = globalThis.crypto.randomUUID();
  executeSql(
    `BEGIN IMMEDIATE;
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
     COMMIT;`,
  );

  return findActiveSession(sessionHash, currentTime);
}

export function listActiveTodos(userId: string): Array<TodoItem> {
  return queryRows(
    `SELECT id, user_id, title, body, status, sort_order, created_at, updated_at
     FROM todo_items
     WHERE user_id = ${sql(userId)} AND status = ${sql(ACTIVE_STATUS)}
     ORDER BY sort_order ASC, created_at ASC;`,
  ).map(mapTodoItem);
}

export function findTodoForUser(todoId: string, userId: string): TodoItem | null {
  const row = firstRow(
    queryRows(
      `SELECT id, user_id, title, body, status, sort_order, created_at, updated_at
       FROM todo_items
       WHERE id = ${sql(todoId)} AND user_id = ${sql(userId)}
       LIMIT 1;`,
    ),
  );

  return row === null ? null : mapTodoItem(row);
}

export function createTodoItem(
  userId: string,
  title: string | null,
  body: string,
): TodoItem {
  const timestamp = nowIso();
  const item: TodoItem = {
    id: globalThis.crypto.randomUUID(),
    userId,
    title,
    body,
    status: ACTIVE_STATUS,
    sortOrder: getNextSortOrder(userId),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  executeSql(
    `INSERT INTO todo_items (id, user_id, title, body, status, sort_order, created_at, updated_at)
     VALUES (${sql(item.id)}, ${sql(item.userId)}, ${sql(item.title)}, ${sql(item.body)}, ${sql(item.status)}, ${item.sortOrder.toString()}, ${sql(item.createdAt)}, ${sql(item.updatedAt)});`,
  );

  return item;
}

export function updateTodoItem(
  todoId: string,
  userId: string,
  title: string | null,
  body: string,
): void {
  executeSql(
    `UPDATE todo_items
     SET title = ${sql(title)}, body = ${sql(body)}, updated_at = ${sql(nowIso())}
     WHERE id = ${sql(todoId)} AND user_id = ${sql(userId)};`,
  );
}

export function setTodoStatus(todoId: string, userId: string, status: TodoStatus): void {
  executeSql(
    `UPDATE todo_items
     SET status = ${sql(status)}, updated_at = ${sql(nowIso())}
     WHERE id = ${sql(todoId)} AND user_id = ${sql(userId)};`,
  );
}

export function moveActiveTodo(userId: string, todoId: string, direction: "up" | "down"): void {
  const reorderedTodos = [...listActiveTodos(userId)];
  const currentIndex = reorderedTodos.findIndex((todo) => todo.id === todoId);

  if (currentIndex === -1) {
    return;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= reorderedTodos.length) {
    return;
  }

  const currentTodo = reorderedTodos[currentIndex];
  const targetTodo = reorderedTodos[targetIndex];

  if (currentTodo === undefined || targetTodo === undefined) {
    return;
  }

  reorderedTodos[currentIndex] = targetTodo;
  reorderedTodos[targetIndex] = currentTodo;
  renumberActiveTodos(userId, reorderedTodos.map((todo) => todo.id));
}

export function reorderActiveTodos(userId: string, orderedIds: ReadonlyArray<string>): boolean {
  const activeTodos = listActiveTodos(userId);

  if (activeTodos.length !== orderedIds.length) {
    return false;
  }

  const activeIds = new Set(activeTodos.map((todo) => todo.id));
  const orderedIdSet = new Set(orderedIds);

  if (activeIds.size !== orderedIdSet.size) {
    return false;
  }

  if (orderedIds.some((id) => !activeIds.has(id))) {
    return false;
  }

  renumberActiveTodos(userId, orderedIds);
  return true;
}

function findUserByEmail(email: string): User | null {
  const row = firstRow(
    queryRows(
      `SELECT id, email, created_at
       FROM users
       WHERE email = ${sql(email)}
       LIMIT 1;`,
    ),
  );

  return row === null ? null : mapUser(row);
}

function getNextSortOrder(userId: string): number {
  const row = firstRow(
    queryRows(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
       FROM todo_items
       WHERE user_id = ${sql(userId)} AND status = ${sql(ACTIVE_STATUS)};`,
    ),
  );

  return row === null ? 1 : getRequiredNumber(row, "next_sort_order");
}

function renumberActiveTodos(userId: string, orderedIds: ReadonlyArray<string>): void {
  const timestamp = nowIso();
  const updates = orderedIds
    .map(
      (todoId, index) =>
        `UPDATE todo_items
         SET sort_order = ${(index + 1).toString()}, updated_at = ${sql(timestamp)}
         WHERE id = ${sql(todoId)} AND user_id = ${sql(userId)} AND status = ${sql(ACTIVE_STATUS)};`,
    )
    .join("\n");

  executeSql(`BEGIN TRANSACTION;\n${updates}\nCOMMIT;`);
}

function executeSql(statement: string): void {
  execFileSync(SQLITE_BIN, [DATABASE_PATH, statement], { encoding: "utf8" });
}

function queryRows(statement: string): Array<UnknownRecord> {
  const output = execFileSync(SQLITE_BIN, ["-json", DATABASE_PATH, statement], {
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

function firstRow(rows: ReadonlyArray<UnknownRecord>): UnknownRecord | null {
  const row = rows[0];
  return row ?? null;
}

function sql(value: string | number | null): string {
  if (value === null) {
    return "NULL";
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

function mapLoginToken(row: UnknownRecord): LoginToken {
  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    tokenHash: getRequiredString(row, "token_hash"),
    expiresAt: getRequiredString(row, "expires_at"),
    usedAt: getOptionalString(row, "used_at"),
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

function mapTodoItem(row: UnknownRecord): TodoItem {
  const status = getRequiredString(row, "status");

  if (!isTodoStatus(status)) {
    throw new Error("SQLite returned an invalid todo status.");
  }

  return {
    id: getRequiredString(row, "id"),
    userId: getRequiredString(row, "user_id"),
    title: getOptionalString(row, "title"),
    body: getRequiredString(row, "body"),
    status,
    sortOrder: getRequiredNumber(row, "sort_order"),
    createdAt: getRequiredString(row, "created_at"),
    updatedAt: getRequiredString(row, "updated_at"),
  };
}

function isTodoStatus(value: string): value is TodoStatus {
  return value === ACTIVE_STATUS || value === COMPLETED_STATUS || value === ARCHIVED_STATUS;
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

function getRequiredNumber(row: UnknownRecord, key: string): number {
  const value = row[key];

  if (typeof value !== "number") {
    throw new Error(`Expected ${key} to be a number.`);
  }

  return value;
}
