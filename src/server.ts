import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  consumeMagicToken,
  createMagicLoginLink,
  getSessionMaxAgeSeconds,
  getUserForSessionToken,
  revokeSessionToken,
} from "./auth.js";
import {
  changeItemStatus,
  countInboxItems,
  createFolderPath,
  createTodoItem,
  deleteEmptyLeafFolder,
  findActiveDeviceToken,
  findFolderForUser,
  findItemForUser,
  initializeDatabase,
  listFolderAncestors,
  listFolders,
  listItemStatusChanges,
  listStatuses,
  listTodoItems,
  moveTodoItemToLocation,
  moveVisibleTodoItem,
  renameFolder,
  reorderVisibleTodoItem,
  routeCaptureForMvp,
  updateTodoItem,
} from "./db.js";
import {
  renderEditPage,
  renderLoginPage,
  renderNotFoundPage,
  renderTodoPage,
} from "./html.js";
import { getHost, getPort, getPublicBaseUrl } from "./process-env.js";
import { hashRawToken } from "./token.js";
import {
  validateCaptureInput,
  validateEmail,
  validateFolderName,
  validateFolderPath,
  validateLocationInput,
  validateReorderInput,
  validateStatusChangeInput,
  validateTodoInput,
} from "./validation.js";
import type { Folder, Status, User } from "./db.js";
import type { WorkspaceView, WorkspaceViewRequest } from "./api-types.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const SESSION_COOKIE_NAME = "todo_session";
const MAX_CAPTURE_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_API_REQUEST_BODY_BYTES = 128 * 1024;
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRONTEND_DIST_DIR = join(PROJECT_ROOT, "frontend", "dist");

type AuthenticatedRequest = {
  readonly user: User;
  readonly sessionToken: string;
};

type RouteParams = {
  readonly id: string;
  readonly action: string;
};

type PageContext = {
  readonly folder: Folder | null;
  readonly statuses: ReadonlyArray<Status>;
  readonly selectedStatusIds: ReadonlyArray<string>;
  readonly returnTo: string;
};

type JsonRecord = Readonly<Record<string, unknown>>;

type ApiViewPayload = {
  readonly folderId: string | null;
  readonly statusIds: ReadonlyArray<string> | null;
};

type TodoPayload = {
  readonly title: string | null;
  readonly body: string | null;
  readonly folderId: string | null;
};

type LocationPayload = {
  readonly folderId: string | null;
  readonly folderPath: string | null;
};

type BulkLocationPayload = LocationPayload & {
  readonly itemIds: ReadonlyArray<string>;
};

type StatusPayload = {
  readonly statusId: string | null;
  readonly note: string | null;
};

type FolderPathPayload = {
  readonly folderPath: string | null;
};

type FolderNamePayload = {
  readonly name: string | null;
};

type ReorderPayload = {
  readonly movedId: string | null;
  readonly previousId: string | null;
  readonly nextId: string | null;
  readonly folderId: string | null;
  readonly statusIds: ReadonlyArray<string> | null;
};

export function startServer(): void {
  initializeDatabase();
  const host = getHost();
  const port = getPort();
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  server.listen(port, host, () => {
    console.log(`Todo MVP running at http://${host}:${port.toString()}`);
  });
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    await routeRequest(request, response);
  } catch (error) {
    console.error(error);
    sendHtml(response, 500, renderErrorPage("Server error", "Something went wrong."));
  }
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = makeRequestUrl(request);

  if (method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, '{"ok":true}');
    return;
  }

  if (method === "GET" && url.pathname === "/login") {
    sendHtml(response, 200, renderLoginPage({
      message: url.searchParams.get("sent") === "1" ? "Magic link created. Check the terminal." : null,
      error: null,
    }));
    return;
  }

  if (method === "POST" && url.pathname === "/login") {
    await handleLogin(request, response);
    return;
  }

  if (method === "GET" && url.pathname === "/auth/magic") {
    await handleMagicAuth(request, url, response);
    return;
  }

  if (method === "POST" && url.pathname === "/items") {
    await handleCaptureIngestion(request, response);
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/assets/")) {
    await serveBuiltAsset(url, response);
    return;
  }

  const authenticatedRequest = await authenticateRequest(request);

  if (authenticatedRequest === null) {
    if (url.pathname.startsWith("/api/")) {
      sendJsonValue(response, 401, { error: "Unauthorized" });
      return;
    }

    redirect(response, "/login");
    return;
  }

  const user = authenticatedRequest.user;

  if (method === "POST" && url.pathname === "/logout") {
    await revokeSessionToken(authenticatedRequest.sessionToken);
    clearSessionCookie(response, shouldUseSecureCookies(request));
    redirect(response, "/login");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(request, url, response, user);
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    if (await serveWorkspaceShell(response)) {
      return;
    }

    // TODO: Remove this SSR workspace fallback after the React workspace is stable.
    sendTodoPage(response, user, url, null, null);
    return;
  }

  if (method === "GET" && url.pathname === "/navigate") {
    handleNavigate(response, user, url);
    return;
  }

  if (method === "POST" && url.pathname === "/folders") {
    await handleCreateFolder(request, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/todos") {
    await handleCreateTodo(request, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/todos/reorder") {
    await handleReorderTodos(request, url, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/todos/status") {
    await handleChangeStatusFromForm(request, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/todos/bulk/location") {
    await handleBulkChangeLocation(request, response, user);
    return;
  }

  const folderRoute = parseFolderRoute(url.pathname);

  if (folderRoute !== null) {
    if (method === "GET" && folderRoute.action === "view") {
      const folder = findFolderForUser(folderRoute.id, user.id);

      if (folder === null) {
        sendHtml(response, 404, renderNotFoundPage());
        return;
      }

      // TODO: Remove this SSR workspace fallback after the React workspace is stable.
      sendTodoPage(response, user, url, folder, null);
      return;
    }

    if (method === "POST" && folderRoute.action === "rename") {
      await handleRenameFolder(request, response, user, folderRoute.id);
      return;
    }

    if (method === "POST" && folderRoute.action === "delete") {
      await handleDeleteFolder(request, response, user, folderRoute.id);
      return;
    }
  }

  const todoRoute = parseTodoRoute(url.pathname);

  if (todoRoute === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  if (method === "GET" && todoRoute.action === "edit") {
    // TODO: Remove this SSR workspace fallback after the React workspace is stable.
    handleEditPage(response, user, todoRoute.id, url);
    return;
  }

  if (method === "POST" && todoRoute.action === "update") {
    await handleUpdateTodo(request, response, user, todoRoute.id);
    return;
  }

  if (method === "POST" && todoRoute.action === "status") {
    await handleChangeStatus(request, response, user, todoRoute.id);
    return;
  }

  if (method === "POST" && todoRoute.action === "location") {
    await handleChangeLocation(request, response, user, todoRoute.id);
    return;
  }

  if (method === "POST" && (todoRoute.action === "move-up" || todoRoute.action === "move-down")) {
    await handleMoveVisibleTodo(request, response, user, todoRoute.id, todoRoute.action === "move-up" ? "up" : "down");
    return;
  }

  sendHtml(response, 404, renderNotFoundPage());
}

async function handleCaptureIngestion(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const rawDeviceToken = getBearerToken(request);

  if (rawDeviceToken === null) {
    sendJson(response, 401, JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const deviceToken = findActiveDeviceToken(hashRawToken(rawDeviceToken));

  if (deviceToken === null) {
    sendJson(response, 401, JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  let rawBody: string;

  try {
    rawBody = await readRequestBody(request, MAX_CAPTURE_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendJson(response, 400, JSON.stringify({ error: error.message }));
      return;
    }

    throw error;
  }

  const captureResult = validateCaptureInput(parseJson(rawBody));

  if (!captureResult.ok) {
    sendJson(response, 400, JSON.stringify({ error: captureResult.message }));
    return;
  }

  const result = routeCaptureForMvp(deviceToken, captureResult.value);
  sendJson(response, 201, JSON.stringify({
    capture_id: result.captureId,
    routed_item_id: result.routedItemId,
    duplicate: result.duplicate,
  }));
}

async function handleApiRequest(
  request: IncomingMessage,
  url: URL,
  response: ServerResponse,
  user: User,
): Promise<void> {
  const method = request.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/workspace/default") {
    sendWorkspaceViewResponse(response, user, { folderId: null, statusIds: null });
    return;
  }

  if (method === "POST" && url.pathname === "/api/workspace/view") {
    const payload = parseApiViewPayload(await readApiJsonBody(request));
    sendWorkspaceViewResponse(response, user, payload);
    return;
  }

  if (method === "POST" && url.pathname === "/api/todos") {
    await handleApiCreateTodo(request, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/api/todos/bulk/location") {
    await handleApiBulkChangeLocation(request, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/api/todos/reorder") {
    await handleApiReorderTodos(request, response, user);
    return;
  }

  if (method === "POST" && url.pathname === "/api/folders") {
    await handleApiCreateFolder(request, response, user);
    return;
  }

  const apiFolderRoute = parseApiResourceRoute(url.pathname, "folders");

  if (apiFolderRoute !== null) {
    if (method === "POST" && apiFolderRoute.action === "rename") {
      await handleApiRenameFolder(request, response, user, apiFolderRoute.id);
      return;
    }

    if (method === "POST" && apiFolderRoute.action === "delete") {
      await handleApiDeleteFolder(request, response, user, apiFolderRoute.id);
      return;
    }
  }

  const apiTodoRoute = parseApiResourceRoute(url.pathname, "todos");

  if (apiTodoRoute !== null) {
    if (method === "PATCH" && apiTodoRoute.action === null) {
      await handleApiUpdateTodo(request, response, user, apiTodoRoute.id);
      return;
    }

    if (method === "POST" && apiTodoRoute.action === "status") {
      await handleApiChangeStatus(request, response, user, apiTodoRoute.id);
      return;
    }

    if (method === "POST" && apiTodoRoute.action === "location") {
      await handleApiChangeLocation(request, response, user, apiTodoRoute.id);
      return;
    }
  }

  sendJsonValue(response, 404, { error: "Not found" });
}

async function handleApiCreateTodo(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const payload = parseTodoPayload(await readApiJsonBody(request));
  const todoResult = validateTodoInput(payload.title, payload.body);
  const locationResult = validateLocationInput(payload.folderId, null);

  if (!todoResult.ok) {
    sendApiValidationError(response, todoResult.message);
    return;
  }

  if (!locationResult.ok) {
    sendApiValidationError(response, locationResult.message);
    return;
  }

  const folderId = locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  sendJsonValue(response, 201, { item: createTodoItem(user.id, todoResult.value.title, todoResult.value.body, folderId) });
}

async function handleApiUpdateTodo(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  todoId: string,
): Promise<void> {
  const existingTodo = findItemForUser(todoId, user.id);

  if (existingTodo === null) {
    sendJsonValue(response, 404, { error: "Todo not found" });
    return;
  }

  const payload = parseTodoPayload(await readApiJsonBody(request));
  const todoResult = validateTodoInput(payload.title, payload.body);
  const locationResult = validateLocationInput(payload.folderId, null);

  if (!todoResult.ok) {
    sendApiValidationError(response, todoResult.message);
    return;
  }

  if (!locationResult.ok) {
    sendApiValidationError(response, locationResult.message);
    return;
  }

  const folderId = locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  updateTodoItem(existingTodo.id, user.id, todoResult.value.title, todoResult.value.body);

  if (existingTodo.nodeId !== folderId) {
    moveTodoItemToLocation(existingTodo.id, user.id, folderId);
  }

  const updatedTodo = findItemForUser(existingTodo.id, user.id);

  if (updatedTodo === null) {
    throw new Error("Updated item could not be found.");
  }

  sendJsonValue(response, 200, { item: updatedTodo });
}

async function handleApiChangeStatus(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  todoId: string,
): Promise<void> {
  const existingTodo = findItemForUser(todoId, user.id);

  if (existingTodo === null) {
    sendJsonValue(response, 404, { error: "Todo not found" });
    return;
  }

  const payload = parseStatusPayload(await readApiJsonBody(request));
  const statusResult = validateStatusChangeInput(payload.statusId, payload.note);

  if (!statusResult.ok) {
    sendApiValidationError(response, statusResult.message);
    return;
  }

  if (!listStatuses(user.id).some((status) => status.id === statusResult.value.statusId)) {
    sendJsonValue(response, 404, { error: "Status not found" });
    return;
  }

  if (existingTodo.statusId !== statusResult.value.statusId) {
    changeItemStatus(existingTodo.id, user.id, statusResult.value.statusId, statusResult.value.note);
  }

  const updatedTodo = findItemForUser(existingTodo.id, user.id);

  if (updatedTodo === null) {
    throw new Error("Updated item could not be found.");
  }

  sendJsonValue(response, 200, { item: updatedTodo });
}

async function handleApiChangeLocation(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  todoId: string,
): Promise<void> {
  const existingTodo = findItemForUser(todoId, user.id);

  if (existingTodo === null) {
    sendJsonValue(response, 404, { error: "Todo not found" });
    return;
  }

  const locationResult = getApiLocationResult(await readApiJsonBody(request));

  if (!locationResult.ok) {
    sendApiValidationError(response, locationResult.message);
    return;
  }

  const folder = locationResult.value.folderPathSegments === null
    ? null
    : createFolderPath(user.id, locationResult.value.folderPathSegments);
  const folderId = folder?.id ?? locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  moveTodoItemToLocation(existingTodo.id, user.id, folderId);

  const updatedTodo = findItemForUser(existingTodo.id, user.id);

  if (updatedTodo === null) {
    throw new Error("Moved item could not be found.");
  }

  sendJsonValue(response, 200, { item: updatedTodo });
}

async function handleApiBulkChangeLocation(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const rawPayload = await readApiJsonBody(request);
  const payload = parseBulkLocationPayload(rawPayload);
  const todoIds = uniqueStrings(payload.itemIds);

  if (todoIds.length === 0) {
    sendApiValidationError(response, "Select at least one item to move.");
    return;
  }

  const locationResult = validateLocationInput(payload.folderId, payload.folderPath);

  if (!locationResult.ok) {
    sendApiValidationError(response, locationResult.message);
    return;
  }

  for (const todoId of todoIds) {
    if (findItemForUser(todoId, user.id) === null) {
      sendJsonValue(response, 404, { error: "Todo not found" });
      return;
    }
  }

  const folder = locationResult.value.folderPathSegments === null
    ? null
    : createFolderPath(user.id, locationResult.value.folderPathSegments);
  const folderId = folder?.id ?? locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  for (const todoId of todoIds) {
    moveTodoItemToLocation(todoId, user.id, folderId);
  }

  sendWorkspaceViewResponse(response, user, parseApiViewPayload(rawPayload));
}

async function handleApiReorderTodos(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const rawPayload = await readApiJsonBody(request);
  const payload = parseReorderPayload(rawPayload);
  const reorderResult = validateReorderInput({
    movedId: payload.movedId,
    previousId: payload.previousId,
    nextId: payload.nextId,
  });

  if (!reorderResult.ok) {
    sendApiValidationError(response, reorderResult.message);
    return;
  }

  const viewRequest = parseApiViewPayload(rawPayload);
  const view = getWorkspaceView(user, viewRequest);
  const wasReordered = reorderVisibleTodoItem(user.id, reorderResult.value, view.folder?.id ?? null, view.selectedStatusIds);

  if (!wasReordered) {
    sendJsonValue(response, 400, { error: "Invalid reorder request" });
    return;
  }

  sendWorkspaceViewResponse(response, user, viewRequest);
}

async function handleApiCreateFolder(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const rawPayload = await readApiJsonBody(request);
  const payload = parseFolderPathPayload(rawPayload);
  const pathResult = validateFolderPath(payload.folderPath);

  if (!pathResult.ok) {
    sendApiValidationError(response, pathResult.message);
    return;
  }

  const folder = createFolderPath(user.id, pathResult.value);
  sendJsonValue(response, 201, { folder, workspace: getWorkspaceView(user, { folderId: folder.id, statusIds: parseApiViewPayload(rawPayload).statusIds }) });
}

async function handleApiRenameFolder(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  folderId: string,
): Promise<void> {
  const rawPayload = await readApiJsonBody(request);
  const payload = parseFolderNamePayload(rawPayload);
  const nameResult = validateFolderName(payload.name);

  if (!nameResult.ok) {
    sendApiValidationError(response, nameResult.message);
    return;
  }

  const result = renameFolder(folderId, user.id, nameResult.value);

  if (result === "not-found") {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  if (result === "duplicate") {
    sendApiValidationError(response, "A sibling folder already uses that name.");
    return;
  }

  sendWorkspaceViewResponse(response, user, parseApiViewPayload(rawPayload));
}

async function handleApiDeleteFolder(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  folderId: string,
): Promise<void> {
  const rawPayload = await readApiJsonBody(request);
  const folder = findFolderForUser(folderId, user.id);

  if (folder === null) {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  const result = deleteEmptyLeafFolder(folder.id, user.id);

  if (result === "not-empty") {
    sendApiValidationError(response, "Delete items and child folders before deleting this folder.");
    return;
  }

  if (result === "not-found") {
    sendJsonValue(response, 404, { error: "Folder not found" });
    return;
  }

  const view = parseApiViewPayload(rawPayload);
  const nextFolderId = view.folderId === folder.id ? folder.parentId : view.folderId;
  sendWorkspaceViewResponse(response, user, { folderId: nextFolderId, statusIds: view.statusIds });
}

async function handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const emailResult = validateEmail(form.get("email"));

  if (!emailResult.ok) {
    sendHtml(response, 400, renderLoginPage({ message: null, error: emailResult.message }));
    return;
  }

  const magicLink = await createMagicLoginLink(emailResult.value, getEffectiveBaseUrl(request));
  console.log(`Magic login link for ${magicLink.user.email}: ${magicLink.loginUrl}`);
  redirect(response, "/login?sent=1");
}

async function handleMagicAuth(request: IncomingMessage, url: URL, response: ServerResponse): Promise<void> {
  const consumedToken = await consumeMagicToken(url.searchParams.get("token"));

  if (consumedToken === null) {
    sendHtml(response, 400, renderLoginPage({ message: null, error: "This magic link is invalid or expired." }));
    return;
  }

  setSessionCookie(response, consumedToken.sessionToken, shouldUseSecureCookies(request));
  redirect(response, "/");
}

function handleNavigate(response: ServerResponse, user: User, url: URL): void {
  const statuses = listStatuses(user.id);
  const selectedStatusIds = getSelectedStatusIds(url, statuses);
  const folderId = url.searchParams.get("folderId");
  const folder = folderId === null || folderId.length === 0 ? null : findFolderForUser(folderId, user.id);

  if (folderId !== null && folderId.length > 0 && folder === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  redirect(response, locationUrl(folder, selectedStatusIds));
}

async function handleCreateFolder(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, "/");
  const pathResult = validateFolderPath(form.get("folderPath"));

  if (!pathResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, pathResult.message);
    return;
  }

  const folder = createFolderPath(user.id, pathResult.value);
  redirect(response, locationUrl(folder, getSelectedStatusIds(makeLocalUrl(returnTo), listStatuses(user.id))));
}

async function handleRenameFolder(request: IncomingMessage, response: ServerResponse, user: User, folderId: string): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, `/folders/${encodeURIComponent(folderId)}`);
  const nameResult = validateFolderName(form.get("name"));

  if (!nameResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, nameResult.message);
    return;
  }

  const result = renameFolder(folderId, user.id, nameResult.value);

  if (result === "not-found") {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  if (result === "duplicate") {
    sendTodoPageForReturnTo(response, user, returnTo, "A sibling folder already uses that name.");
    return;
  }

  redirect(response, returnTo);
}

async function handleDeleteFolder(request: IncomingMessage, response: ServerResponse, user: User, folderId: string): Promise<void> {
  const folder = findFolderForUser(folderId, user.id);

  if (folder === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, `/folders/${encodeURIComponent(folderId)}`);
  const result = deleteEmptyLeafFolder(folder.id, user.id);

  if (result === "not-empty") {
    sendTodoPageForReturnTo(response, user, returnTo, "Delete items and child folders before deleting this folder.");
    return;
  }

  if (result === "not-found") {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  const parent = folder.parentId === null ? null : findFolderForUser(folder.parentId, user.id);
  redirect(response, locationUrl(parent, getSelectedStatusIds(makeLocalUrl(returnTo), listStatuses(user.id))));
}

async function handleCreateTodo(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, "/");
  const todoResult = validateTodoInput(form.get("title"), form.get("body"));
  const locationResult = validateLocationInput(form.get("folderId"), null);

  if (!todoResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, todoResult.message);
    return;
  }

  if (!locationResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, locationResult.message);
    return;
  }

  const folderId = locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  createTodoItem(user.id, todoResult.value.title, todoResult.value.body, folderId);
  redirect(response, returnTo);
}

function handleEditPage(response: ServerResponse, user: User, todoId: string, url: URL): void {
  const todo = findItemForUser(todoId, user.id);

  if (todo === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  sendHtml(response, 200, renderEditPage({
    todo,
    history: listItemStatusChanges(todo.id, user.id),
    folders: listFolders(user.id, []),
    returnTo: getSafeReturnTo(url.searchParams.get("returnTo"), itemLocationUrl(todo.nodeId)),
    error: null,
  }));
}

async function handleUpdateTodo(request: IncomingMessage, response: ServerResponse, user: User, todoId: string): Promise<void> {
  const todo = findItemForUser(todoId, user.id);

  if (todo === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, itemLocationUrl(todo.nodeId));
  const todoResult = validateTodoInput(form.get("title"), form.get("body"));
  const locationResult = validateLocationInput(form.get("folderId"), null);

  if (!todoResult.ok) {
    sendHtml(response, 400, renderEditPage({
      todo,
      history: listItemStatusChanges(todo.id, user.id),
      folders: listFolders(user.id, []),
      returnTo,
      error: todoResult.message,
    }));
    return;
  }

  if (!locationResult.ok) {
    sendHtml(response, 400, renderEditPage({
      todo,
      history: listItemStatusChanges(todo.id, user.id),
      folders: listFolders(user.id, []),
      returnTo,
      error: locationResult.message,
    }));
    return;
  }

  const folderId = locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  updateTodoItem(todo.id, user.id, todoResult.value.title, todoResult.value.body);

  if (todo.nodeId !== folderId) {
    moveTodoItemToLocation(todo.id, user.id, folderId);
  }

  redirect(response, returnTo);
}

async function handleChangeStatus(request: IncomingMessage, response: ServerResponse, user: User, todoId: string): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, "/");
  const statusResult = validateStatusChangeInput(form.get("statusId"), form.get("note"));

  if (!statusResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, statusResult.message);
    return;
  }

  if (!changeItemStatus(todoId, user.id, statusResult.value.statusId, statusResult.value.note)) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  redirect(response, returnTo);
}

async function handleChangeStatusFromForm(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const todoId = form.get("itemId");
  const returnTo = getReturnTo(form, "/");

  if (todoId === null || todoId.trim().length === 0) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  const statusResult = validateStatusChangeInput(form.get("statusId"), form.get("note"));

  if (!statusResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, statusResult.message);
    return;
  }

  if (!changeItemStatus(todoId, user.id, statusResult.value.statusId, statusResult.value.note)) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  redirect(response, returnTo);
}

async function handleChangeLocation(request: IncomingMessage, response: ServerResponse, user: User, todoId: string): Promise<void> {
  if (findItemForUser(todoId, user.id) === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, "/");
  const locationResult = validateLocationInput(form.get("folderId"), form.get("folderPath"));

  if (!locationResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, locationResult.message);
    return;
  }

  const folder = locationResult.value.folderPathSegments === null
    ? null
    : createFolderPath(user.id, locationResult.value.folderPathSegments);
  const folderId = folder?.id ?? locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  if (!moveTodoItemToLocation(todoId, user.id, folderId)) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  redirect(response, returnTo);
}

async function handleBulkChangeLocation(request: IncomingMessage, response: ServerResponse, user: User): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, "/");
  const todoIds = getSelectedTodoIds(form);

  if (todoIds.length === 0) {
    sendTodoPageForReturnTo(response, user, returnTo, "Select at least one item to move.");
    return;
  }

  const locationResult = validateLocationInput(form.get("folderId"), form.get("folderPath"));

  if (!locationResult.ok) {
    sendTodoPageForReturnTo(response, user, returnTo, locationResult.message);
    return;
  }

  for (const todoId of todoIds) {
    if (findItemForUser(todoId, user.id) === null) {
      sendHtml(response, 404, renderNotFoundPage());
      return;
    }
  }

  const folder = locationResult.value.folderPathSegments === null
    ? null
    : createFolderPath(user.id, locationResult.value.folderPathSegments);
  const folderId = folder?.id ?? locationResult.value.folderId;

  if (folderId !== null && findFolderForUser(folderId, user.id) === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  for (const todoId of todoIds) {
    moveTodoItemToLocation(todoId, user.id, folderId);
  }

  redirect(response, returnTo);
}

async function handleMoveVisibleTodo(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  todoId: string,
  direction: "up" | "down",
): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const returnTo = getReturnTo(form, "/");
  const context = getPageContext(user, makeLocalUrl(returnTo), null);
  moveVisibleTodoItem(user.id, todoId, direction, context.folder?.id ?? null, context.selectedStatusIds);
  redirect(response, returnTo);
}

async function handleReorderTodos(request: IncomingMessage, url: URL, response: ServerResponse, user: User): Promise<void> {
  const reorderResult = validateReorderInput(parseJson(await readRequestBody(request)));
  const folderId = url.searchParams.get("folderId");
  const folder = folderId === null || folderId.length === 0 ? null : findFolderForUser(folderId, user.id);

  if (!reorderResult.ok || (folderId !== null && folderId.length > 0 && folder === null)) {
    sendJson(response, 400, '{"ok":false}');
    return;
  }

  const statuses = listStatuses(user.id);
  const selectedStatusIds = getSelectedStatusIds(url, statuses);
  const wasReordered = reorderVisibleTodoItem(user.id, reorderResult.value, folder?.id ?? null, selectedStatusIds);
  sendJson(response, wasReordered ? 200 : 400, wasReordered ? '{"ok":true}' : '{"ok":false}');
}

function sendTodoPageForReturnTo(response: ServerResponse, user: User, returnTo: string, error: string): void {
  const url = makeLocalUrl(returnTo);
  const folderId = parseFolderRoute(url.pathname)?.id ?? null;
  const folder = folderId === null ? null : findFolderForUser(folderId, user.id);

  if (folderId !== null && folder === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  sendTodoPage(response, user, url, folder, error);
}

function sendTodoPage(response: ServerResponse, user: User, url: URL, folder: Folder | null, error: string | null): void {
  const context = getPageContext(user, url, folder);
  const folders = listFolders(user.id, context.selectedStatusIds);

  sendHtml(response, error === null ? 200 : 400, renderTodoPage({
    user,
    folder,
    folders,
    ancestors: folder === null ? [] : listFolderAncestors(folder.id, user.id),
    inboxCount: countInboxItems(user.id, context.selectedStatusIds),
    todos: listTodoItems(user.id, folder?.id ?? null, context.selectedStatusIds),
    statuses: context.statuses,
    selectedStatusIds: context.selectedStatusIds,
    returnTo: context.returnTo,
    error,
  }));
}

function sendWorkspaceViewResponse(response: ServerResponse, user: User, request: WorkspaceViewRequest): void {
  try {
    sendJsonValue(response, 200, { workspace: getWorkspaceView(user, request) });
  } catch (error) {
    if (error instanceof NotFoundApiError) {
      sendJsonValue(response, 404, { error: error.message });
      return;
    }

    throw error;
  }
}

function getWorkspaceView(user: User, request: WorkspaceViewRequest): WorkspaceView {
  const statuses = listStatuses(user.id);
  const selectedStatusIds = getSelectedStatusIdsFromIds(request.statusIds ?? [], statuses);
  const folder = request.folderId === null ? null : findFolderForUser(request.folderId, user.id);

  if (request.folderId !== null && folder === null) {
    throw new NotFoundApiError("Folder not found");
  }

  return {
    user: { email: user.email },
    folder,
    folders: listFolders(user.id, selectedStatusIds),
    ancestors: folder === null ? [] : listFolderAncestors(folder.id, user.id),
    inboxCount: countInboxItems(user.id, selectedStatusIds),
    todos: listTodoItems(user.id, folder?.id ?? null, selectedStatusIds),
    statuses,
    selectedStatusIds,
  };
}

function getPageContext(user: User, url: URL, folder: Folder | null): PageContext {
  const statuses = listStatuses(user.id);
  const selectedStatusIds = getSelectedStatusIds(url, statuses);
  return { folder, statuses, selectedStatusIds, returnTo: locationUrl(folder, selectedStatusIds) };
}

function getSelectedStatusIds(url: URL, statuses: ReadonlyArray<Status>): Array<string> {
  const validStatusIds = new Set(statuses.map((status) => status.id));
  const selectedStatusIds = [...new Set(url.searchParams.getAll("status").filter((id) => validStatusIds.has(id)))];
  return selectedStatusIds.length > 0
    ? selectedStatusIds
    : statuses.filter((status) => status.showInTodoView).map((status) => status.id);
}

function getSelectedStatusIdsFromIds(statusIds: ReadonlyArray<string>, statuses: ReadonlyArray<Status>): Array<string> {
  const validStatusIds = new Set(statuses.map((status) => status.id));
  const selectedStatusIds = uniqueStrings(statusIds).filter((id) => validStatusIds.has(id));
  return selectedStatusIds.length > 0
    ? selectedStatusIds
    : statuses.filter((status) => status.showInTodoView).map((status) => status.id);
}

function locationUrl(folder: Folder | null, statusIds: ReadonlyArray<string>): string {
  const pathname = folder === null ? "/" : `/folders/${encodeURIComponent(folder.id)}`;
  const query = new URLSearchParams();

  for (const statusId of statusIds) {
    query.append("status", statusId);
  }

  return `${pathname}?${query.toString()}`;
}

function itemLocationUrl(nodeId: string | null): string {
  return nodeId === null ? "/" : `/folders/${encodeURIComponent(nodeId)}`;
}

function getReturnTo(form: URLSearchParams, fallback: string): string {
  return getSafeReturnTo(form.get("returnTo"), fallback);
}

function getSelectedTodoIds(form: URLSearchParams): Array<string> {
  return [...new Set(form.getAll("itemId").map((id) => id.trim()).filter((id) => id.length > 0))];
}

function parseApiViewPayload(value: unknown): ApiViewPayload {
  if (!isJsonRecord(value)) {
    return { folderId: null, statusIds: null };
  }

  return {
    folderId: getNullableStringField(value, "folderId"),
    statusIds: getStringArrayField(value, "statusIds"),
  };
}

function parseTodoPayload(value: unknown): TodoPayload {
  if (!isJsonRecord(value)) {
    return { title: null, body: null, folderId: null };
  }

  return {
    title: getNullableStringField(value, "title"),
    body: getNullableStringField(value, "body"),
    folderId: getNullableStringField(value, "folderId"),
  };
}

function parseLocationPayload(value: unknown): LocationPayload {
  if (!isJsonRecord(value)) {
    return { folderId: null, folderPath: null };
  }

  return {
    folderId: getNullableStringField(value, "folderId"),
    folderPath: getNullableStringField(value, "folderPath"),
  };
}

function parseBulkLocationPayload(value: unknown): BulkLocationPayload {
  const location = parseLocationPayload(value);

  if (!isJsonRecord(value)) {
    return { ...location, itemIds: [] };
  }

  return { ...location, itemIds: getStringArrayField(value, "itemIds") ?? [] };
}

function parseStatusPayload(value: unknown): StatusPayload {
  if (!isJsonRecord(value)) {
    return { statusId: null, note: null };
  }

  return {
    statusId: getNullableStringField(value, "statusId"),
    note: getNullableStringField(value, "note"),
  };
}

function parseFolderPathPayload(value: unknown): FolderPathPayload {
  if (!isJsonRecord(value)) {
    return { folderPath: null };
  }

  return { folderPath: getNullableStringField(value, "folderPath") };
}

function parseFolderNamePayload(value: unknown): FolderNamePayload {
  if (!isJsonRecord(value)) {
    return { name: null };
  }

  return { name: getNullableStringField(value, "name") };
}

function parseReorderPayload(value: unknown): ReorderPayload {
  if (!isJsonRecord(value)) {
    return {
      movedId: null,
      previousId: null,
      nextId: null,
      folderId: null,
      statusIds: null,
    };
  }

  return {
    movedId: getNullableStringField(value, "movedId"),
    previousId: getNullableStringField(value, "previousId"),
    nextId: getNullableStringField(value, "nextId"),
    folderId: getNullableStringField(value, "folderId"),
    statusIds: getStringArrayField(value, "statusIds"),
  };
}

function getApiLocationResult(value: unknown): ReturnType<typeof validateLocationInput> {
  const payload = parseLocationPayload(value);
  return validateLocationInput(payload.folderId, payload.folderPath);
}

function getNullableStringField(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getStringArrayField(record: JsonRecord, key: string): ReadonlyArray<string> | null {
  const value = record[key];

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return null;
  }

  return value;
}

function uniqueStrings(values: ReadonlyArray<string>): Array<string> {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSafeReturnTo(rawReturnTo: string | null, fallback: string): string {
  return rawReturnTo !== null && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
    ? rawReturnTo
    : fallback;
}

function makeLocalUrl(path: string): URL {
  return new URL(path, "http://local.todo");
}

async function authenticateRequest(request: IncomingMessage): Promise<AuthenticatedRequest | null> {
  const sessionToken = getCookie(request, SESSION_COOKIE_NAME);
  const user = await getUserForSessionToken(sessionToken);
  return sessionToken === null || user === null ? null : { user, sessionToken };
}

function parseFolderRoute(pathname: string): RouteParams | null {
  return parseResourceRoute(pathname, "folders", "view");
}

function parseTodoRoute(pathname: string): RouteParams | null {
  return parseResourceRoute(pathname, "todos", "update");
}

function parseApiResourceRoute(
  pathname: string,
  resource: string,
): { readonly id: string; readonly action: string | null } | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if ((segments.length !== 3 && segments.length !== 4) || segments[0] !== "api" || segments[1] !== resource) {
    return null;
  }

  const id = segments[2];

  if (id === undefined) {
    return null;
  }

  try {
    return { id: decodeURIComponent(id), action: segments[3] ?? null };
  } catch {
    return null;
  }
}

function parseResourceRoute(pathname: string, resource: string, defaultAction: string): RouteParams | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if ((segments.length !== 2 && segments.length !== 3) || segments[0] !== resource) {
    return null;
  }

  const id = segments[1];

  if (id === undefined) {
    return null;
  }

  try {
    return { id: decodeURIComponent(id), action: segments[2] ?? defaultAction };
  } catch {
    return null;
  }
}

function makeRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", getRequestBaseUrl(request));
}

function getRequestBaseUrl(request: IncomingMessage): string {
  const hostHeader = request.headers["host"];
  const host = typeof hostHeader === "string" ? hostHeader : `${getHost()}:${getPort().toString()}`;
  return `http://${host}`;
}

function getEffectiveBaseUrl(request: IncomingMessage): string {
  return (getPublicBaseUrl() ?? getRequestBaseUrl(request)).replace(/\/+$/u, "");
}

function getCookie(request: IncomingMessage, name: string): string | null {
  const cookieHeader = request.headers["cookie"];

  if (typeof cookieHeader !== "string") {
    return null;
  }

  const prefix = `${name}=`;
  const matchedCookie = cookieHeader.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
  return matchedCookie === undefined ? null : decodeURIComponent(matchedCookie.slice(prefix.length));
}

function getBearerToken(request: IncomingMessage): string | null {
  const authorizationHeader = request.headers["authorization"];

  if (typeof authorizationHeader !== "string") {
    return null;
  }

  return /^Bearer ([^\s]+)$/u.exec(authorizationHeader)?.[1] ?? null;
}

function shouldUseSecureCookies(request: IncomingMessage): boolean {
  return new URL(getEffectiveBaseUrl(request)).protocol === "https:";
}

function setSessionCookie(response: ServerResponse, sessionToken: string, useSecureCookies: boolean): void {
  response.setHeader("Set-Cookie", createSessionCookieValue(sessionToken, getSessionMaxAgeSeconds(), useSecureCookies));
}

function clearSessionCookie(response: ServerResponse, useSecureCookies: boolean): void {
  response.setHeader("Set-Cookie", createSessionCookieValue("", 0, useSecureCookies));
}

function createSessionCookieValue(sessionToken: string, maxAgeSeconds: number, useSecureCookies: boolean): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Max-Age=${maxAgeSeconds.toString()}; Path=/; HttpOnly; SameSite=Lax${useSecureCookies ? "; Secure" : ""}`;
}

function redirect(response: ServerResponse, location: string): void {
  response.statusCode = 303;
  response.setHeader("Location", location);
  response.end("");
}

async function serveWorkspaceShell(response: ServerResponse): Promise<boolean> {
  try {
    const html = await readFile(join(FRONTEND_DIST_DIR, "index.html"), "utf8");
    sendHtml(response, 200, html);
    return true;
  } catch {
    return false;
  }
}

async function serveBuiltAsset(url: URL, response: ServerResponse): Promise<void> {
  const assetPath = getSafeAssetPath(url.pathname);

  if (assetPath === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  try {
    const asset = await readFile(assetPath);
    response.statusCode = 200;
    response.setHeader("Content-Type", getAssetContentType(assetPath));
    response.end(asset);
  } catch {
    sendHtml(response, 404, renderNotFoundPage());
  }
}

function getSafeAssetPath(pathname: string): string | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2 || segments[0] !== "assets" || segments.some((segment) => segment === "..")) {
    return null;
  }

  return join(FRONTEND_DIST_DIR, ...segments);
}

function getAssetContentType(path: string): string {
  const extension = extname(path);

  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function sendJson(response: ServerResponse, statusCode: number, json: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(json);
}

function sendJsonValue(response: ServerResponse, statusCode: number, value: unknown): void {
  sendJson(response, statusCode, JSON.stringify(value));
}

function sendApiValidationError(response: ServerResponse, message: string): void {
  sendJsonValue(response, 400, { error: message });
}

function renderErrorPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

class RequestBodyTooLargeError extends Error {
  public constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

class NotFoundApiError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NotFoundApiError";
  }
}

async function readApiJsonBody(request: IncomingMessage): Promise<unknown> {
  try {
    return parseJson(await readRequestBody(request, MAX_API_REQUEST_BODY_BYTES));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return null;
    }

    throw error;
  }
}

function readRequestBody(request: IncomingMessage, maxBytes: number | null = null): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let body = "";
    let bodyBytes = 0;
    let isSettled = false;

    request.on("data", (chunk) => {
      if (isSettled) {
        return;
      }

      bodyBytes += chunk.byteLength;

      if (maxBytes !== null && bodyBytes > maxBytes) {
        isSettled = true;
        reject(new RequestBodyTooLargeError());
        return;
      }

      body += decoder.decode(chunk, { stream: true });
    });

    request.on("end", () => {
      if (!isSettled) {
        isSettled = true;
        resolve(body + decoder.decode());
      }
    });

    request.on("error", (error) => {
      if (!isSettled) {
        isSettled = true;
        reject(error);
      }
    });
  });
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
