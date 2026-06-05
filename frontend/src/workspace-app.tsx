import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from "react";

import {
  bulkMove,
  changeStatus,
  createFolder,
  createTodo,
  deleteFolder,
  loadDefaultWorkspace,
  loadWorkspace,
  moveTodo,
  renameFolder,
  reorderTodos,
  triggerPlaudSync,
  updateTodo,
} from "./workspace-api";
import {
  readStoredScrollY,
  readStoredSelection,
  storeScrollY,
  storeSelection,
  updateFolderUrl,
} from "./workspace-storage";
import type { DialogState, EditDraft, Folder, Status, TodoItem, WorkspaceSelection, WorkspaceView } from "./workspace-types";

type FormStatus = {
  readonly error: string | null;
  readonly isSaving: boolean;
};

type PendingTouchDrag = {
  readonly item: TodoItem;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly handle: HTMLButtonElement;
};

const emptyFormStatus: FormStatus = { error: null, isSaving: false };
const touchDragDelayMs = 350;
const touchDragMoveTolerancePx = 8;

function todoIdsEqual(left: ReadonlyArray<TodoItem>, right: ReadonlyArray<TodoItem>): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

function reorderByPointerY(order: ReadonlyArray<TodoItem>, movedId: string, list: HTMLUListElement, clientY: number): ReadonlyArray<TodoItem> | null {
  const movedItem = order.find((item) => item.id === movedId);

  if (movedItem === undefined) {
    return null;
  }

  const withoutMoved = order.filter((item) => item.id !== movedId);
  const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-todo-id]"));
  let insertionIndex = withoutMoved.length;

  for (const card of cards) {
    const itemId = card.dataset["todoId"];

    if (itemId === undefined || itemId === movedId) {
      continue;
    }

    const candidateIndex = withoutMoved.findIndex((item) => item.id === itemId);

    if (candidateIndex === -1) {
      continue;
    }

    const rect = card.getBoundingClientRect();

    if (clientY < rect.top + (rect.height / 2)) {
      insertionIndex = candidateIndex;
      break;
    }
  }

  return [
    ...withoutMoved.slice(0, insertionIndex),
    movedItem,
    ...withoutMoved.slice(insertionIndex),
  ];
}

export function WorkspaceApp(): ReactElement {
  const [selection, setSelection] = useState<WorkspaceSelection>(() => readStoredSelection());
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlyArray<string>>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [expandedItemIds, setExpandedItemIds] = useState<ReadonlyArray<string>>([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>({ title: "", body: "", folderId: "" });
  const [formStatus, setFormStatus] = useState<FormStatus>(emptyFormStatus);
  const [isTriggeringPlaudSync, setIsTriggeringPlaudSync] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOrder, setDragOrder] = useState<ReadonlyArray<TodoItem> | null>(null);
  const restoredScrollRef = useRef(false);
  const workspaceRef = useRef<WorkspaceView | null>(null);
  const selectionRef = useRef<WorkspaceSelection>(selection);
  const dragContainerRef = useRef<HTMLUListElement | null>(null);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);
  const draggedItemIdRef = useRef<string | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOriginalOrderRef = useRef<ReadonlyArray<TodoItem>>([]);
  const dragCurrentOrderRef = useRef<ReadonlyArray<TodoItem>>([]);
  const touchLongPressTimerRef = useRef<number | null>(null);
  const pendingTouchDragRef = useRef<PendingTouchDrag | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setError(null);

    void loadWorkspace(selection)
      .then((nextWorkspace) => {
        if (!isCurrent) {
          return;
        }

        setWorkspace(nextWorkspace);
        setSelection({
          folderId: nextWorkspace.folder?.id ?? null,
          statusIds: nextWorkspace.selectedStatusIds,
        });
      })
      .catch((loadError: unknown) => {
        if (!isCurrent) {
          return;
        }

        void loadDefaultWorkspace()
          .then((nextWorkspace) => {
            if (!isCurrent) {
              return;
            }

            setWorkspace(nextWorkspace);
            setSelection({
              folderId: nextWorkspace.folder?.id ?? null,
              statusIds: nextWorkspace.selectedStatusIds,
            });
          })
          .catch((fallbackError: unknown) => {
            if (isCurrent) {
              setError(errorMessage(fallbackError, errorMessage(loadError, "Could not load workspace.")));
            }
          });
      });

    return () => {
      isCurrent = false;
    };
  }, [selection.folderId, selection.statusIds.join("|")]);

  useEffect(() => {
    storeSelection(selection);
    updateFolderUrl(selection.folderId);
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    const saveScroll = (): void => {
      storeScrollY(window.scrollY);
    };

    window.addEventListener("beforeunload", saveScroll);
    window.addEventListener("pagehide", saveScroll);

    return () => {
      saveScroll();
      window.removeEventListener("beforeunload", saveScroll);
      window.removeEventListener("pagehide", saveScroll);
    };
  }, []);

  useEffect(() => {
    if (workspace === null || restoredScrollRef.current) {
      return;
    }

    restoredScrollRef.current = true;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: readStoredScrollY() });
    });
  }, [workspace]);

  useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent): void => {
      movePendingTouchDrag(event);

      if (dragPointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      moveDraggedItem(event.clientY);
    };

    const handleWindowPointerUp = (event: PointerEvent): void => {
      void finishPointerDrag(event.pointerId);
    };

    const handleWindowPointerCancel = (event: PointerEvent): void => {
      cancelPointerDrag(event.pointerId);
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  });

  const selectedItems = useMemo(() => {
    if (workspace === null) {
      return [];
    }

    return workspace.todos.filter((item) => selectedItemIds.includes(item.id));
  }, [workspace, selectedItemIds]);

  const selectAllChecked = workspace !== null && workspace.todos.length > 0 && selectedItemIds.length === workspace.todos.length;

  async function refreshCurrentWorkspace(): Promise<void> {
    const nextWorkspace = await loadWorkspace(selection);
    setWorkspace(nextWorkspace);
    setSelection({
      folderId: nextWorkspace.folder?.id ?? null,
      statusIds: nextWorkspace.selectedStatusIds,
    });
  }

  async function runPlaudSyncNow(): Promise<void> {
    setError(null);
    setIsTriggeringPlaudSync(true);

    try {
      await triggerPlaudSync();
    } catch (runError: unknown) {
      setError(errorMessage(runError, "Could not trigger PLAUD sync."));
      setIsTriggeringPlaudSync(false);
      return;
    }

    setError("PLAUD sync requested. Railway is starting the transcriber now.");
    setIsTriggeringPlaudSync(false);
  }

  function clearTouchLongPress(): void {
    if (touchLongPressTimerRef.current !== null) {
      window.clearTimeout(touchLongPressTimerRef.current);
      touchLongPressTimerRef.current = null;
    }

    pendingTouchDragRef.current = null;
  }

  function resetPointerDrag(): void {
    dragHandleRef.current = null;
    draggedItemIdRef.current = null;
    dragPointerIdRef.current = null;
    dragOriginalOrderRef.current = [];
    dragCurrentOrderRef.current = [];
    setDraggedItemId(null);
    setDragOrder(null);
  }

  function beginPointerDrag(item: TodoItem, pointerId: number, handle: HTMLButtonElement): void {
    const currentWorkspace = workspaceRef.current;

    if (currentWorkspace === null) {
      return;
    }

    const order = currentWorkspace.todos;
    dragHandleRef.current = handle;
    draggedItemIdRef.current = item.id;
    dragPointerIdRef.current = pointerId;
    dragOriginalOrderRef.current = order;
    dragCurrentOrderRef.current = order;
    setDraggedItemId(item.id);
    setDragOrder(order);

    if (typeof handle.setPointerCapture === "function") {
      try {
        handle.setPointerCapture(pointerId);
      } catch (_error: unknown) {
        // Browser can reject capture if the pointer has already ended.
      }
    }
  }

  function moveDraggedItem(clientY: number): void {
    const movedId = draggedItemIdRef.current;
    const list = dragContainerRef.current;

    if (movedId === null || list === null) {
      return;
    }

    const nextOrder = reorderByPointerY(dragCurrentOrderRef.current, movedId, list, clientY);

    if (nextOrder === null || todoIdsEqual(nextOrder, dragCurrentOrderRef.current)) {
      return;
    }

    dragCurrentOrderRef.current = nextOrder;
    setDragOrder(nextOrder);
  }

  async function finishPointerDrag(pointerId: number): Promise<void> {
    if (dragPointerIdRef.current !== pointerId) {
      clearTouchLongPress();
      return;
    }

    clearTouchLongPress();

    const handle = dragHandleRef.current;

    if (handle !== null && typeof handle.releasePointerCapture === "function" && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }

    const movedId = draggedItemIdRef.current;
    const finalOrder = dragCurrentOrderRef.current;
    const originalOrder = dragOriginalOrderRef.current;
    resetPointerDrag();

    if (movedId === null || todoIdsEqual(finalOrder, originalOrder)) {
      return;
    }

    const movedIndex = finalOrder.findIndex((item) => item.id === movedId);

    if (movedIndex === -1) {
      return;
    }

    setWorkspace((current) => current === null ? current : { ...current, todos: finalOrder });

    try {
      const nextWorkspace = await reorderTodos({
        ...selectionRef.current,
        movedId,
        previousId: finalOrder[movedIndex - 1]?.id ?? null,
        nextId: finalOrder[movedIndex + 1]?.id ?? null,
      });
      setWorkspace(nextWorkspace);
    } catch (reorderError: unknown) {
      setError(errorMessage(reorderError, "Could not reorder items."));

      try {
        const nextWorkspace = await loadWorkspace(selectionRef.current);
        setWorkspace(nextWorkspace);
        setSelection({
          folderId: nextWorkspace.folder?.id ?? null,
          statusIds: nextWorkspace.selectedStatusIds,
        });
      } catch (refreshError: unknown) {
        setError(errorMessage(refreshError, errorMessage(reorderError, "Could not restore item order.")));
      }
    }
  }

  function cancelPointerDrag(pointerId: number): void {
    if (dragPointerIdRef.current === pointerId) {
      resetPointerDrag();
    }

    clearTouchLongPress();
  }

  function movePendingTouchDrag(event: PointerEvent): void {
    const pendingTouchDrag = pendingTouchDragRef.current;

    if (pendingTouchDrag === null || pendingTouchDrag.pointerId !== event.pointerId || dragPointerIdRef.current !== null) {
      return;
    }

    const movement = Math.hypot(event.clientX - pendingTouchDrag.startX, event.clientY - pendingTouchDrag.startY);

    if (movement > touchDragMoveTolerancePx) {
      clearTouchLongPress();
    }
  }

  function handleDragPointerDown(item: TodoItem, event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.pointerType === "touch") {
      clearTouchLongPress();
      pendingTouchDragRef.current = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        handle: event.currentTarget,
      };
      touchLongPressTimerRef.current = window.setTimeout(() => {
        const pending = pendingTouchDragRef.current;

        if (pending !== null) {
          beginPointerDrag(pending.item, pending.pointerId, pending.handle);
        }
      }, touchDragDelayMs);
      return;
    }

    event.preventDefault();
    beginPointerDrag(item, event.pointerId, event.currentTarget);
  }

  function changeFolder(folderId: string | null): void {
    setSelectedItemIds([]);
    setEditingItemId(null);
    setFormStatus(emptyFormStatus);
    setSelection({ ...selection, folderId });
  }

  function changeStatuses(statusId: string, isSelected: boolean): void {
    const statusIds = isSelected
      ? [...selection.statusIds, statusId]
      : selection.statusIds.filter((id) => id !== statusId);
    setSelectedItemIds([]);
    setFormStatus(emptyFormStatus);
    setSelection({ ...selection, statusIds });
  }

  function openCreateDialog(): void {
    setFormStatus(emptyFormStatus);
    setDialog({ type: "create" });
  }

  function toggleSelectedItem(itemId: string, isSelected: boolean): void {
    setSelectedItemIds(isSelected
      ? [...selectedItemIds, itemId]
      : selectedItemIds.filter((id) => id !== itemId));
  }

  function toggleAllItems(isSelected: boolean): void {
    setSelectedItemIds(isSelected && workspace !== null ? workspace.todos.map((item) => item.id) : []);
  }

  function startEditing(item: TodoItem): void {
    setEditingItemId(item.id);
    setEditDraft({
      title: item.title ?? "",
      body: item.body,
      folderId: item.nodeId ?? "",
    });
    setFormStatus(emptyFormStatus);
  }

  async function saveEdit(item: TodoItem): Promise<void> {
    setFormStatus({ error: null, isSaving: true });

    try {
      const updated = await updateTodo(item.id, {
        title: editDraft.title,
        body: editDraft.body,
        folderId: editDraft.folderId.length === 0 ? null : editDraft.folderId,
      });
      setWorkspace((current) => current === null ? current : {
        ...current,
        todos: current.todos.map((candidate) => candidate.id === updated.id ? updated : candidate),
      });
      setEditingItemId(null);

      if (updated.nodeId !== item.nodeId) {
        await refreshCurrentWorkspace();
      }
    } catch (saveError: unknown) {
      setFormStatus({ error: errorMessage(saveError, "Could not save item."), isSaving: false });
    }
  }

  async function saveCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormStatus({ error: null, isSaving: true });

    try {
      await createTodo({
        title: getFormString(form, "title"),
        body: getFormString(form, "body"),
        folderId: selection.folderId,
      });
      setDialog(null);
      await refreshCurrentWorkspace();
      setFormStatus(emptyFormStatus);
    } catch (createError: unknown) {
      setFormStatus({ error: errorMessage(createError, "Could not create item."), isSaving: false });
    }
  }

  async function saveStatus(event: FormEvent<HTMLFormElement>, item: TodoItem): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormStatus({ error: null, isSaving: true });

    try {
      await changeStatus(item.id, {
        statusId: getFormString(form, "statusId"),
        note: getFormString(form, "note"),
      });
      setDialog(null);
      await refreshCurrentWorkspace();
      setFormStatus(emptyFormStatus);
    } catch (statusError: unknown) {
      setFormStatus({ error: errorMessage(statusError, "Could not save status."), isSaving: false });
    }
  }

  async function saveBulkStatus(event: FormEvent<HTMLFormElement>, state: Extract<DialogState, { readonly type: "bulk-status" }>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    if (state.statusId === null) {
      const statusId = getFormString(form, "statusId");
      const pendingItems = state.items.filter((item) => item.statusId !== statusId);

      if (pendingItems.length === 0) {
        setSelectedItemIds([]);
        setDialog(null);
        setFormStatus(emptyFormStatus);
        return;
      }

      setDialog({ type: "bulk-status", items: pendingItems, itemIndex: 0, statusId });
      setFormStatus(emptyFormStatus);
      return;
    }

    const item = state.items[state.itemIndex];

    if (item === undefined) {
      setSelectedItemIds([]);
      setDialog(null);
      setFormStatus(emptyFormStatus);
      await refreshCurrentWorkspace();
      return;
    }

    setFormStatus({ error: null, isSaving: true });

    try {
      await changeStatus(item.id, {
        statusId: state.statusId,
        note: getFormString(form, "note"),
      });

      const nextIndex = state.itemIndex + 1;

      if (nextIndex >= state.items.length) {
        setSelectedItemIds([]);
        setDialog(null);
        await refreshCurrentWorkspace();
      } else {
        setDialog({ ...state, itemIndex: nextIndex });
      }

      setFormStatus(emptyFormStatus);
    } catch (statusError: unknown) {
      setFormStatus({ error: errorMessage(statusError, "Could not save status."), isSaving: false });
    }
  }

  async function saveMove(event: FormEvent<HTMLFormElement>, item: TodoItem | null): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormStatus({ error: null, isSaving: true });

    try {
      if (item === null) {
        await bulkMove({
          ...selection,
          itemIds: selectedItemIds,
          folderId: nullableFormId(form, "folderId"),
          folderPath: getFormString(form, "folderPath"),
        });
        setSelectedItemIds([]);
      } else {
        await moveTodo(item.id, {
          folderId: nullableFormId(form, "folderId"),
          folderPath: getFormString(form, "folderPath"),
        });
      }

      setDialog(null);
      await refreshCurrentWorkspace();
      setFormStatus(emptyFormStatus);
    } catch (moveError: unknown) {
      setFormStatus({ error: errorMessage(moveError, "Could not move item."), isSaving: false });
    }
  }

  async function saveFolderCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormStatus({ error: null, isSaving: true });

    try {
      const result = await createFolder({
        ...selection,
        folderPath: getFormString(form, "folderPath"),
      });
      setWorkspace(result.workspace);
      setSelection({ folderId: result.folder.id, statusIds: result.workspace.selectedStatusIds });
      setFormStatus(emptyFormStatus);
      event.currentTarget.reset();
    } catch (folderError: unknown) {
      setFormStatus({ error: errorMessage(folderError, "Could not create folder."), isSaving: false });
    }
  }

  async function saveFolderRename(event: FormEvent<HTMLFormElement>, folder: Folder): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormStatus({ error: null, isSaving: true });

    try {
      const nextWorkspace = await renameFolder(folder.id, {
        ...selection,
        name: getFormString(form, "name"),
      });
      setWorkspace(nextWorkspace);
      setFormStatus(emptyFormStatus);
    } catch (renameError: unknown) {
      setFormStatus({ error: errorMessage(renameError, "Could not rename folder."), isSaving: false });
    }
  }

  async function removeFolder(folder: Folder): Promise<void> {
    setFormStatus({ error: null, isSaving: true });

    try {
      const nextWorkspace = await deleteFolder(folder.id, selection);
      setWorkspace(nextWorkspace);
      setSelection({
        folderId: nextWorkspace.folder?.id ?? null,
        statusIds: nextWorkspace.selectedStatusIds,
      });
      setFormStatus(emptyFormStatus);
    } catch (deleteError: unknown) {
      setFormStatus({ error: errorMessage(deleteError, "Could not delete folder."), isSaving: false });
    }
  }

  async function moveItemByButton(item: TodoItem, direction: "up" | "down"): Promise<void> {
    if (workspace === null) {
      return;
    }

    const index = workspace.todos.findIndex((candidate) => candidate.id === item.id);
    const withoutMoved = workspace.todos.filter((candidate) => candidate.id !== item.id);
    const insertionIndex = direction === "up" ? index - 1 : index + 1;

    if (index === -1 || insertionIndex < 0 || insertionIndex >= workspace.todos.length) {
      return;
    }

    try {
      const nextWorkspace = await reorderTodos({
        ...selection,
        movedId: item.id,
        previousId: withoutMoved[insertionIndex - 1]?.id ?? null,
        nextId: withoutMoved[insertionIndex]?.id ?? null,
      });
      setWorkspace(nextWorkspace);
    } catch (reorderError: unknown) {
      setError(errorMessage(reorderError, "Could not reorder items."));
    }
  }

  if (workspace === null) {
    return (
      <main className="auth-shell">
        <section className="panel">
          <p className="eyebrow">Todo MVP</p>
          <h1>Loading workspace</h1>
          {error === null ? null : <p className="notice error">{error}</p>}
        </section>
      </main>
    );
  }

  const visibleTodos = dragOrder ?? workspace.todos;

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Signed in as</p>
          <p className="user-email">{workspace.user.email}</p>
        </div>
        <div className="todo-actions topbar-actions">
          <a href="/prompts" className="button-link secondary">Prompts</a>
          <button
            type="button"
            className="secondary"
            disabled={isTriggeringPlaudSync}
            onClick={() => { void runPlaudSyncNow(); }}
          >
            {isTriggeringPlaudSync ? "Starting PLAUD sync..." : "Run PLAUD sync now"}
          </button>
          <form action="/logout" method="post">
            <button type="submit" className="secondary">Log out</button>
          </form>
        </div>
      </header>
      <div className="workspace">
        <aside className="panel sidebar" aria-labelledby="folder-navigation-heading">
          <h2 id="folder-navigation-heading">Folders</h2>
          <FolderNavigation
            folders={workspace.folders}
            selectedFolderId={workspace.folder?.id ?? null}
            inboxCount={workspace.inboxCount}
            onSelect={changeFolder}
          />
          <form className="stack folder-create" onSubmit={(event) => { void saveFolderCreate(event); }}>
            <label htmlFor="sidebar-folder-path">Add folder path</label>
            <input id="sidebar-folder-path" name="folderPath" type="text" placeholder="Meetings / Regen Hub" required />
            <button type="submit" disabled={formStatus.isSaving}>Add folder</button>
          </form>
        </aside>
        <main className="main-column">
          <section className="panel mobile-location">
            <label htmlFor="mobile-folder-id">Location</label>
            <select
              id="mobile-folder-id"
              value={selection.folderId ?? ""}
              onChange={(event) => {
                changeFolder(event.currentTarget.value.length === 0 ? null : event.currentTarget.value);
              }}
            >
              <option value="">Inbox</option>
              <FolderOptions folders={workspace.folders} selectedId={selection.folderId} />
            </select>
          </section>
          <Breadcrumbs ancestors={workspace.ancestors} onSelect={changeFolder} />
          <section className="panel list-panel" aria-labelledby="todo-list-heading">
            <div className="list-heading">
              <div>
                <p className="eyebrow">{workspace.folder === null ? "Unfiled items" : "Direct folder items"}</p>
                <h1 id="todo-list-heading">{workspace.folder?.name ?? "Inbox"}</h1>
              </div>
              <button type="button" className="secondary" onClick={openCreateDialog}>Add item</button>
            </div>
            {error === null ? null : <p className="notice error">{error}</p>}
            {formStatus.error === null ? null : <p className="notice error">{formStatus.error}</p>}
            <StatusFilters
              statuses={workspace.statuses}
              selectedStatusIds={selection.statusIds}
              onChange={changeStatuses}
            />
            {workspace.folder === null ? null : (
              <FolderSettings
                folder={workspace.folder}
                isSaving={formStatus.isSaving}
                onRename={saveFolderRename}
                onDelete={removeFolder}
              />
            )}
            <div className="bulk-actions">
              <label>
                <input
                  type="checkbox"
                  checked={selectAllChecked}
                  onChange={(event) => { toggleAllItems(event.currentTarget.checked); }}
                /> Select all
              </label>
              <p className="bulk-count">{selectedItemIds.length.toString()} selected</p>
              <button
                type="button"
                className="secondary"
                disabled={selectedItemIds.length === 0}
                onClick={() => {
                  setDialog({ type: "bulk-status", items: selectedItems, itemIndex: 0, statusId: null });
                  setFormStatus(emptyFormStatus);
                }}
              >
                Change status
              </button>
              <button
                type="button"
                className="secondary"
                disabled={selectedItemIds.length === 0}
                onClick={() => { setDialog({ type: "bulk-move" }); }}
              >
                Move selected
              </button>
            </div>
            {workspace.todos.length === 0 ? (
              <p className="empty-state">No matching items in this location.</p>
            ) : (
              <ul className="todo-list" ref={dragContainerRef}>
                {visibleTodos.map((item, index) => (
                  <TodoCard
                    key={item.id}
                    item={item}
                    folders={workspace.folders}
                    index={index}
                    total={visibleTodos.length}
                    isSelected={selectedItemIds.includes(item.id)}
                    isExpanded={expandedItemIds.includes(item.id)}
                    isEditing={editingItemId === item.id}
                    isDragging={draggedItemId === item.id}
                    editDraft={editDraft}
                    isSaving={formStatus.isSaving}
                    onSelect={toggleSelectedItem}
                    onToggleExpanded={(itemId) => {
                      setExpandedItemIds(expandedItemIds.includes(itemId)
                        ? expandedItemIds.filter((id) => id !== itemId)
                        : [...expandedItemIds, itemId]);
                    }}
                    onEdit={startEditing}
                    onDraftChange={setEditDraft}
                    onCancelEdit={() => { setEditingItemId(null); setFormStatus(emptyFormStatus); }}
                    onSaveEdit={(todo) => { void saveEdit(todo); }}
                    onStatus={(todo) => { setDialog({ type: "status", item: todo }); setFormStatus(emptyFormStatus); }}
                    onMove={(todo) => { setDialog({ type: "move", item: todo }); setFormStatus(emptyFormStatus); }}
                    onReorder={(todo, direction) => { void moveItemByButton(todo, direction); }}
                    onDragPointerDown={handleDragPointerDown}
                  />
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
      {dialog === null ? null : (
        <DialogShell onClose={() => { setDialog(null); setFormStatus(emptyFormStatus); }}>
          {dialog.type === "create" ? (
            <CreateDialog isSaving={formStatus.isSaving} onSubmit={saveCreate} />
          ) : null}
          {dialog.type === "status" ? (
            <StatusDialog item={dialog.item} statuses={workspace.statuses} isSaving={formStatus.isSaving} onSubmit={saveStatus} />
          ) : null}
          {dialog.type === "bulk-status" ? (
            <BulkStatusDialog state={dialog} statuses={workspace.statuses} isSaving={formStatus.isSaving} onSubmit={saveBulkStatus} />
          ) : null}
          {dialog.type === "move" ? (
            <MoveDialog item={dialog.item} folders={workspace.folders} selectedCount={1} isSaving={formStatus.isSaving} onSubmit={saveMove} />
          ) : null}
          {dialog.type === "bulk-move" ? (
            <MoveDialog item={null} folders={workspace.folders} selectedCount={selectedItems.length} isSaving={formStatus.isSaving} onSubmit={saveMove} />
          ) : null}
        </DialogShell>
      )}
    </>
  );
}

function FolderNavigation(props: {
  readonly folders: ReadonlyArray<Folder>;
  readonly selectedFolderId: string | null;
  readonly inboxCount: number;
  readonly onSelect: (folderId: string | null) => void;
}): ReactElement {
  const roots = props.folders.filter((folder) => folder.parentId === null);

  return (
    <nav aria-label="Folder navigation">
      <button
        type="button"
        className={`folder-link ${props.selectedFolderId === null ? "selected" : ""}`}
        onClick={() => { props.onSelect(null); }}
      >
        <span>Inbox</span><span>{props.inboxCount.toString()}</span>
      </button>
      <ul className="folder-tree">
        {roots.map((folder) => (
          <FolderBranch
            key={folder.id}
            folder={folder}
            folders={props.folders}
            selectedFolderId={props.selectedFolderId}
            onSelect={props.onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}

function FolderBranch(props: {
  readonly folder: Folder;
  readonly folders: ReadonlyArray<Folder>;
  readonly selectedFolderId: string | null;
  readonly onSelect: (folderId: string | null) => void;
}): ReactElement {
  const children = props.folders.filter((folder) => folder.parentId === props.folder.id);
  const link = (
    <button
      type="button"
      className={`folder-link ${props.selectedFolderId === props.folder.id ? "selected" : ""}`}
      onClick={() => { props.onSelect(props.folder.id); }}
    >
      <span>{props.folder.name}</span><span>{props.folder.directItemCount.toString()}</span>
    </button>
  );

  if (children.length === 0) {
    return <li>{link}</li>;
  }

  return (
    <li>
      <details open={children.some((child) => child.id === props.selectedFolderId)}>
        <summary>{link}</summary>
        <ul>
          {children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              folders={props.folders}
              selectedFolderId={props.selectedFolderId}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}

function FolderOptions(props: {
  readonly folders: ReadonlyArray<Folder>;
  readonly selectedId: string | null;
  readonly parentId?: string | null;
  readonly depth?: number;
}): ReactElement {
  const parentId = props.parentId ?? null;
  const depth = props.depth ?? 0;
  const children = props.folders.filter((folder) => folder.parentId === parentId);

  return (
    <>
      {children.map((folder) => (
        <option key={folder.id} value={folder.id}>
          {`${depth === 0 ? "" : `${"  ".repeat(depth)}- `}${folder.name}`}
        </option>
      ))}
      {children.map((folder) => (
        <FolderOptions key={`${folder.id}-children`} folders={props.folders} selectedId={props.selectedId} parentId={folder.id} depth={depth + 1} />
      ))}
    </>
  );
}

function Breadcrumbs(props: {
  readonly ancestors: ReadonlyArray<Folder>;
  readonly onSelect: (folderId: string | null) => void;
}): ReactElement | null {
  if (props.ancestors.length === 0) {
    return null;
  }

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><button type="button" onClick={() => { props.onSelect(null); }}>Inbox</button></li>
        {props.ancestors.map((folder) => (
          <li key={folder.id}><button type="button" onClick={() => { props.onSelect(folder.id); }}>{folder.name}</button></li>
        ))}
      </ol>
    </nav>
  );
}

function StatusFilters(props: {
  readonly statuses: ReadonlyArray<Status>;
  readonly selectedStatusIds: ReadonlyArray<string>;
  readonly onChange: (statusId: string, isSelected: boolean) => void;
}): ReactElement {
  return (
    <fieldset className="filter-form">
      <legend>Show statuses</legend>
      {props.statuses.map((status) => (
        <label key={status.id}>
          <input
            name="status"
            type="checkbox"
            value={status.id}
            checked={props.selectedStatusIds.includes(status.id)}
            onChange={(event) => { props.onChange(status.id, event.currentTarget.checked); }}
          /> {status.name}
        </label>
      ))}
    </fieldset>
  );
}

function FolderSettings(props: {
  readonly folder: Folder;
  readonly isSaving: boolean;
  readonly onRename: (event: FormEvent<HTMLFormElement>, folder: Folder) => Promise<void>;
  readonly onDelete: (folder: Folder) => Promise<void>;
}): ReactElement {
  return (
    <details className="folder-controls">
      <summary>Folder settings</summary>
      <div className="folder-control-grid">
        <form className="stack" onSubmit={(event) => { void props.onRename(event, props.folder); }}>
          <label htmlFor="folder-name">Rename folder</label>
          <input id="folder-name" name="name" type="text" defaultValue={props.folder.name} required />
          <button type="submit" className="secondary" disabled={props.isSaving}>Rename</button>
        </form>
        <div className="stack">
          <p className="muted">Only empty folders without child folders can be deleted.</p>
          <button type="button" className="danger" disabled={props.isSaving} onClick={() => { void props.onDelete(props.folder); }}>
            Delete folder
          </button>
        </div>
      </div>
    </details>
  );
}

function TodoCard(props: {
  readonly item: TodoItem;
  readonly folders: ReadonlyArray<Folder>;
  readonly index: number;
  readonly total: number;
  readonly isSelected: boolean;
  readonly isExpanded: boolean;
  readonly isEditing: boolean;
  readonly isDragging: boolean;
  readonly editDraft: EditDraft;
  readonly isSaving: boolean;
  readonly onSelect: (itemId: string, isSelected: boolean) => void;
  readonly onToggleExpanded: (itemId: string) => void;
  readonly onEdit: (item: TodoItem) => void;
  readonly onDraftChange: (draft: EditDraft) => void;
  readonly onCancelEdit: () => void;
  readonly onSaveEdit: (item: TodoItem) => void;
  readonly onStatus: (item: TodoItem) => void;
  readonly onMove: (item: TodoItem) => void;
  readonly onReorder: (item: TodoItem, direction: "up" | "down") => void;
  readonly onDragPointerDown: (item: TodoItem, event: ReactPointerEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const primaryText = props.item.title ?? props.item.body;

  return (
    <li className="todo-card" data-todo-id={props.item.id} data-dragging={props.isDragging ? "true" : "false"} data-text-expanded={props.isExpanded ? "true" : "false"}>
      <label className="todo-select">
        <input
          type="checkbox"
          value={props.item.id}
          checked={props.isSelected}
          aria-label={`Select ${primaryText}`}
          onChange={(event) => { props.onSelect(props.item.id, event.currentTarget.checked); }}
        />
        <span>Select</span>
      </label>
      <button
        type="button"
        className="drag-handle"
        aria-label={`Drag to reorder ${primaryText}`}
        onPointerDown={(event) => { props.onDragPointerDown(props.item, event); }}
      >
        Grip
      </button>
      <article aria-labelledby={`todo-${props.item.id}-heading`}>
        {props.isEditing ? (
          <div className="inline-edit">
            <label htmlFor={`edit-title-${props.item.id}`}>Title <span className="muted">(optional)</span></label>
            <input
              id={`edit-title-${props.item.id}`}
              type="text"
              maxLength={160}
              value={props.editDraft.title}
              onChange={(event) => { props.onDraftChange({ ...props.editDraft, title: event.currentTarget.value }); }}
            />
            <label htmlFor={`edit-body-${props.item.id}`}>Description</label>
            <textarea
              id={`edit-body-${props.item.id}`}
              rows={5}
              required
              value={props.editDraft.body}
              onChange={(event) => { props.onDraftChange({ ...props.editDraft, body: event.currentTarget.value }); }}
            />
            <label htmlFor={`edit-folder-${props.item.id}`}>Folder</label>
            <select
              id={`edit-folder-${props.item.id}`}
              value={props.editDraft.folderId}
              onChange={(event) => { props.onDraftChange({ ...props.editDraft, folderId: event.currentTarget.value }); }}
            >
              <option value="">Inbox</option>
              <FolderOptions folders={props.folders} selectedId={props.editDraft.folderId.length === 0 ? null : props.editDraft.folderId} />
            </select>
            <div className="button-row">
              <button type="button" disabled={props.isSaving} onClick={() => { props.onSaveEdit(props.item); }}>Save changes</button>
              <button type="button" className="secondary" onClick={props.onCancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="todo-summary">
              <div className="todo-heading-group">
                <p className="status-pill">{props.item.statusName}</p>
                <h2 id={`todo-${props.item.id}-heading`} className="todo-title">{primaryText}</h2>
                {props.item.title === null ? null : <p className="todo-description">{props.item.body}</p>}
              </div>
              <button
                className="secondary todo-toggle"
                type="button"
                aria-expanded={props.isExpanded}
                onClick={() => { props.onToggleExpanded(props.item.id); }}
              >
                {props.isExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
            <div className="todo-actions">
              <button type="button" className="secondary" onClick={() => { props.onEdit(props.item); }}>Edit</button>
              <button type="button" className="secondary" onClick={() => { props.onStatus(props.item); }}>Status</button>
              <button type="button" className="secondary" onClick={() => { props.onMove(props.item); }}>Move</button>
              <button type="button" className="secondary" disabled={props.index === 0} onClick={() => { props.onReorder(props.item, "up"); }}>Move up</button>
              <button type="button" className="secondary" disabled={props.index === props.total - 1} onClick={() => { props.onReorder(props.item, "down"); }}>Move down</button>
            </div>
          </>
        )}
      </article>
    </li>
  );
}

function DialogShell(props: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="panel panel-edit modal-panel" role="dialog" aria-modal="true">
        <div className="modal-heading">
          <span />
          <button type="button" className="secondary" onClick={props.onClose}>Close</button>
        </div>
        {props.children}
      </section>
    </div>
  );
}

function CreateDialog(props: {
  readonly isSaving: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): ReactElement {
  return (
    <form className="stack" onSubmit={(event) => { void props.onSubmit(event); }}>
      <h1>Add item</h1>
      <label htmlFor="create-title">Title <span className="muted">(optional)</span></label>
      <input id="create-title" name="title" type="text" maxLength={160} />
      <label htmlFor="create-body">Description</label>
      <textarea id="create-body" name="body" rows={7} required />
      <button type="submit" disabled={props.isSaving}>Add todo</button>
    </form>
  );
}

function StatusDialog(props: {
  readonly item: TodoItem;
  readonly statuses: ReadonlyArray<Status>;
  readonly isSaving: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>, item: TodoItem) => Promise<void>;
}): ReactElement {
  return (
    <form className="stack" onSubmit={(event) => { void props.onSubmit(event, props.item); }}>
      <h1>Change status</h1>
      <p className="muted">{props.item.title ?? props.item.body}</p>
      <label htmlFor="statusId">Status</label>
      <select id="statusId" name="statusId" defaultValue={props.item.statusId} required>
        {props.statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
      </select>
      <label htmlFor="note">Note <span className="muted">(optional)</span></label>
      <textarea id="note" name="note" rows={4} maxLength={2000} />
      <button type="submit" disabled={props.isSaving}>Save status</button>
    </form>
  );
}

function BulkStatusDialog(props: {
  readonly state: Extract<DialogState, { readonly type: "bulk-status" }>;
  readonly statuses: ReadonlyArray<Status>;
  readonly isSaving: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>, state: Extract<DialogState, { readonly type: "bulk-status" }>) => Promise<void>;
}): ReactElement {
  if (props.state.statusId === null) {
    return (
      <form className="stack" onSubmit={(event) => { void props.onSubmit(event, props.state); }}>
        <h1>Change selected statuses</h1>
        <p className="muted">{props.state.items.length.toString()} selected</p>
        <label htmlFor="bulk-status-id">Status</label>
        <select id="bulk-status-id" name="statusId" required>
          {props.statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
        </select>
        <button type="submit" disabled={props.isSaving}>Continue to notes</button>
      </form>
    );
  }

  const item = props.state.items[props.state.itemIndex];
  const selectedStatus = props.statuses.find((status) => status.id === props.state.statusId);

  return (
    <form key={item?.id ?? props.state.itemIndex} className="stack" onSubmit={(event) => { void props.onSubmit(event, props.state); }}>
      <h1>Note for item {(props.state.itemIndex + 1).toString()} of {props.state.items.length.toString()}</h1>
      <p className="muted">Changing to {selectedStatus?.name ?? "selected status"}</p>
      <p className="muted">{item?.title ?? item?.body ?? "Selected item"}</p>
      <label htmlFor="bulk-note">Note <span className="muted">(optional)</span></label>
      <textarea id="bulk-note" name="note" rows={4} maxLength={2000} autoFocus />
      <button type="submit" disabled={props.isSaving}>
        {props.state.itemIndex + 1 >= props.state.items.length ? "Save statuses" : "Save and continue"}
      </button>
    </form>
  );
}

function MoveDialog(props: {
  readonly item: TodoItem | null;
  readonly folders: ReadonlyArray<Folder>;
  readonly selectedCount: number;
  readonly isSaving: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>, item: TodoItem | null) => Promise<void>;
}): ReactElement {
  return (
    <form className="stack" onSubmit={(event) => { void props.onSubmit(event, props.item); }}>
      <h1>{props.item === null ? "Move selected items" : "Move item"}</h1>
      <p className="muted">{props.item === null ? `${props.selectedCount.toString()} selected` : props.item.title ?? props.item.body}</p>
      <label htmlFor="move-folder-id">Existing location</label>
      <select id="move-folder-id" name="folderId" defaultValue={props.item?.nodeId ?? ""}>
        <option value="">Inbox</option>
        <FolderOptions folders={props.folders} selectedId={props.item?.nodeId ?? null} />
      </select>
      <label htmlFor="folderPath">Or create absolute folder path <span className="muted">(optional)</span></label>
      <input id="folderPath" name="folderPath" type="text" placeholder="Errands / Costco" />
      <button type="submit" disabled={props.isSaving}>{props.item === null ? "Move selected" : "Move item"}</button>
    </form>
  );
}

function getFormString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function nullableFormId(form: FormData, key: string): string | null {
  const value = getFormString(form, key).trim();
  return value.length === 0 ? null : value;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
