import type { WorkspaceSelection, WorkspaceViewMode } from "./workspace-types";

const VIEW_KEY = "todo.workspace.view";
const FOLDER_KEY = "todo.workspace.folderId";
const STATUS_KEY = "todo.workspace.statusIds";
const SCROLL_KEY = "todo.workspace.scrollY";

export function readStoredSelection(): WorkspaceSelection {
  const routeSelection = getUrlSelection();

  return {
    view: routeSelection?.view ?? getStoredView(),
    folderId: routeSelection?.folderId ?? getStoredNullableString(FOLDER_KEY),
    statusIds: getStoredStringArray(STATUS_KEY),
  };
}

export function storeSelection(selection: WorkspaceSelection): void {
  window.sessionStorage.setItem(VIEW_KEY, selection.view);
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

export function updateFolderUrl(selection: WorkspaceSelection): void {
  const nextPath = getSelectionPath(selection);

  if (window.location.pathname !== nextPath) {
    window.history.pushState(null, "", nextPath);
  }
}

function getUrlSelection(): WorkspaceSelection | null {
  if (window.location.pathname === "/") {
    return null;
  }

  const rootMatch = /^\/(actions|reference)$/u.exec(window.location.pathname);

  if (rootMatch !== null) {
    const [, view] = rootMatch;
    return view === undefined ? null : { view: parseWorkspaceViewMode(view), folderId: null, statusIds: [] };
  }

  const folderMatch = /^\/(actions|reference)\/folders\/([^/]+)$/u.exec(window.location.pathname);

  if (folderMatch !== null) {
    const [, rawView, encodedFolderId] = folderMatch;

    if (rawView === undefined || encodedFolderId === undefined) {
      return null;
    }

    try {
      return {
        view: parseWorkspaceViewMode(rawView),
        folderId: decodeURIComponent(encodedFolderId),
        statusIds: [],
      };
    } catch {
      return null;
    }
  }

  const legacyMatch = /^\/folders\/([^/]+)$/u.exec(window.location.pathname);

  if (legacyMatch === null) {
    return null;
  }

  const [, encodedFolderId] = legacyMatch;

  if (encodedFolderId === undefined) {
    return null;
  }

  try {
    return {
      view: "actions",
      folderId: decodeURIComponent(encodedFolderId),
      statusIds: [],
    };
  } catch {
    return null;
  }
}

function getStoredView(): WorkspaceViewMode {
  const value = window.sessionStorage.getItem(VIEW_KEY);

  if (value === "actions" || value === "reference") {
    return value;
  }

  return getStoredNullableString(FOLDER_KEY) === null ? "inbox" : "actions";
}

function getSelectionPath(selection: WorkspaceSelection): string {
  if (selection.view === "inbox") {
    return "/";
  }

  if (selection.folderId === null) {
    return `/${selection.view}`;
  }

  return `/${selection.view}/folders/${encodeURIComponent(selection.folderId)}`;
}

function parseWorkspaceViewMode(value: string): WorkspaceViewMode {
  return value === "actions" || value === "reference" ? value : "inbox";
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
