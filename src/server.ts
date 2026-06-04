import { createServer } from "node:http";

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
import type { IncomingMessage, ServerResponse } from "node:http";

const SESSION_COOKIE_NAME = "todo_session";
const MAX_CAPTURE_REQUEST_BODY_BYTES = 64 * 1024;

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

  const authenticatedRequest = await authenticateRequest(request);

  if (authenticatedRequest === null) {
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

  if (method === "GET" && url.pathname === "/") {
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

function renderErrorPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

class RequestBodyTooLargeError extends Error {
  public constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
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
