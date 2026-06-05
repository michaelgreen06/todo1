import { env } from "node:process";

const DEFAULT_DATABASE_PATH = "todo.sqlite";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

export function getTodoDatabasePath(): string {
  const configuredPath = env["TODO_DATABASE_PATH"];

  if (configuredPath === undefined) {
    return DEFAULT_DATABASE_PATH;
  }

  const databasePath = configuredPath.trim();

  if (databasePath.length === 0) {
    throw new Error("TODO_DATABASE_PATH must not be empty.");
  }

  return databasePath;
}

export function getHost(): string {
  const configuredHost = env["HOST"];

  if (configuredHost === undefined) {
    return DEFAULT_HOST;
  }

  const host = configuredHost.trim();

  if (host.length === 0) {
    throw new Error("HOST must not be empty.");
  }

  return host;
}

export function getPort(): number {
  const configuredPort = env["PORT"];

  if (configuredPort === undefined) {
    return DEFAULT_PORT;
  }

  const portText = configuredPort.trim();

  if (!/^[0-9]+$/u.test(portText)) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const port = Number.parseInt(portText, 10);

  if (port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export function getPublicBaseUrl(): string | null {
  const configuredBaseUrl = env["PUBLIC_BASE_URL"];

  if (configuredBaseUrl === undefined) {
    return null;
  }

  const baseUrl = configuredBaseUrl.trim();

  if (baseUrl.length === 0) {
    throw new Error("PUBLIC_BASE_URL must not be empty.");
  }

  const url = parsePublicBaseUrl(baseUrl);
  return normalizeBaseUrl(url);
}

export function getPlaudRailwayProjectId(): string {
  return requireNonEmptyEnv("PLAUD_RAILWAY_PROJECT_ID");
}

export function getPlaudRailwayEnvironmentId(): string {
  return requireNonEmptyEnv("PLAUD_RAILWAY_ENVIRONMENT_ID");
}

export function getPlaudRailwayServiceId(): string {
  return requireNonEmptyEnv("PLAUD_RAILWAY_SERVICE_ID");
}

export function getPlaudRailwayProjectToken(): string {
  return requireNonEmptyEnv("PLAUD_RAILWAY_API_TOKEN");
}

function parsePublicBaseUrl(baseUrl: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid absolute http or https URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use http or https.");
  }

  if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
    throw new Error("PUBLIC_BASE_URL must not include username or password.");
  }

  if (parsedUrl.search.length > 0 || parsedUrl.hash.length > 0) {
    throw new Error("PUBLIC_BASE_URL must not include query parameters or a fragment.");
  }

  if (parsedUrl.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL must not include a path.");
  }

  return parsedUrl;
}

function normalizeBaseUrl(url: URL): string {
  return url.origin;
}

function requireNonEmptyEnv(name: string): string {
  const configuredValue = env[name];

  if (configuredValue === undefined) {
    throw new Error(`${name} must be set.`);
  }

  const value = configuredValue.trim();

  if (value.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }

  return value;
}
