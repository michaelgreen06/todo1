import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateWorkspaceResponse } from "./workspace-api";
import { WorkspaceApp } from "./workspace-app";
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

const projectFolder: Folder = {
  id: "folder-1",
  userId: "user-1",
  parentId: null,
  name: "Project",
  kind: "folder",
  directItemCount: 1,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
};

const inboxItem: TodoItem = {
  id: "todo-1",
  userId: "user-1",
  nodeId: "folder-1",
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

describe("WorkspaceApp", () => {
  const originalFetch = globalThis.fetch;
  const originalScrollTo = window.scrollTo;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.scrollTo = originalScrollTo;
    vi.restoreAllMocks();
  });

  it("restores selected workspace state from sessionStorage", async () => {
    window.sessionStorage.setItem("todo.workspace.folderId", "folder-1");
    window.sessionStorage.setItem("todo.workspace.statusIds", JSON.stringify(["active", "completed"]));
    window.sessionStorage.setItem("todo.workspace.scrollY", "120");
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(requests[0]).toEqual({
      path: "/api/workspace/view",
      body: JSON.stringify({ folderId: "folder-1", statusIds: ["active", "completed"] }),
    });
    await waitFor(() => {
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 120 });
    });
  });

  it("tracks selected folder, status filters, and bulk dialog state", async () => {
    const user = userEvent.setup();
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const statusIds = input.toString() === "/api/workspace/view" && typeof init?.body === "string" && init.body.includes("completed")
        ? ["active", "completed"]
        : ["active"];
      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem], selectedStatusIds: statusIds }) });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select all"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move selected" }));
    expect(screen.getByRole("heading", { name: "Move selected items" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByLabelText("Completed"));
    expect(window.sessionStorage.getItem("todo.workspace.statusIds")).toContain("completed");
  });

  it("opens, cancels, and saves inline card edits", async () => {
    const user = userEvent.setup();
    const updatedItem = { ...inboxItem, title: "Edited title", body: "Edited body" };
    const requests: Array<string> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(`${init?.method ?? "GET"} ${input.toString()}`);

      if (input.toString() === "/api/todos/todo-1") {
        return jsonResponse({ item: updatedItem });
      }

      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByText("Call client")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText(/Title/u));
    await user.type(screen.getByLabelText(/Title/u), "Temporary");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByDisplayValue("Temporary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText(/Title/u));
    await user.type(screen.getByLabelText(/Title/u), "Edited title");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Edited body");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Edited title")).toBeInTheDocument();
    expect(requests).toContain("PATCH /api/todos/todo-1");
  });

  it("saves status through API without resetting the selected view", async () => {
    const user = userEvent.setup();
    const requests: Array<string> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(`${init?.method ?? "GET"} ${input.toString()}`);

      if (input.toString() === "/api/todos/todo-1/status") {
        return jsonResponse({ item: { ...inboxItem, statusId: "completed", statusName: "Completed", statusCategory: "completed" } });
      }

      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    await user.click(screen.getByRole("button", { name: "Save status" }));

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(requests).toContain("POST /api/todos/todo-1/status");
    expect(requests).toContain("POST /api/workspace/view");
  });

  it("rejects invalid API responses", () => {
    expect(() => validateWorkspaceResponse({ nope: true })).toThrow("Invalid workspace response.");
  });
});

function makeWorkspace(overrides: {
  readonly todos?: ReadonlyArray<TodoItem>;
  readonly selectedStatusIds?: ReadonlyArray<string>;
} = {}): WorkspaceView {
  return {
    user: { email: "test@example.com" },
    folder: projectFolder,
    folders: [projectFolder],
    ancestors: [projectFolder],
    inboxCount: 0,
    todos: overrides.todos ?? [inboxItem],
    statuses: [activeStatus, completedStatus],
    selectedStatusIds: overrides.selectedStatusIds ?? ["active"],
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
