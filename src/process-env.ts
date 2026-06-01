import { env } from "node:process";

const DEFAULT_DATABASE_PATH = "todo.sqlite";

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
