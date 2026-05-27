import type { TodoItem, User } from "./db.js";

export type LoginPageOptions = {
  readonly message: string | null;
  readonly error: string | null;
};

export type TodoPageOptions = {
  readonly user: User;
  readonly todos: ReadonlyArray<TodoItem>;
  readonly error: string | null;
};

export type EditPageOptions = {
  readonly todo: TodoItem;
  readonly error: string | null;
};

export function renderLoginPage(options: LoginPageOptions): string {
  return renderLayout(
    "Sign in",
    `
      <main class="auth-shell">
        <section class="panel" aria-labelledby="login-heading">
          <p class="eyebrow">Todo MVP</p>
          <h1 id="login-heading">Sign in with email</h1>
          <p>Enter your email address. For the MVP, the magic link prints in the terminal.</p>
          ${renderNotice(options.message, "success")}
          ${renderNotice(options.error, "error")}
          <form action="/login" method="post" class="stack">
            <label for="email">Email address</label>
            <input id="email" name="email" type="email" autocomplete="email" required>
            <button type="submit">Send magic link</button>
          </form>
        </section>
      </main>
    `,
    "",
  );
}

export function renderTodoPage(options: TodoPageOptions): string {
  return renderLayout(
    "Todos",
    `
      <header class="topbar">
        <div>
          <p class="eyebrow">Signed in as</p>
          <p class="user-email">${escapeHtml(options.user.email)}</p>
        </div>
        <form action="/logout" method="post">
          <button type="submit" class="secondary">Log out</button>
        </form>
      </header>
      <main class="app-shell">
        <section class="composer panel" aria-labelledby="new-todo-heading">
          <h1 id="new-todo-heading">Add item</h1>
          ${renderNotice(options.error, "error")}
          <form action="/todos" method="post" class="stack">
            <label for="title">Title <span class="muted">(optional)</span></label>
            <input id="title" name="title" type="text" maxlength="160">
            <label for="body">Description</label>
            <textarea id="body" name="body" rows="4" required></textarea>
            <button type="submit">Add todo</button>
          </form>
        </section>
        <section class="panel" aria-labelledby="todo-list-heading">
          <div class="list-heading">
            <div>
              <p class="eyebrow">Active list</p>
              <h2 id="todo-list-heading">Todos</h2>
            </div>
            <p class="muted">${options.todos.length.toString()} active</p>
          </div>
          ${renderTodoList(options.todos)}
        </section>
      </main>
    `,
    renderClientScript(),
  );
}

export function renderEditPage(options: EditPageOptions): string {
  return renderLayout(
    "Edit todo",
    `
      <main class="auth-shell">
        <section class="panel" aria-labelledby="edit-heading">
          <p class="eyebrow">Edit item</p>
          <h1 id="edit-heading">${escapeHtml(options.todo.title ?? options.todo.body)}</h1>
          ${renderNotice(options.error, "error")}
          <form action="/todos/${encodeURIComponent(options.todo.id)}" method="post" class="stack">
            <label for="title">Title <span class="muted">(optional)</span></label>
            <input id="title" name="title" type="text" maxlength="160" value="${escapeAttribute(options.todo.title ?? "")}">
            <label for="body">Description</label>
            <textarea id="body" name="body" rows="7" required>${escapeHtml(options.todo.body)}</textarea>
            <div class="button-row">
              <button type="submit">Save changes</button>
              <a href="/" class="button-link">Cancel</a>
            </div>
          </form>
        </section>
      </main>
    `,
    "",
  );
}

export function renderNotFoundPage(): string {
  return renderLayout(
    "Not found",
    `
      <main class="auth-shell">
        <section class="panel">
          <h1>Not found</h1>
          <p>The page or item does not exist.</p>
          <a href="/" class="button-link">Go home</a>
        </section>
      </main>
    `,
    "",
  );
}

function renderTodoList(todos: ReadonlyArray<TodoItem>): string {
  if (todos.length === 0) {
    return `<p class="empty-state">No active items. Add one small thing, like “do not forget goat”.</p>`;
  }

  return `
    <ul class="todo-list" data-todo-list>
      ${todos.map(renderTodoCard).join("")}
    </ul>
  `;
}

function renderTodoCard(todo: TodoItem, index: number, todos: ReadonlyArray<TodoItem>): string {
  const primaryText = todo.title ?? todo.body;
  const bodyHtml = todo.title === null ? "" : `<p>${escapeHtml(todo.body)}</p>`;
  const isFirst = index === 0;
  const isLast = index === todos.length - 1;

  return `
    <li class="todo-card" data-todo-id="${escapeAttribute(todo.id)}">
      <button class="drag-handle" type="button" data-drag-handle aria-label="Drag to reorder ${escapeAttribute(primaryText)}">Grip</button>
      <article aria-labelledby="todo-${escapeAttribute(todo.id)}-heading">
        <h3 id="todo-${escapeAttribute(todo.id)}-heading">${escapeHtml(primaryText)}</h3>
        ${bodyHtml}
        <div class="todo-actions">
          <a href="/todos/${encodeURIComponent(todo.id)}/edit">Edit</a>
          <form action="/todos/${encodeURIComponent(todo.id)}/complete" method="post">
            <button type="submit" class="secondary">Complete</button>
          </form>
          <form action="/todos/${encodeURIComponent(todo.id)}/archive" method="post">
            <button type="submit" class="danger">Delete</button>
          </form>
          <form action="/todos/${encodeURIComponent(todo.id)}/move-up" method="post">
            <button type="submit" class="secondary" ${isFirst ? "disabled" : ""}>Move up</button>
          </form>
          <form action="/todos/${encodeURIComponent(todo.id)}/move-down" method="post">
            <button type="submit" class="secondary" ${isLast ? "disabled" : ""}>Move down</button>
          </form>
        </div>
      </article>
    </li>
  `;
}

function renderLayout(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>${renderStyles()}</style>
  </head>
  <body>
    ${body}
    ${script}
  </body>
</html>`;
}

function renderNotice(message: string | null, kind: "success" | "error"): string {
  if (message === null) {
    return "";
  }

  return `<p class="notice ${kind}">${escapeHtml(message)}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function renderStyles(): string {
  return `
    :root {
      --ink: #18211b;
      --muted: #667167;
      --paper: #fffaf0;
      --panel: #fffdf7;
      --accent: #1f7a4d;
      --accent-dark: #155936;
      --danger: #a8322a;
      --line: #ded4bd;
      --shadow: 0 20px 60px rgba(38, 32, 20, 0.16);
      color-scheme: light;
      font-family: ui-rounded, "Avenir Next", "Trebuchet MS", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(31, 122, 77, 0.20), transparent 32rem),
        linear-gradient(135deg, #fff8e8, #eaf2df);
    }

    a {
      color: var(--accent-dark);
      font-weight: 700;
    }

    button,
    .button-link {
      min-height: 2.75rem;
      border: 0;
      border-radius: 999px;
      padding: 0.75rem 1rem;
      color: white;
      background: var(--accent);
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    button:hover,
    .button-link:hover {
      background: var(--accent-dark);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .secondary {
      background: #eef3e6;
      color: var(--ink);
    }

    .danger {
      background: var(--danger);
    }

    input,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 1rem;
      padding: 0.85rem 1rem;
      background: white;
      color: var(--ink);
      font: inherit;
    }

    textarea {
      resize: vertical;
    }

    label {
      font-weight: 800;
    }

    .auth-shell,
    .app-shell {
      width: min(64rem, calc(100% - 2rem));
      margin: 0 auto;
      padding: 2rem 0;
    }

    .auth-shell {
      min-height: 100vh;
      display: grid;
      place-items: center;
    }

    .app-shell {
      display: grid;
      grid-template-columns: minmax(16rem, 22rem) 1fr;
      gap: 1rem;
    }

    .topbar {
      width: min(64rem, calc(100% - 2rem));
      margin: 0 auto;
      padding: 1rem 0 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .panel {
      border: 1px solid rgba(222, 212, 189, 0.85);
      border-radius: 1.75rem;
      padding: 1.25rem;
      background: rgba(255, 253, 247, 0.92);
      box-shadow: var(--shadow);
    }

    .stack {
      display: grid;
      gap: 0.65rem;
    }

    .eyebrow,
    .muted {
      color: var(--muted);
    }

    .eyebrow {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .user-email {
      margin: 0.1rem 0 0;
      font-weight: 900;
    }

    .notice {
      border-radius: 1rem;
      padding: 0.85rem 1rem;
      font-weight: 800;
    }

    .success {
      background: #dff1df;
    }

    .error {
      background: #ffe1dc;
      color: #731d18;
    }

    .list-heading,
    .button-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .todo-list {
      display: grid;
      gap: 0.85rem;
      padding: 0;
      margin: 1rem 0 0;
      list-style: none;
    }

    .todo-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.85rem;
      padding: 1rem;
      border: 1px solid var(--line);
      border-radius: 1.25rem;
      background: white;
    }

    .todo-card.dragging {
      opacity: 0.72;
      transform: rotate(-1deg) scale(1.01);
    }

    .drag-handle {
      align-self: start;
      min-height: auto;
      border-radius: 999px;
      padding: 0.55rem 0.7rem;
      background: #f1eadb;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 900;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }

    .todo-card h3 {
      margin: 0;
      font-size: clamp(1.05rem, 4vw, 1.35rem);
    }

    .todo-card p {
      margin: 0.4rem 0 0;
      color: #394239;
      white-space: pre-wrap;
    }

    .todo-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin-top: 0.85rem;
    }

    .todo-actions form {
      margin: 0;
    }

    .todo-actions button,
    .todo-actions a {
      min-height: 2.35rem;
      padding: 0.55rem 0.8rem;
      font-size: 0.9rem;
    }

    .empty-state {
      margin: 1rem 0 0;
      color: var(--muted);
      font-weight: 700;
    }

    @media (max-width: 760px) {
      .app-shell {
        grid-template-columns: 1fr;
      }

      .topbar,
      .list-heading,
      .button-row {
        align-items: stretch;
        flex-direction: column;
      }

      .todo-card {
        grid-template-columns: 1fr;
      }

      .drag-handle {
        width: fit-content;
      }
    }
  `;
}

function renderClientScript(): string {
  return `
    <script>
      const list = document.querySelector("[data-todo-list]");
      let draggingCard = null;
      let pointerId = null;
      let longPressTimer = 0;

      function cards() {
        return Array.from(document.querySelectorAll("[data-todo-id]"));
      }

      function persistOrder() {
        if (!list) {
          return;
        }

        const ids = cards().map((card) => card.dataset.todoId).filter(Boolean);
        fetch("/todos/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        }).then((response) => {
          if (!response.ok) {
            window.location.reload();
          }
        }).catch(() => window.location.reload());
      }

      function getAfterCard(y) {
        const candidates = cards().filter((card) => card !== draggingCard);
        let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

        for (const card of candidates) {
          const box = card.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;

          if (offset < 0 && offset > closest.offset) {
            closest = { offset, element: card };
          }
        }

        return closest.element;
      }

      function startDrag(card, event) {
        draggingCard = card;
        pointerId = event.pointerId;
        card.classList.add("dragging");
        card.setPointerCapture(event.pointerId);
      }

      if (list) {
        list.addEventListener("pointerdown", (event) => {
          const handle = event.target.closest("[data-drag-handle]");
          const card = event.target.closest("[data-todo-id]");

          if (!handle || !card) {
            return;
          }

          const delay = event.pointerType === "mouse" ? 0 : 350;
          longPressTimer = window.setTimeout(() => startDrag(card, event), delay);
        });

        list.addEventListener("pointermove", (event) => {
          if (!draggingCard || pointerId !== event.pointerId) {
            return;
          }

          event.preventDefault();
          const afterCard = getAfterCard(event.clientY);

          if (afterCard === null) {
            list.appendChild(draggingCard);
          } else {
            list.insertBefore(draggingCard, afterCard);
          }
        });

        list.addEventListener("pointerup", (event) => {
          window.clearTimeout(longPressTimer);

          if (!draggingCard || pointerId !== event.pointerId) {
            return;
          }

          draggingCard.classList.remove("dragging");
          draggingCard = null;
          pointerId = null;
          persistOrder();
        });

        list.addEventListener("pointercancel", () => {
          window.clearTimeout(longPressTimer);

          if (draggingCard) {
            draggingCard.classList.remove("dragging");
          }

          draggingCard = null;
          pointerId = null;
        });
      }
    </script>
  `;
}
