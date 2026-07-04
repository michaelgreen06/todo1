import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  parentId: "actions-root",
  name: "Project",
  kind: "folder",
  directItemCount: 1,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
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
  id: "reference-root",
  userId: "user-1",
  parentId: null,
  name: "Reference",
  kind: "folder",
  directItemCount: 0,
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
    window.history.replaceState(null, "", "/");
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
    expect(screen.getByRole("link", { name: "Prompts" })).toHaveAttribute("href", "/prompts");
    expect(requests[0]).toEqual({
      path: "/api/workspace/view",
      body: JSON.stringify({ view: "actions", folderId: "folder-1", statusIds: ["active", "completed"] }),
    });
    await waitFor(() => {
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 120 });
    });
  });

  it("uses folder route path before stored workspace state", async () => {
    window.sessionStorage.setItem("todo.workspace.folderId", "");
    window.history.replaceState(null, "", "/folders/folder-1");
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ path: input.toString(), body: typeof init?.body === "string" ? init.body : "" });
      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(requests[0]).toEqual({
      path: "/api/workspace/view",
      body: JSON.stringify({ view: "actions", folderId: "folder-1", statusIds: [] }),
    });
  });

  it("keeps browser path in sync when changing folders", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/folders/folder-1");
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const isInboxRequest = input.toString() === "/api/workspace/view"
        && typeof init?.body === "string"
        && init.body.includes("\"folderId\":null");
      return jsonResponse({ workspace: makeWorkspace({ folder: isInboxRequest ? null : projectFolder }) });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Workspace"), "inbox");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
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

  it("defaults to inbox navigation and hides the folder tree there", async () => {
    globalThis.fetch = async (): Promise<Response> => jsonResponse({
      workspace: makeWorkspace({
        view: "inbox",
        folder: null,
        todos: [{ ...inboxItem, nodeId: null }],
      }),
    });

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reference" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Project" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add folder path")).not.toBeInTheDocument();
  });

  it("filters move locations by selected kind and hides location for inbox", async () => {
    const user = userEvent.setup();
    const referenceChild: Folder = {
      ...projectFolder,
      id: "folder-2",
      parentId: "reference-root",
      name: "Garden",
    };

    globalThis.fetch = async (): Promise<Response> => jsonResponse({
      workspace: makeWorkspace({
        folders: [actionsRoot, referenceRoot, projectFolder, referenceChild],
      }),
    });

    render(<WorkspaceApp />);

    expect(await screen.findByText("Call client")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move" }));

    const locationSelect = screen.getByLabelText("Existing location");
    expect(locationSelect).toBeInTheDocument();
    expect(within(locationSelect).getByRole("option", { name: "Actions" })).toBeInTheDocument();
    expect(within(locationSelect).getByRole("option", { name: "Project" })).toBeInTheDocument();
    expect(within(locationSelect).queryByRole("option", { name: "Reference" })).not.toBeInTheDocument();
    expect(within(locationSelect).queryByRole("option", { name: "Garden" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "reference");
    const referenceLocationSelect = screen.getByLabelText("Existing location");
    expect(within(referenceLocationSelect).getByRole("option", { name: "Reference" })).toBeInTheDocument();
    expect(within(referenceLocationSelect).getByRole("option", { name: "Garden" })).toBeInTheDocument();
    expect(within(referenceLocationSelect).queryByRole("option", { name: "Project" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "inbox");
    expect(screen.queryByLabelText("Existing location")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/create new location/i)).not.toBeInTheDocument();
  });

  it("defaults add item location to inbox when opened from inbox", async () => {
    const user = userEvent.setup();
    globalThis.fetch = async (): Promise<Response> => jsonResponse({
      workspace: makeWorkspace({ view: "inbox", folder: null }),
    });

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByLabelText("Kind")).toHaveValue("inbox");
    expect(screen.queryByLabelText("Existing location")).not.toBeInTheDocument();
  });

  it("defaults add item location to the current nested folder", async () => {
    const user = userEvent.setup();
    const nestedFolder: Folder = {
      ...projectFolder,
      id: "folder-2",
      parentId: "folder-1",
      name: "Cora",
    };
    globalThis.fetch = async (): Promise<Response> => jsonResponse({
      workspace: makeWorkspace({
        view: "actions",
        folder: nestedFolder,
        folders: [actionsRoot, referenceRoot, projectFolder, nestedFolder],
      }),
    });

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Cora" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(screen.getByLabelText("Kind")).toHaveValue("actions");
    expect(screen.getByLabelText("Existing location")).toHaveValue("folder-2");
  });

  it("filters add item locations by selected kind", async () => {
    const user = userEvent.setup();
    const referenceChild: Folder = {
      ...projectFolder,
      id: "folder-2",
      parentId: "reference-root",
      name: "Garden",
    };

    globalThis.fetch = async (): Promise<Response> => jsonResponse({
      workspace: makeWorkspace({
        folders: [actionsRoot, referenceRoot, projectFolder, referenceChild],
      }),
    });

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));

    const locationSelect = screen.getByLabelText("Existing location");
    expect(within(locationSelect).getByRole("option", { name: "Actions" })).toBeInTheDocument();
    expect(within(locationSelect).getByRole("option", { name: "Project" })).toBeInTheDocument();
    expect(within(locationSelect).queryByRole("option", { name: "Garden" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Kind"), "reference");
    const referenceLocationSelect = screen.getByLabelText("Existing location");
    expect(within(referenceLocationSelect).getByRole("option", { name: "Reference" })).toBeInTheDocument();
    expect(within(referenceLocationSelect).getByRole("option", { name: "Garden" })).toBeInTheDocument();
    expect(within(referenceLocationSelect).queryByRole("option", { name: "Project" })).not.toBeInTheDocument();
  });

  it("submits add item with the selected existing location", async () => {
    const user = userEvent.setup();
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = input.toString();
      requests.push({ path, body: typeof init?.body === "string" ? init.body : "" });

      if (path === "/api/todos") {
        return jsonResponse({ item: { ...inboxItem, id: "created-1", body: "Created body" } }, 201);
      }

      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Description"), "Created body");
    await user.click(screen.getByRole("button", { name: "Add todo" }));

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: "/api/todos",
        body: JSON.stringify({
          title: "",
          body: "Created body",
          view: "actions",
          folderId: "folder-1",
          folderPath: "",
        }),
      });
    });
  });

  it("submits add item with a new location path", async () => {
    const user = userEvent.setup();
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = input.toString();
      requests.push({ path, body: typeof init?.body === "string" ? init.body : "" });

      if (path === "/api/todos") {
        return jsonResponse({ item: { ...inboxItem, id: "created-2", body: "Created body" } }, 201);
      }

      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.type(screen.getByLabelText("Description"), "Created body");
    await user.type(screen.getByLabelText(/create new location/i), "Next / Later");
    await user.click(screen.getByRole("button", { name: "Add todo" }));

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: "/api/todos",
        body: JSON.stringify({
          title: "",
          body: "Created body",
          view: "actions",
          folderId: "folder-1",
          folderPath: "Next / Later",
        }),
      });
    });
  });

  it("clears stale folder form state before opening create item dialog", async () => {
    const user = userEvent.setup();
    let folderCreateAttemptCount = 0;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const path = input.toString();

      if (path === "/api/folders") {
        folderCreateAttemptCount += 1;
        return jsonResponse({ error: "Folder create failed" }, 500);
      }

      return jsonResponse({ workspace: makeWorkspace() });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Add folder path"), "Project / New");
    await user.click(screen.getByRole("button", { name: "Add folder" }));
    expect(await screen.findByText("Folder create failed")).toBeInTheDocument();
    expect(folderCreateAttemptCount).toBe(1);

    await user.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByRole("heading", { name: "Add item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add todo" })).toBeEnabled();
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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Temporary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText(/Title/u));
    await user.type(screen.getByLabelText(/Title/u), "Edited title");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Edited body");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByDisplayValue("Edited title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Edited body")).toBeInTheDocument();
    expect(requests).toContain("PATCH /api/todos/todo-1");
  });

  it("restores autosaved inline edit drafts after remounting the page", async () => {
    const user = userEvent.setup();
    globalThis.fetch = async (): Promise<Response> => jsonResponse({ workspace: makeWorkspace() });

    const { unmount } = render(<WorkspaceApp />);

    expect(await screen.findByText("Call client")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText(/Title/u));
    await user.type(screen.getByLabelText(/Title/u), "Recovered title");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Recovered body");

    unmount();
    render(<WorkspaceApp />);

    expect(await screen.findByText("Call client")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("Recovered title")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Recovered body")).toBeInTheDocument();
  });

  it("warns before changing folders with unsaved inline edits", async () => {
    const user = userEvent.setup();
    globalThis.fetch = async (): Promise<Response> => jsonResponse({ workspace: makeWorkspace() });

    render(<WorkspaceApp />);

    expect(await screen.findByText("Call client")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText(/Title/u), " changed");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: /Inbox/u }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/actions/folders/folder-1");
    expect(screen.getByDisplayValue("Call client changed")).toBeInTheDocument();
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

  it("changes selected item statuses with a separate note for each item", async () => {
    const user = userEvent.setup();
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = input.toString();
      requests.push({ path, body: typeof init?.body === "string" ? init.body : "" });

      if (path.endsWith("/status")) {
        return jsonResponse({ item: { ...inboxItem, statusId: "completed", statusName: "Completed", statusCategory: "completed" } });
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });
    };

    render(<WorkspaceApp />);

    expect(await screen.findByRole("heading", { name: "Project" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select all"));
    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(screen.getByRole("heading", { name: "Change selected statuses" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    await user.click(screen.getByRole("button", { name: "Continue to notes" }));

    expect(screen.getByRole("heading", { name: "Note for item 1 of 2" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Note/u), "First note");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("heading", { name: "Note for item 2 of 2" })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Note/u), "Second note");
    await user.click(screen.getByRole("button", { name: "Save statuses" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(requests).toContainEqual({
      path: "/api/todos/todo-1/status",
      body: JSON.stringify({ statusId: "completed", note: "First note" }),
    });
    expect(requests).toContainEqual({
      path: "/api/todos/todo-2/status",
      body: JSON.stringify({ statusId: "completed", note: "Second note" }),
    });
  });

  it("renders drag handles as buttons", async () => {
    globalThis.fetch = async (): Promise<Response> => jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });

    render(<WorkspaceApp />);

    expect(await screen.findByRole("button", { name: "Drag to reorder Call client" })).toHaveClass("drag-handle");
    expect(screen.getByRole("button", { name: "Drag to reorder Draft memo" })).toHaveClass("drag-handle");
  });

  it("reorders items locally during pointer drag without calling the reorder API", async () => {
    const requests: Array<string> = [];
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(input.toString());
      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });
    };

    render(<WorkspaceApp />);

    const grip = await screen.findByRole("button", { name: "Drag to reorder Call client" });
    setTodoCardRects();
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: "mouse", clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientY: 200 });

    expect(visibleTodoTitles()).toEqual(["Draft memo", "Call client"]);
    expect(requests).not.toContain("/api/todos/reorder");
  });

  it("persists pointer drag reorder with surrounding item ids on drop", async () => {
    const requests: Array<{ readonly path: string; readonly body: string }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = input.toString();
      requests.push({ path, body: typeof init?.body === "string" ? init.body : "" });

      if (path === "/api/todos/reorder") {
        return jsonResponse({ workspace: makeWorkspace({ todos: [secondItem, inboxItem] }) });
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });
    };

    render(<WorkspaceApp />);

    const grip = await screen.findByRole("button", { name: "Drag to reorder Call client" });
    setTodoCardRects();
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: "mouse", clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientY: 200 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: "/api/todos/reorder",
        body: JSON.stringify({
          view: "actions",
          folderId: "folder-1",
          statusIds: ["active"],
          movedId: "todo-1",
          previousId: "todo-2",
          nextId: null,
        }),
      });
    });
    expect(visibleTodoTitles()).toEqual(["Draft memo", "Call client"]);
  });

  it("reloads confirmed server order after failed pointer drag reorder", async () => {
    const requests: Array<string> = [];
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const path = input.toString();
      requests.push(path);

      if (path === "/api/todos/reorder") {
        return jsonResponse({ error: "Rank conflict" }, 409);
      }

      return jsonResponse({ workspace: makeWorkspace({ todos: [inboxItem, secondItem] }) });
    };

    render(<WorkspaceApp />);

    const grip = await screen.findByRole("button", { name: "Drag to reorder Call client" });
    setTodoCardRects();
    fireEvent.pointerDown(grip, { pointerId: 1, pointerType: "mouse", clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientY: 200 });
    await waitFor(() => {
      expect(visibleTodoTitles()).toEqual(["Draft memo", "Call client"]);
    });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" });

    expect(visibleTodoTitles()).toEqual(["Draft memo", "Call client"]);
    await waitFor(() => {
      expect(visibleTodoTitles()).toEqual(["Call client", "Draft memo"]);
    });
    expect(requests.lastIndexOf("/api/workspace/view")).toBeGreaterThan(requests.indexOf("/api/todos/reorder"));
    expect(screen.getByText("Rank conflict")).toBeInTheDocument();
  });

  it("rejects invalid API responses", () => {
    expect(() => validateWorkspaceResponse({ nope: true })).toThrow("Invalid workspace response.");
  });
});

function makeWorkspace(overrides: {
  readonly view?: WorkspaceView["view"];
  readonly folder?: Folder | null;
  readonly folders?: ReadonlyArray<Folder>;
  readonly todos?: ReadonlyArray<TodoItem>;
  readonly selectedStatusIds?: ReadonlyArray<string>;
} = {}): WorkspaceView {
  const folder = overrides.folder === undefined ? projectFolder : overrides.folder;
  const view = overrides.view ?? (folder === null ? "inbox" : "actions");

  return {
    view,
    user: { email: "test@example.com" },
    roots: {
      actions: actionsRoot,
      reference: referenceRoot,
    },
    folder,
    folders: overrides.folders ?? [actionsRoot, referenceRoot, projectFolder],
    ancestors: folder === null
      ? []
      : (folder.id === actionsRoot.id || folder.id === referenceRoot.id
        ? [folder]
        : [actionsRoot, projectFolder]),
    inboxCount: 0,
    todos: overrides.todos ?? [inboxItem],
    statuses: [activeStatus, completedStatus],
    selectedStatusIds: overrides.selectedStatusIds ?? ["active"],
  };
}

function visibleTodoTitles(): ReadonlyArray<string> {
  return Array.from(document.querySelectorAll<HTMLElement>("h2[id^='todo-'][id$='-heading']")).map((heading) => heading.textContent ?? "");
}

function setTodoCardRects(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-todo-id]"));

  cards.forEach((card, index) => {
    const top = index * 100;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, 300, 80));
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
