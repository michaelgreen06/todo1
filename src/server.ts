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
  createTodoItem,
  findItemForUser,
  initializeDatabase,
  listItemStatusChanges,
  listStatuses,
  listVisibleTodoItems,
  moveVisibleTodoItem,
  reorderVisibleTodoItem,
  updateTodoItem,
} from "./db.js";
import {
  renderEditPage,
  renderLoginPage,
  renderNotFoundPage,
  renderTodoPage,
} from "./html.js";
import {
  validateEmail,
  validateReorderInput,
  validateStatusChangeInput,
  validateTodoInput,
} from "./validation.js";
import type { User } from "./db.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const PORT = 3000;
const SESSION_COOKIE_NAME = "todo_session";

type AuthenticatedRequest = {
  readonly user: User;
  readonly sessionToken: string;
};

type RouteParams = {
  readonly id: string;
  readonly action: string;
};

export function startServer(): void {
  initializeDatabase();

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Todo MVP running at http://localhost:${PORT.toString()}`);
  });
}

export async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
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

  if (method === "GET" && url.pathname === "/login") {
    sendHtml(
      response,
      200,
      renderLoginPage({
        message: url.searchParams.get("sent") === "1" ? "Magic link created. Check the terminal." : null,
        error: null,
      }),
    );
    return;
  }

  if (method === "POST" && url.pathname === "/login") {
    await handleLogin(request, response);
    return;
  }

  if (method === "GET" && url.pathname === "/auth/magic") {
    await handleMagicAuth(url, response);
    return;
  }

  const authenticatedRequest = await authenticateRequest(request);

  if (authenticatedRequest === null) {
    redirect(response, "/login");
    return;
  }

  if (method === "POST" && url.pathname === "/logout") {
    await revokeSessionToken(authenticatedRequest.sessionToken);
    clearSessionCookie(response);
    redirect(response, "/login");
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    sendTodoPage(response, authenticatedRequest.user, null);
    return;
  }

  if (method === "POST" && url.pathname === "/todos") {
    await handleCreateTodo(request, response, authenticatedRequest.user);
    return;
  }

  if (method === "POST" && url.pathname === "/todos/reorder") {
    await handleReorderTodos(request, response, authenticatedRequest.user);
    return;
  }

  const todoRoute = parseTodoRoute(url.pathname);

  if (todoRoute === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  if (method === "GET" && todoRoute.action === "edit") {
    handleEditPage(response, authenticatedRequest.user, todoRoute.id);
    return;
  }

  if (method === "POST" && todoRoute.action === "update") {
    await handleUpdateTodo(request, response, authenticatedRequest.user, todoRoute.id);
    return;
  }

  if (method === "POST" && todoRoute.action === "status") {
    await handleChangeStatus(request, response, authenticatedRequest.user, todoRoute.id);
    return;
  }

  if (method === "POST" && todoRoute.action === "move-up") {
    moveVisibleTodoItem(authenticatedRequest.user.id, todoRoute.id, "up");
    redirect(response, "/");
    return;
  }

  if (method === "POST" && todoRoute.action === "move-down") {
    moveVisibleTodoItem(authenticatedRequest.user.id, todoRoute.id, "down");
    redirect(response, "/");
    return;
  }

  sendHtml(response, 404, renderNotFoundPage());
}

async function handleLogin(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const emailResult = validateEmail(form.get("email"));

  if (!emailResult.ok) {
    sendHtml(response, 400, renderLoginPage({ message: null, error: emailResult.message }));
    return;
  }

  const magicLink = await createMagicLoginLink(emailResult.value, getBaseUrl(request));
  console.log(`Magic login link for ${magicLink.user.email}: ${magicLink.loginUrl}`);
  redirect(response, "/login?sent=1");
}

async function handleMagicAuth(url: URL, response: ServerResponse): Promise<void> {
  const consumedToken = await consumeMagicToken(url.searchParams.get("token"));

  if (consumedToken === null) {
    sendHtml(
      response,
      400,
      renderLoginPage({ message: null, error: "This magic link is invalid or expired." }),
    );
    return;
  }

  setSessionCookie(response, consumedToken.sessionToken);
  redirect(response, "/");
}

async function handleCreateTodo(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const todoResult = validateTodoInput(form.get("title"), form.get("body"));

  if (!todoResult.ok) {
    sendTodoPage(response, user, todoResult.message);
    return;
  }

  createTodoItem(user.id, todoResult.value.title, todoResult.value.body);
  redirect(response, "/");
}

function handleEditPage(response: ServerResponse, user: User, todoId: string): void {
  const todo = findItemForUser(todoId, user.id);

  if (todo === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  sendHtml(response, 200, renderEditPage({
    todo,
    history: listItemStatusChanges(todo.id, user.id),
    error: null,
  }));
}

async function handleUpdateTodo(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  todoId: string,
): Promise<void> {
  const todo = findItemForUser(todoId, user.id);

  if (todo === null) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  const form = new URLSearchParams(await readRequestBody(request));
  const todoResult = validateTodoInput(form.get("title"), form.get("body"));

  if (!todoResult.ok) {
    sendHtml(response, 400, renderEditPage({
      todo,
      history: listItemStatusChanges(todo.id, user.id),
      error: todoResult.message,
    }));
    return;
  }

  updateTodoItem(todoId, user.id, todoResult.value.title, todoResult.value.body);
  redirect(response, "/");
}

async function handleChangeStatus(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
  todoId: string,
): Promise<void> {
  const form = new URLSearchParams(await readRequestBody(request));
  const statusResult = validateStatusChangeInput(form.get("statusId"), form.get("note"));

  if (!statusResult.ok) {
    sendTodoPage(response, user, statusResult.message);
    return;
  }

  const didChange = changeItemStatus(
    todoId,
    user.id,
    statusResult.value.statusId,
    statusResult.value.note,
  );

  if (!didChange) {
    sendHtml(response, 404, renderNotFoundPage());
    return;
  }

  redirect(response, "/");
}

async function handleReorderTodos(
  request: IncomingMessage,
  response: ServerResponse,
  user: User,
): Promise<void> {
  const parsedBody = parseJson(await readRequestBody(request));
  const reorderResult = validateReorderInput(parsedBody);

  if (!reorderResult.ok) {
    sendJson(response, 400, '{"ok":false}');
    return;
  }

  const wasReordered = reorderVisibleTodoItem(user.id, reorderResult.value);

  if (!wasReordered) {
    sendJson(response, 400, '{"ok":false}');
    return;
  }

  sendJson(response, 200, '{"ok":true}');
}

function sendTodoPage(response: ServerResponse, user: User, error: string | null): void {
  sendHtml(
    response,
    error === null ? 200 : 400,
    renderTodoPage({
      user,
      todos: listVisibleTodoItems(user.id),
      statuses: listStatuses(user.id),
      error,
    }),
  );
}

async function authenticateRequest(
  request: IncomingMessage,
): Promise<AuthenticatedRequest | null> {
  const sessionToken = getCookie(request, SESSION_COOKIE_NAME);
  const user = await getUserForSessionToken(sessionToken);

  if (sessionToken === null || user === null) {
    return null;
  }

  return { user, sessionToken };
}

function parseTodoRoute(pathname: string): RouteParams | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 2 && segments[0] === "todos") {
    const id = segments[1];

    if (id === undefined) {
      return null;
    }

    return { id: decodeURIComponent(id), action: "update" };
  }

  if (segments.length !== 3 || segments[0] !== "todos") {
    return null;
  }

  const id = segments[1];
  const action = segments[2];

  if (id === undefined || action === undefined) {
    return null;
  }

  return { id: decodeURIComponent(id), action };
}

function makeRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", getBaseUrl(request));
}

function getBaseUrl(request: IncomingMessage): string {
  const hostHeader = request.headers["host"];
  const host = typeof hostHeader === "string" ? hostHeader : `localhost:${PORT.toString()}`;
  return `http://${host}`;
}

function getCookie(request: IncomingMessage, name: string): string | null {
  const cookieHeader = request.headers["cookie"];

  if (typeof cookieHeader !== "string") {
    return null;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const matchedCookie = cookies.find((cookie) => cookie.startsWith(prefix));

  if (matchedCookie === undefined) {
    return null;
  }

  return decodeURIComponent(matchedCookie.slice(prefix.length));
}

function setSessionCookie(response: ServerResponse, sessionToken: string): void {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Max-Age=${getSessionMaxAgeSeconds().toString()}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function clearSessionCookie(response: ServerResponse): void {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
  );
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

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let body = "";

    request.on("data", (chunk) => {
      body += decoder.decode(chunk, { stream: true });
    });

    request.on("end", () => {
      resolve(body + decoder.decode());
    });

    request.on("error", (error) => {
      reject(error);
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
