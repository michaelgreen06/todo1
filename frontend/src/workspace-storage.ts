import type { WorkspaceSelection } from "./workspace-types";

const FOLDER_KEY = "todo.workspace.folderId";
const STATUS_KEY = "todo.workspace.statusIds";
const SCROLL_KEY = "todo.workspace.scrollY";

export function readStoredSelection(): WorkspaceSelection {
  return {
    folderId: getUrlFolderId() ?? getStoredNullableString(FOLDER_KEY),
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

export function updateFolderUrl(folderId: string | null): void {
  const nextPath = folderId === null ? "/" : `/folders/${encodeURIComponent(folderId)}`;

  if (window.location.pathname !== nextPath) {
    window.history.pushState(null, "", nextPath);
  }
}

function getUrlFolderId(): string | null {
  const match = /^\/folders\/([^/]+)$/u.exec(window.location.pathname);

  if (match === null) {
    return null;
  }

  const [, encodedFolderId] = match;

  if (encodedFolderId === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(encodedFolderId);
  } catch {
    return null;
  }
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
