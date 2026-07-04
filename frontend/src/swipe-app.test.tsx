import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SwipeApp } from "./swipe-app";
import type { Folder, Status, TodoItem, WorkspaceView } from "./workspace-types";

const activeStatus: Status = {
  id: "active",
  userId: "user-1",
  name: "Active",
  category: "active",
  showInTodoView: true,
  isDefaultForNewItems: true,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
};

const completedStatus: Status = {
  ...activeStatus,
  id: "completed",
  name: "Completed",
  category: "completed",
  showInTodoView: false,
  isDefaultForNewItems: false,
};

const archivedStatus: Status = {
  ...activeStatus,
  id: "archived",
  name: "Archived",
  category: "archived",
  showInTodoView: false,
  isDefaultForNewItems: false,
};

const actionsRoot: Folder = {
  id: "actions-root",
  userId: "user-1",
  parentId: null,
  name: "Actions",
  kind: "folder",
  directItemCount: 0,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
};

const referenceRoot: Folder = {
  ...actionsRoot,
  id: "reference-root",
  name: "Reference",
};

const inboxItem: TodoItem = {
  id: "todo-1",
  userId: "user-1",
  nodeId: null,
  statusId: "active",
  statusName: "Active",
  statusCategory: "active",
  kind: "todo",
  title: "Call client",
  body: "Discuss launch plan",
  sourceCaptureId: null,
  statusChangedAt: "2026-06-04T00:00:00.000Z",
  todoRank: "a0",
  todoRankChangedAt: null,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
};

const secondItem: TodoItem = {
  ...inboxItem,
  id: "todo-2",
  title: "Draft memo",
  body: "Write memo body",
  todoRank: "a1",
};

describe("SwipeApp", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("loads the active inbox deck", async () => {
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });
    };

    render(<SwipeApp />);

    expect(await screen.findByRole("heading", { name: "Call client" })).toBeInTheDocument();
    expect(requests[0]).toEqual({
      path: "/api/workspace/view",
      body: JSON.stringify({ view: "inbox", folderId: null, statusIds: [] }),
    });
  });

  it("does not display placeholder titles for untitled notes", async () => {
    const untitledItem = {
      ...inboxItem,
      title: "Untitled note",
      body: "Use the whole card for this captured note.",
    };
    globalThis.fetch = async (): Promise<Response> => jsonResponse({ workspace: makeWorkspace({ todos: [untitledItem] }) });

    render(<SwipeApp />);

    expect(await screen.findByText("Use the whole card for this captured note.")).toBeInTheDocument();
    expect(screen.queryByText("Untitled note")).not.toBeInTheDocument();
    expect(screen.queryByText("Untitled task")).not.toBeInTheDocument();
  });

  it("archives the current card without a note on left action", async () => {
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    const user = userEvent.setup();
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });

      if (input.toString() === "/api/todos/todo-1/status") {
        return jsonResponse({ item: { ...inboxItem, statusId: "archived", statusName: "Archived", statusCategory: "archived" } });
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });
    };

    render(<SwipeApp />);

    await user.click(await screen.findByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Call client" })).not.toBeInTheDocument();
    });
    expect(requests).toContainEqual({
      path: "/api/todos/todo-1/status",
      body: JSON.stringify({ statusId: "archived", note: null }),
    });
  });

  it("completes the current card without a note on up action", async () => {
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    const user = userEvent.setup();
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });

      if (input.toString() === "/api/todos/todo-1/status") {
        return jsonResponse({ item: { ...inboxItem, statusId: "completed", statusName: "Completed", statusCategory: "completed" } });
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });
    };

    render(<SwipeApp />);

    await user.click(await screen.findByRole("button", { name: "Complete" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Call client" })).not.toBeInTheDocument();
    });
    expect(requests).toContainEqual({
      path: "/api/todos/todo-1/status",
      body: JSON.stringify({ statusId: "completed", note: null }),
    });
  });

  it("keeps the current card active and skips it in this browser tab", async () => {
    const requests: Array<string> = [];
    const user = userEvent.setup();
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(input.toString());
      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });
    };

    render(<SwipeApp />);

    await user.click(await screen.findByRole("button", { name: "Keep active" }));

    expect(await screen.findByRole("heading", { name: "Draft memo" })).toBeInTheDocument();
    expect(requests).not.toContain("/api/todos/todo-1/status");
    expect(window.sessionStorage.getItem("todo.swipe.skippedActiveIds")).toBe(JSON.stringify(["todo-1"]));
  });

  it("archives the current card on drag left", async () => {
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });

      if (input.toString() === "/api/todos/todo-1/status") {
        return jsonResponse({ item: { ...inboxItem, statusId: "archived", statusName: "Archived", statusCategory: "archived" } });
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });
    };

    render(<SwipeApp />);

    dragSurface(await screen.findByTestId("swipe-card-surface"), { x: -90, y: 20 });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Call client" })).not.toBeInTheDocument();
    });
    expect(requests).toContainEqual({
      path: "/api/todos/todo-1/status",
      body: JSON.stringify({ statusId: "archived", note: null }),
    });
  });

  it("keeps the current card active on drag right", async () => {
    const requests: Array<string> = [];
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(input.toString());
      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });
    };

    render(<SwipeApp />);

    dragSurface(await screen.findByTestId("swipe-card-surface"), { x: 120, y: 20 });

    expect(await screen.findByRole("heading", { name: "Draft memo" })).toBeInTheDocument();
    expect(requests).not.toContain("/api/todos/todo-1/status");
    expect(window.sessionStorage.getItem("todo.swipe.skippedActiveIds")).toBe(JSON.stringify(["todo-1"]));
  });

  it("completes the current card on drag up", async () => {
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });

      if (input.toString() === "/api/todos/todo-1/status") {
        return jsonResponse({ item: { ...inboxItem, statusId: "completed", statusName: "Completed", statusCategory: "completed" } });
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });
    };

    render(<SwipeApp />);

    dragSurface(await screen.findByTestId("swipe-card-surface"), { x: 20, y: -90 });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Call client" })).not.toBeInTheDocument();
    });
    expect(requests).toContainEqual({
      path: "/api/todos/todo-1/status",
      body: JSON.stringify({ statusId: "completed", note: null }),
    });
  });

  it("hides skipped active cards after refresh and restores them for a new session", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem("todo.swipe.skippedActiveIds", JSON.stringify(["todo-1"]));
    globalThis.fetch = async (): Promise<Response> => jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });

    render(<SwipeApp />);

    expect(await screen.findByText("No active inbox cards in this session.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start new session" }));

    expect(await screen.findByRole("heading", { name: "Call client" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("todo.swipe.skippedActiveIds")).toBe(JSON.stringify([]));
  });

  it("does not mutate or remove the card on down swipe", async () => {
    const requests: Array<string> = [];
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(input.toString());
      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem] }) });
    };

    render(<SwipeApp />);

    const surface = await screen.findByTestId("swipe-card-surface");
    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 140 });
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 140 });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Call client" })).toBeInTheDocument();
    });
    expect(requests).not.toContain("/api/todos/todo-1/status");
    expect(window.sessionStorage.getItem("todo.swipe.skippedActiveIds")).toBeNull();
  });
});

function dragSurface(surface: HTMLElement, movement: { readonly x: number; readonly y: number }): void {
  const startTouch = makeTouch(surface, { x: 20, y: 20 });
  const endTouch = makeTouch(surface, { x: 20 + movement.x, y: 20 + movement.y });

  fireEvent.touchStart(surface, {
    changedTouches: [startTouch],
    targetTouches: [startTouch],
    touches: [startTouch],
  });
  fireEvent.touchMove(surface, {
    changedTouches: [endTouch],
    targetTouches: [endTouch],
    touches: [endTouch],
  });
  fireEvent.touchEnd(surface, {
    changedTouches: [endTouch],
    targetTouches: [],
    touches: [],
  });
}

function makeTouch(target: EventTarget, point: { readonly x: number; readonly y: number }): Touch {
  return {
    clientX: point.x,
    clientY: point.y,
    force: 1,
    identifier: 1,
    pageX: point.x,
    pageY: point.y,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    screenX: point.x,
    screenY: point.y,
    target,
  };
}

function makeWorkspace(overrides: {
  readonly todos?: ReadonlyArray<TodoItem>;
  readonly statuses?: ReadonlyArray<Status>;
} = {}): WorkspaceView {
  return {
    view: "inbox",
    user: { email: "test@example.com" },
    roots: {
      actions: actionsRoot,
      reference: referenceRoot,
    },
    folder: null,
    folders: [actionsRoot, referenceRoot],
    ancestors: [],
    inboxCount: overrides.todos?.length ?? 1,
    todos: overrides.todos ?? [inboxItem],
    statuses: overrides.statuses ?? [activeStatus, completedStatus, archivedStatus],
    selectedStatusIds: ["active"],
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
