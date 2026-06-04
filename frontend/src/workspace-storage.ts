import type { WorkspaceSelection } from "./workspace-types";

const FOLDER_KEY = "todo.workspace.folderId";
const STATUS_KEY = "todo.workspace.statusIds";
const SCROLL_KEY = "todo.workspace.scrollY";

export function readStoredSelection(): WorkspaceSelection {
  return {
    folderId: getStoredNullableString(FOLDER_KEY),
    statusIds: getStoredStringArray(STATUS_KEY),
  };
}

export function storeSelection(selection: WorkspaceSelection): void {
  window.sessionStorage.setItem(FOLDER_KEY, selection.folderId ?? "");
  window.sessionStorage.setItem(STATUS_KEY, JSON.stringify(selection.statusIds));
}

export function readStoredScrollY(): number {
  const value = window.sessionStorage.getItem(SCROLL_KEY);

  if (value === null) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function storeScrollY(scrollY: number): void {
  window.sessionStorage.setItem(SCROLL_KEY, Math.max(0, Math.round(scrollY)).toString());
}

function getStoredNullableString(key: string): string | null {
  const value = window.sessionStorage.getItem(key);
  return value === null || value.length === 0 ? null : value;
}

function getStoredStringArray(key: string): Array<string> {
  const value = window.sessionStorage.getItem(key);

  if (value === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}
