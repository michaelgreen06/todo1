import type { Folder, Status, TodoItem, WorkspaceSelection, WorkspaceView, WorkspaceViewMode } from "./workspace-types";

type ApiError = {
  readonly error: string;
};

type WorkspaceResponse = {
  readonly workspace: WorkspaceView;
};

type TodoResponse = {
  readonly item: TodoItem;
};

type FolderWorkspaceResponse = {
  readonly folder: Folder;
  readonly workspace: WorkspaceView;
};

export async function loadDefaultWorkspace(): Promise<WorkspaceView> {
  const response = await fetchJson("/api/workspace/default", { method: "GET" });
  return validateWorkspaceResponse(response).workspace;
}

export async function loadWorkspace(selection: WorkspaceSelection): Promise<WorkspaceView> {
  const response = await fetchJson("/api/workspace/view", {
    method: "POST",
    body: JSON.stringify(selection),
  });
  return validateWorkspaceResponse(response).workspace;
}

export async function createTodo(input: {
  readonly title: string;
  readonly body: string;
  readonly folderId: string | null;
}): Promise<TodoItem> {
  const response = await fetchJson("/api/todos", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateTodoResponse(response).item;
}

export async function updateTodo(itemId: string, input: {
  readonly title: string;
  readonly body: string;
  readonly folderId: string | null;
}): Promise<TodoItem> {
  const response = await fetchJson(`/api/todos/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return validateTodoResponse(response).item;
}

export async function changeStatus(itemId: string, input: {
  readonly statusId: string;
  readonly note: string;
}): Promise<TodoItem> {
  const response = await fetchJson(`/api/todos/${encodeURIComponent(itemId)}/status`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateTodoResponse(response).item;
}

export async function moveTodo(itemId: string, input: {
  readonly view: WorkspaceViewMode;
  readonly folderId: string | null;
  readonly folderPath: string;
}): Promise<TodoItem> {
  const response = await fetchJson(`/api/todos/${encodeURIComponent(itemId)}/location`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateTodoResponse(response).item;
}

export async function bulkMove(input: {
  readonly itemIds: ReadonlyArray<string>;
  readonly folderId: string | null;
  readonly folderPath: string;
} & WorkspaceSelection): Promise<WorkspaceView> {
  const response = await fetchJson("/api/todos/bulk/location", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateWorkspaceResponse(response).workspace;
}

export async function reorderTodos(input: {
  readonly movedId: string;
  readonly previousId: string | null;
  readonly nextId: string | null;
} & WorkspaceSelection): Promise<WorkspaceView> {
  const response = await fetchJson("/api/todos/reorder", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateWorkspaceResponse(response).workspace;
}

export async function createFolder(input: {
  readonly folderPath: string;
} & WorkspaceSelection): Promise<FolderWorkspaceResponse> {
  const response = await fetchJson("/api/folders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateFolderWorkspaceResponse(response);
}

export async function renameFolder(folderId: string, input: {
  readonly name: string;
} & WorkspaceSelection): Promise<WorkspaceView> {
  const response = await fetchJson(`/api/folders/${encodeURIComponent(folderId)}/rename`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateWorkspaceResponse(response).workspace;
}

export async function deleteFolder(folderId: string, input: WorkspaceSelection): Promise<WorkspaceView> {
  const response = await fetchJson(`/api/folders/${encodeURIComponent(folderId)}/delete`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return validateWorkspaceResponse(response).workspace;
}

export async function triggerPlaudSync(): Promise<void> {
  const response = await fetchJson("/api/integrations/plaud/run", {
    method: "POST",
    body: JSON.stringify({}),
  });

  if (!isRecord(response) || response["accepted"] !== true) {
    throw new Error("Invalid PLAUD sync response.");
  }
}

async function fetchJson(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
    },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload));
  }

  return payload;
}

export function validateWorkspaceResponse(value: unknown): WorkspaceResponse {
  if (!isRecord(value) || !isWorkspaceView(value["workspace"])) {
    throw new Error("Invalid workspace response.");
  }

  return { workspace: value["workspace"] };
}

function validateTodoResponse(value: unknown): TodoResponse {
  if (!isRecord(value) || !isTodoItem(value["item"])) {
    throw new Error("Invalid todo response.");
  }

  return { item: value["item"] };
}

function validateFolderWorkspaceResponse(value: unknown): FolderWorkspaceResponse {
  if (!isRecord(value) || !isFolder(value["folder"]) || !isWorkspaceView(value["workspace"])) {
    throw new Error("Invalid folder response.");
  }

  return { folder: value["folder"], workspace: value["workspace"] };
}

function getApiErrorMessage(value: unknown): string {
  if (isRecord(value) && typeof value["error"] === "string") {
    const error: ApiError = { error: value["error"] };
    return error.error;
  }

  return "Request failed.";
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return isRecord(value)
    && isWorkspaceViewMode(value["view"])
    && isRecord(value["user"])
    && typeof value["user"]["email"] === "string"
    && isRecord(value["roots"])
    && isFolder(value["roots"]["actions"])
    && isFolder(value["roots"]["reference"])
    && (value["folder"] === null || isFolder(value["folder"]))
    && isArrayOf(value["folders"], isFolder)
    && isArrayOf(value["ancestors"], isFolder)
    && typeof value["inboxCount"] === "number"
    && isArrayOf(value["todos"], isTodoItem)
    && isArrayOf(value["statuses"], isStatus)
    && isArrayOf(value["selectedStatusIds"], isString);
}

function isWorkspaceViewMode(value: unknown): value is WorkspaceViewMode {
  return value === "inbox" || value === "actions" || value === "reference";
}

function isTodoItem(value: unknown): value is TodoItem {
  return isRecord(value)
    && typeof value["id"] === "string"
    && typeof value["userId"] === "string"
    && (value["nodeId"] === null || typeof value["nodeId"] === "string")
    && typeof value["statusId"] === "string"
    && typeof value["statusName"] === "string"
    && isStatusCategory(value["statusCategory"])
    && typeof value["kind"] === "string"
    && (value["title"] === null || typeof value["title"] === "string")
    && typeof value["body"] === "string"
    && (value["sourceCaptureId"] === null || typeof value["sourceCaptureId"] === "string")
    && typeof value["statusChangedAt"] === "string"
    && (value["todoRank"] === null || typeof value["todoRank"] === "string")
    && (value["todoRankChangedAt"] === null || typeof value["todoRankChangedAt"] === "string")
    && typeof value["createdAt"] === "string"
    && typeof value["updatedAt"] === "string";
}

function isFolder(value: unknown): value is Folder {
  return isRecord(value)
    && typeof value["id"] === "string"
    && typeof value["userId"] === "string"
    && (value["parentId"] === null || typeof value["parentId"] === "string")
    && typeof value["name"] === "string"
    && typeof value["kind"] === "string"
    && typeof value["directItemCount"] === "number"
    && typeof value["createdAt"] === "string"
    && typeof value["updatedAt"] === "string";
}

function isStatus(value: unknown): value is Status {
  return isRecord(value)
    && typeof value["id"] === "string"
    && typeof value["userId"] === "string"
    && typeof value["name"] === "string"
    && isStatusCategory(value["category"])
    && typeof value["showInTodoView"] === "boolean"
    && typeof value["isDefaultForNewItems"] === "boolean"
    && typeof value["createdAt"] === "string"
    && typeof value["updatedAt"] === "string";
}

function isStatusCategory(value: unknown): value is Status["category"] {
  return value === "active" || value === "deferred" || value === "completed" || value === "archived";
}

function isArrayOf<T>(value: unknown, predicate: (entry: unknown) => entry is T): value is ReadonlyArray<T> {
  return Array.isArray(value) && value.every(predicate);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
