import { useDrag } from "@use-gesture/react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { changeStatus, loadWorkspace } from "./workspace-api";
import type { Status, StatusCategory, TodoItem, WorkspaceSelection, WorkspaceView } from "./workspace-types";

const swipeSelection: WorkspaceSelection = {
  view: "inbox",
  folderId: null,
  statusIds: [],
};

const skippedStorageKey = "todo.swipe.skippedActiveIds";
const swipeThresholdPx = 84;

type SwipeAction = "archive" | "complete" | "keep-active";

type SwipeDirection = SwipeAction | "none";

const categoryByAction = {
  archive: "archived",
  complete: "completed",
} satisfies Record<Exclude<SwipeAction, "keep-active">, StatusCategory>;

export function SwipeApp(): ReactElement {
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [skippedIds, setSkippedIds] = useState<ReadonlyArray<string>>(() => readSkippedIds());
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    const skippedSet = new Set(skippedIds);
    return workspace?.todos.filter((item) => item.statusCategory === "active" && !skippedSet.has(item.id)) ?? [];
  }, [skippedIds, workspace]);
  const activeItem = visibleItems[0] ?? null;

  const reloadDeck = useCallback(async (): Promise<void> => {
    setError(null);

    try {
      const nextWorkspace = await loadWorkspace(swipeSelection);
      setWorkspace(nextWorkspace);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, "Could not load swipe deck."));
    }
  }, []);

  useEffect(() => {
    void reloadDeck();
  }, [reloadDeck]);

  function removeItem(itemId: string): void {
    setWorkspace((current) => current === null
      ? current
      : { ...current, todos: current.todos.filter((item) => item.id !== itemId) });
  }

  function startNewSession(): void {
    writeSkippedIds([]);
    setSkippedIds([]);
    void reloadDeck();
  }

  async function handleSwipe(item: TodoItem, action: SwipeAction): Promise<boolean> {
    if (busyItemId !== null) {
      return false;
    }

    setError(null);
    setBusyItemId(item.id);

    if (action === "keep-active") {
      const nextSkippedIds = appendUnique(skippedIds, item.id);
      writeSkippedIds(nextSkippedIds);
      setSkippedIds(nextSkippedIds);
      removeItem(item.id);
      setBusyItemId(null);
      return true;
    }

    const status = findStatusByCategory(workspace?.statuses ?? [], categoryByAction[action]);

    if (status === null) {
      setError(`Missing ${categoryByAction[action]} status.`);
      setBusyItemId(null);
      return false;
    }

    try {
      await changeStatus(item.id, { statusId: status.id, note: null });
      removeItem(item.id);
      setBusyItemId(null);
      return true;
    } catch (swipeError: unknown) {
      setError(errorMessage(swipeError, "Could not save swipe."));
      setBusyItemId(null);
      return false;
    }
  }

  return (
    <main className="swipe-shell">
      <header className="swipe-topbar">
        <div>
          <p className="eyebrow">Inbox review</p>
          <h1>Swipe</h1>
        </div>
        <a className="button-link secondary" href="/">Workspace</a>
      </header>

      {error === null ? null : <p className="notice error">{error}</p>}

      <section className="swipe-stage" aria-labelledby="swipe-heading">
        <div className="swipe-heading">
          <h2 id="swipe-heading">Active inbox cards</h2>
          <p>{visibleItems.length.toString()} remaining</p>
        </div>

        {workspace === null ? (
          <article className="swipe-card swipe-empty-card" aria-label="Loading swipe deck">
            <p className="eyebrow">Loading</p>
            <p>Preparing cards.</p>
          </article>
        ) : activeItem === null ? (
          <article className="swipe-card swipe-empty-card">
            <p className="eyebrow">Deck clear</p>
            <h3>No active inbox cards in this session.</h3>
            <p>Start a new session to bring back cards you kept active in this browser tab.</p>
            <button type="button" onClick={startNewSession}>Start new session</button>
          </article>
        ) : (
          <SwipeCard
            key={activeItem.id}
            item={activeItem}
            itemCount={visibleItems.length}
            isBusy={busyItemId === activeItem.id}
            onSwipe={handleSwipe}
          />
        )}
      </section>
    </main>
  );
}

type SwipeCardProps = {
  readonly item: TodoItem;
  readonly itemCount: number;
  readonly isBusy: boolean;
  readonly onSwipe: (item: TodoItem, action: SwipeAction) => Promise<boolean>;
};

function SwipeCard({ item, itemCount, isBusy, onSwipe }: SwipeCardProps): ReactNode {
  const prefersReducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-8, 8]);
  const archiveOpacity = useTransform(x, [-150, -70], [1, 0]);
  const keepOpacity = useTransform(x, [70, 150], [0, 1]);
  const completeOpacity = useTransform(y, [-150, -70], [1, 0]);

  const resetPosition = useCallback((): void => {
    animate(x, 0, { type: "spring", stiffness: 430, damping: 30 });
    animate(y, 0, { type: "spring", stiffness: 430, damping: 30 });
  }, [x, y]);

  const submitSwipe = useCallback(async (direction: SwipeDirection): Promise<void> => {
    if (direction === "none") {
      resetPosition();
      return;
    }

    if (!prefersReducedMotion) {
      const target = getDismissTarget(direction);
      animate(x, target.x, { duration: 0.18 });
      animate(y, target.y, { duration: 0.18 });
    }

    const saved = await onSwipe(item, direction);

    if (!saved) {
      resetPosition();
    }
  }, [item, onSwipe, prefersReducedMotion, resetPosition, x, y]);

  const bind = useDrag(
    ({ active, movement: [movementX, movementY] }): void => {
      if (isBusy) {
        return;
      }

      x.set(movementX);
      y.set(movementY);

      if (active) {
        return;
      }

      void submitSwipe(getSwipeDirection(movementX, movementY));
    },
    { filterTaps: true, pointer: { capture: false } },
  );

  return (
    <motion.article
      className="swipe-card"
      data-testid="swipe-card"
      style={{ x, y, rotate, touchAction: "none" }}
      aria-labelledby={`${item.id}-swipe-title`}
    >
      <div {...bind()} className="swipe-card-surface" data-testid="swipe-card-surface">
        <motion.p className="swipe-indicator swipe-indicator-left" style={{ opacity: archiveOpacity }}>Archive</motion.p>
        <motion.p className="swipe-indicator swipe-indicator-right" style={{ opacity: keepOpacity }}>Keep active</motion.p>
        <motion.p className="swipe-indicator swipe-indicator-up" style={{ opacity: completeOpacity }}>Complete</motion.p>

        <header className="swipe-card-header">
          <p className="eyebrow">Card {itemCount.toString()}</p>
          <p className="status-pill">{item.statusName}</p>
        </header>
        <h3 id={`${item.id}-swipe-title`}>{item.title ?? "Untitled task"}</h3>
        <p className="swipe-card-body">{item.body}</p>
      </div>
      <footer className="swipe-controls" aria-label="Swipe actions">
        <button type="button" className="secondary" onClick={() => { void submitSwipe("archive"); }} disabled={isBusy}>
          Archive
        </button>
        <button type="button" onClick={() => { void submitSwipe("keep-active"); }} disabled={isBusy}>
          Keep active
        </button>
        <button type="button" className="secondary" onClick={() => { void submitSwipe("complete"); }} disabled={isBusy}>
          Complete
        </button>
      </footer>
    </motion.article>
  );
}

function getSwipeDirection(movementX: number, movementY: number): SwipeDirection {
  if (Math.abs(movementX) > Math.abs(movementY) && Math.abs(movementX) >= swipeThresholdPx) {
    return movementX > 0 ? "keep-active" : "archive";
  }

  if (Math.abs(movementY) >= swipeThresholdPx) {
    return movementY < 0 ? "complete" : "none";
  }

  return "none";
}

function getDismissTarget(action: SwipeAction): { readonly x: number; readonly y: number } {
  switch (action) {
    case "archive":
      return { x: -420, y: 0 };
    case "keep-active":
      return { x: 420, y: 0 };
    case "complete":
      return { x: 0, y: -420 };
  }
}

function findStatusByCategory(statuses: ReadonlyArray<Status>, category: StatusCategory): Status | null {
  return statuses.find((status) => status.category === category) ?? null;
}

function readSkippedIds(): ReadonlyArray<string> {
  const raw = window.sessionStorage.getItem(skippedStorageKey);

  if (raw === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch (_error: unknown) {
    return [];
  }
}

function writeSkippedIds(ids: ReadonlyArray<string>): void {
  window.sessionStorage.setItem(skippedStorageKey, JSON.stringify(ids));
}

function appendUnique(values: ReadonlyArray<string>, value: string): ReadonlyArray<string> {
  return values.includes(value) ? values : [...values, value];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
