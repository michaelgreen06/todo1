import type { Folder, Item, ItemStatusChange, Status, User } from "./db.js";

export type LoginPageOptions = {
  readonly message: string | null;
  readonly error: string | null;
};

export type TodoPageOptions = {
  readonly user: User;
  readonly folder: Folder | null;
  readonly folders: ReadonlyArray<Folder>;
  readonly ancestors: ReadonlyArray<Folder>;
  readonly inboxCount: number;
  readonly todos: ReadonlyArray<Item>;
  readonly statuses: ReadonlyArray<Status>;
  readonly selectedStatusIds: ReadonlyArray<string>;
  readonly returnTo: string;
  readonly error: string | null;
};

export type EditPageOptions = {
  readonly todo: Item;
  readonly history: ReadonlyArray<ItemStatusChange>;
  readonly folders: ReadonlyArray<Folder>;
  readonly returnTo: string;
  readonly error: string | null;
};

export function renderLoginPage(options: LoginPageOptions): string {
  return renderLayout("Sign in", `
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
  `, "");
}

export function renderTodoPage(options: TodoPageOptions): string {
  const pageTitle = options.folder?.name ?? "Inbox";
  const currentFolderId = options.folder?.id ?? "";

  return renderLayout(pageTitle, `
    <header class="topbar">
      <div>
        <p class="eyebrow">Signed in as</p>
        <p class="user-email">${escapeHtml(options.user.email)}</p>
      </div>
      <form action="/logout" method="post"><button type="submit" class="secondary">Log out</button></form>
    </header>
    <div class="workspace">
      ${renderSidebar(options)}
      <main class="main-column">
        ${renderMobileLocationForm(options)}
        ${renderBreadcrumbs(options)}
        <section class="panel list-panel" aria-labelledby="todo-list-heading">
          <div class="list-heading">
            <div>
              <p class="eyebrow">${options.folder === null ? "Unfiled items" : "Direct folder items"}</p>
              <h1 id="todo-list-heading">${escapeHtml(pageTitle)}</h1>
            </div>
            <button type="button" class="secondary" data-open-create-dialog>Add item</button>
          </div>
          ${renderNotice(options.error, "error")}
          ${renderStatusFilter(options)}
          ${options.folder === null ? "" : renderFolderControls(options)}
          ${renderTodoList(options)}
        </section>
      </main>
    </div>
    ${renderCreateDialog(options.returnTo, currentFolderId)}
    ${renderStatusDialog(options.statuses, options.returnTo)}
    ${renderMoveDialog(options.folders, options.returnTo)}
  `, renderClientScript(options));
}

export function renderEditPage(options: EditPageOptions): string {
  return renderLayout("Edit todo", `
    <main class="auth-shell">
      <section class="panel panel-edit" aria-labelledby="edit-heading">
        <p class="eyebrow">Edit item</p>
        <h1 id="edit-heading">${escapeHtml(options.todo.title ?? options.todo.body)}</h1>
        ${renderNotice(options.error, "error")}
        <form action="/todos/${encodeURIComponent(options.todo.id)}" method="post" class="stack">
          ${renderHidden("returnTo", options.returnTo)}
          <label for="title">Title <span class="muted">(optional)</span></label>
          <input id="title" name="title" type="text" maxlength="160" value="${escapeAttribute(options.todo.title ?? "")}">
          <label for="body">Description</label>
          <textarea id="body" name="body" rows="7" required>${escapeHtml(options.todo.body)}</textarea>
          <label for="folderId">Folder</label>
          <select id="folderId" name="folderId">
            <option value="">Inbox</option>
            ${renderFolderOptions(options.folders, options.todo.nodeId)}
          </select>
          <div class="button-row">
            <button type="submit">Save changes</button>
            <a href="${escapeAttribute(options.returnTo)}" class="button-link secondary">Cancel</a>
          </div>
        </form>
        ${renderStatusTimeline(options.history)}
      </section>
    </main>
  `, "");
}

export function renderNotFoundPage(): string {
  return renderLayout("Not found", `
    <main class="auth-shell">
      <section class="panel">
        <h1>Not found</h1>
        <p>The page, folder, or item does not exist.</p>
        <a href="/" class="button-link">Go to Inbox</a>
      </section>
    </main>
  `, "");
}

function renderSidebar(options: TodoPageOptions): string {
  const ancestorIds = new Set(options.ancestors.map((folder) => folder.id));
  const roots = options.folders.filter((folder) => folder.parentId === null);

  return `
    <aside class="panel sidebar" aria-labelledby="folder-navigation-heading">
      <h2 id="folder-navigation-heading">Folders</h2>
      <nav aria-label="Folder navigation">
        <a class="folder-link ${options.folder === null ? "selected" : ""}" href="${escapeAttribute(locationUrl(null, options.selectedStatusIds))}">
          <span>Inbox</span><span>${options.inboxCount.toString()}</span>
        </a>
        <ul class="folder-tree">${roots.map((folder) => renderFolderBranch(folder, options, ancestorIds)).join("")}</ul>
      </nav>
      <form action="/folders" method="post" class="stack folder-create">
        ${renderHidden("returnTo", options.returnTo)}
        <label for="sidebar-folder-path">Add folder path</label>
        <input id="sidebar-folder-path" name="folderPath" type="text" placeholder="Meetings / Regen Hub" required>
        <button type="submit">Add folder</button>
      </form>
    </aside>
  `;
}

function renderFolderBranch(folder: Folder, options: TodoPageOptions, ancestorIds: ReadonlySet<string>): string {
  const children = options.folders.filter((candidate) => candidate.parentId === folder.id);
  const link = `
    <a class="folder-link ${options.folder?.id === folder.id ? "selected" : ""}" href="${escapeAttribute(locationUrl(folder.id, options.selectedStatusIds))}">
      <span>${escapeHtml(folder.name)}</span><span>${folder.directItemCount.toString()}</span>
    </a>
  `;

  if (children.length === 0) {
    return `<li>${link}</li>`;
  }

  return `
    <li>
      <details ${ancestorIds.has(folder.id) ? "open" : ""}>
        <summary>${link}</summary>
        <ul>${children.map((child) => renderFolderBranch(child, options, ancestorIds)).join("")}</ul>
      </details>
    </li>
  `;
}

function renderMobileLocationForm(options: TodoPageOptions): string {
  return `
    <form action="/navigate" method="get" class="panel mobile-location">
      <label for="mobile-folder-id">Location</label>
      <select id="mobile-folder-id" name="folderId">
        <option value="" ${options.folder === null ? "selected" : ""}>Inbox</option>
        ${renderFolderOptions(options.folders, options.folder?.id ?? null)}
      </select>
      ${options.selectedStatusIds.map((id) => renderHidden("status", id)).join("")}
      <button type="submit">Go</button>
    </form>
  `;
}

function renderBreadcrumbs(options: TodoPageOptions): string {
  if (options.folder === null) {
    return "";
  }

  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="${escapeAttribute(locationUrl(null, options.selectedStatusIds))}">Inbox</a></li>
        ${options.ancestors.map((folder) => `
          <li><a href="${escapeAttribute(locationUrl(folder.id, options.selectedStatusIds))}">${escapeHtml(folder.name)}</a></li>
        `).join("")}
      </ol>
    </nav>
  `;
}

function renderStatusFilter(options: TodoPageOptions): string {
  return `
    <form action="${escapeAttribute(options.folder === null ? "/" : `/folders/${encodeURIComponent(options.folder.id)}`)}" method="get" class="filter-form">
      <fieldset>
        <legend>Show statuses</legend>
        ${options.statuses.map((status) => `
          <label><input name="status" type="checkbox" value="${escapeAttribute(status.id)}" ${options.selectedStatusIds.includes(status.id) ? "checked" : ""}> ${escapeHtml(status.name)}</label>
        `).join("")}
      </fieldset>
      <button type="submit" class="secondary">Apply filters</button>
    </form>
  `;
}

function renderFolderControls(options: TodoPageOptions): string {
  const folder = options.folder;

  if (folder === null) {
    return "";
  }

  return `
    <details class="folder-controls">
      <summary>Folder settings</summary>
      <div class="folder-control-grid">
        <form action="/folders/${encodeURIComponent(folder.id)}/rename" method="post" class="stack">
          ${renderHidden("returnTo", options.returnTo)}
          <label for="folder-name">Rename folder</label>
          <input id="folder-name" name="name" type="text" value="${escapeAttribute(folder.name)}" required>
          <button type="submit" class="secondary">Rename</button>
        </form>
        <form action="/folders/${encodeURIComponent(folder.id)}/delete" method="post" class="stack">
          ${renderHidden("returnTo", options.returnTo)}
          <p class="muted">Only empty folders without child folders can be deleted.</p>
          <button type="submit" class="danger">Delete folder</button>
        </form>
      </div>
    </details>
  `;
}

function renderTodoList(options: TodoPageOptions): string {
  if (options.todos.length === 0) {
    return `<p class="empty-state">No matching items in this location.</p>`;
  }

  return `<ul class="todo-list" data-todo-list>${options.todos.map((todo, index) => renderTodoCard(todo, index, options)).join("")}</ul>`;
}

function renderTodoCard(todo: Item, index: number, options: TodoPageOptions): string {
  const primaryText = todo.title ?? todo.body;
  const bodyHtml = todo.title === null ? "" : `<p class="todo-description">${escapeHtml(todo.body)}</p>`;
  const detailsId = `todo-${todo.id}-details`;
  const toggleId = `todo-${todo.id}-toggle`;

  return `
    <li class="todo-card" data-todo-id="${escapeAttribute(todo.id)}">
      <button class="drag-handle" type="button" data-drag-handle aria-label="Drag to reorder ${escapeAttribute(primaryText)}">Grip</button>
      <article aria-labelledby="todo-${escapeAttribute(todo.id)}-heading">
        <div class="todo-summary">
          <div class="todo-heading-group">
            <p class="status-pill">${escapeHtml(todo.statusName)}</p>
            <h2 id="todo-${escapeAttribute(todo.id)}-heading" class="todo-title">${escapeHtml(primaryText)}</h2>
          </div>
          <button
            id="${escapeAttribute(toggleId)}"
            class="secondary todo-toggle"
            type="button"
            data-toggle-todo
            aria-expanded="false"
            aria-controls="${escapeAttribute(detailsId)}"
          >
            Expand
          </button>
        </div>
        <div id="${escapeAttribute(detailsId)}" class="todo-details" hidden>
          ${bodyHtml}
          <div class="todo-actions">
            <a href="/todos/${encodeURIComponent(todo.id)}/edit?returnTo=${encodeURIComponent(options.returnTo)}">Edit</a>
            <button type="button" class="secondary" data-open-status-dialog data-item-id="${escapeAttribute(todo.id)}" data-item-label="${escapeAttribute(primaryText)}">Status</button>
            <button type="button" class="secondary" data-open-move-dialog data-item-id="${escapeAttribute(todo.id)}" data-item-label="${escapeAttribute(primaryText)}" data-folder-id="${escapeAttribute(todo.nodeId ?? "")}">Move</button>
            <form action="/todos/${encodeURIComponent(todo.id)}/move-up" method="post">
              ${renderHidden("returnTo", options.returnTo)}
              <button type="submit" class="secondary" ${index === 0 ? "disabled" : ""}>Move up</button>
            </form>
            <form action="/todos/${encodeURIComponent(todo.id)}/move-down" method="post">
              ${renderHidden("returnTo", options.returnTo)}
              <button type="submit" class="secondary" ${index === options.todos.length - 1 ? "disabled" : ""}>Move down</button>
            </form>
          </div>
        </div>
      </article>
    </li>
  `;
}

function renderCreateDialog(returnTo: string, folderId: string): string {
  return `
    <dialog class="modal-shell" data-create-dialog aria-labelledby="new-todo-heading">
      <section class="panel panel-edit">
        <div class="modal-heading"><h1 id="new-todo-heading">Add item</h1><button type="button" class="secondary" data-close-create-dialog>Close</button></div>
        <form action="/todos" method="post" class="stack">
          ${renderHidden("returnTo", returnTo)}
          ${renderHidden("folderId", folderId)}
          <label for="title">Title <span class="muted">(optional)</span></label>
          <input id="title" name="title" type="text" maxlength="160">
          <label for="body">Description</label>
          <textarea id="body" name="body" rows="7" required></textarea>
          <div class="button-row"><button type="submit">Add todo</button><button type="button" class="secondary" data-close-create-dialog>Cancel</button></div>
        </form>
      </section>
    </dialog>
  `;
}

function renderStatusDialog(statuses: ReadonlyArray<Status>, returnTo: string): string {
  return `
    <dialog class="modal-shell" data-status-dialog aria-labelledby="status-dialog-heading">
      <section class="panel panel-edit">
        <div class="modal-heading"><h1 id="status-dialog-heading">Change status</h1><button type="button" class="secondary" data-close-status-dialog>Close</button></div>
        <p class="muted" data-status-item-label></p>
        <form method="post" class="stack" data-status-form>
          ${renderHidden("returnTo", returnTo)}
          <label for="statusId">Status</label>
          <select id="statusId" name="statusId" required>${statuses.map((status) => `<option value="${escapeAttribute(status.id)}">${escapeHtml(status.name)}</option>`).join("")}</select>
          <label for="note">Note <span class="muted">(optional)</span></label>
          <textarea id="note" name="note" rows="4" maxlength="2000"></textarea>
          <div class="button-row"><button type="submit">Save status</button><button type="button" class="secondary" data-close-status-dialog>Cancel</button></div>
        </form>
      </section>
    </dialog>
  `;
}

function renderMoveDialog(folders: ReadonlyArray<Folder>, returnTo: string): string {
  return `
    <dialog class="modal-shell" data-move-dialog aria-labelledby="move-dialog-heading">
      <section class="panel panel-edit">
        <div class="modal-heading"><h1 id="move-dialog-heading">Move item</h1><button type="button" class="secondary" data-close-move-dialog>Close</button></div>
        <p class="muted" data-move-item-label></p>
        <form method="post" class="stack" data-move-form>
          ${renderHidden("returnTo", returnTo)}
          <label for="move-folder-id">Existing location</label>
          <select id="move-folder-id" name="folderId"><option value="">Inbox</option>${renderFolderOptions(folders, null)}</select>
          <label for="folderPath">Or create absolute folder path <span class="muted">(optional)</span></label>
          <input id="folderPath" name="folderPath" type="text" placeholder="Errands / Costco">
          <div class="button-row"><button type="submit">Move item</button><button type="button" class="secondary" data-close-move-dialog>Cancel</button></div>
        </form>
      </section>
    </dialog>
  `;
}

function renderFolderOptions(folders: ReadonlyArray<Folder>, selectedId: string | null): string {
  const byParent = new Map<string | null, Array<Folder>>();

  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }

  function renderChildren(parentId: string | null, depth: number): string {
    return (byParent.get(parentId) ?? []).map((folder) => {
      const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}- `;
      return `<option value="${escapeAttribute(folder.id)}" ${folder.id === selectedId ? "selected" : ""}>${escapeHtml(prefix + folder.name)}</option>${renderChildren(folder.id, depth + 1)}`;
    }).join("");
  }

  return renderChildren(null, 0);
}

function renderStatusTimeline(history: ReadonlyArray<ItemStatusChange>): string {
  return `
    <section class="status-history" aria-labelledby="status-history-heading">
      <h2 id="status-history-heading">Status timeline</h2>
      <ol>${history.map((change) => {
        const transition = change.fromStatusName === null ? `Created as ${change.toStatusName}` : `${change.fromStatusName} to ${change.toStatusName}`;
        return `<li><p><strong>${escapeHtml(transition)}</strong></p><time datetime="${escapeAttribute(change.changedAt)}">${escapeHtml(formatTimestamp(change.changedAt))}</time>${change.note === null ? "" : `<p>${escapeHtml(change.note)}</p>`}</li>`;
      }).join("")}</ol>
    </section>
  `;
}

function renderHidden(name: string, value: string): string {
  return `<input name="${escapeAttribute(name)}" type="hidden" value="${escapeAttribute(value)}">`;
}

function locationUrl(folderId: string | null, statusIds: ReadonlyArray<string>): string {
  const query = new URLSearchParams();
  for (const id of statusIds) query.append("status", id);
  return `${folderId === null ? "/" : `/folders/${encodeURIComponent(folderId)}`}?${query.toString()}`;
}

function renderLayout(title: string, body: string, script: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${renderStyles()}</style></head><body>${body}${script}</body></html>`;
}

function renderNotice(message: string | null, kind: "success" | "error"): string {
  return message === null ? "" : `<p class="notice ${kind}">${escapeHtml(message)}</p>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function renderStyles(): string {
  return `
    :root{--ink:#18211b;--muted:#667167;--panel:#fffdf7;--accent:#1f7a4d;--accent-dark:#155936;--danger:#a8322a;--line:#ded4bd;--shadow:0 20px 60px rgba(38,32,20,.16);font-family:ui-rounded,"Avenir Next","Trebuchet MS",sans-serif;color:var(--ink)}*{box-sizing:border-box}body{min-height:100vh;margin:0;background:radial-gradient(circle at top left,rgba(31,122,77,.2),transparent 32rem),linear-gradient(135deg,#fff8e8,#eaf2df)}a{color:var(--accent-dark);font-weight:700}button,.button-link{min-height:2.6rem;border:0;border-radius:999px;padding:.7rem 1rem;color:white;background:var(--accent);font:inherit;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}button:hover,.button-link:hover{background:var(--accent-dark)}button:disabled{cursor:not-allowed;opacity:.45}.secondary{background:#eef3e6;color:var(--ink)}.danger{background:var(--danger)}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:1rem;padding:.8rem 1rem;background:white;color:var(--ink);font:inherit}label,legend{font-weight:800}.auth-shell{min-height:100vh;display:grid;place-items:center;width:min(64rem,calc(100% - 2rem));margin:auto}.topbar,.workspace{width:min(76rem,calc(100% - 2rem));margin:auto}.topbar{padding:1rem 0;display:flex;justify-content:space-between;align-items:center}.workspace{display:grid;grid-template-columns:17rem minmax(0,1fr);gap:1rem;padding-bottom:2rem}.panel{border:1px solid rgba(222,212,189,.85);border-radius:1.5rem;padding:1.2rem;background:rgba(255,253,247,.94);box-shadow:var(--shadow)}.panel-edit{width:min(42rem,100%)}.stack{display:grid;gap:.65rem}.eyebrow,.muted{color:var(--muted)}.eyebrow,.user-email{margin:0}.eyebrow{font-size:.75rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.user-email{font-weight:900}.sidebar h2{margin-top:0}.folder-link{display:flex;justify-content:space-between;gap:.5rem;padding:.45rem .55rem;border-radius:.65rem;text-decoration:none}.folder-link.selected{background:#dff1df}.folder-tree,.folder-tree ul{list-style:none;padding-left:.85rem;margin:.25rem 0}.folder-tree{padding-left:0}.folder-tree summary{cursor:pointer}.folder-tree summary::marker{color:var(--muted)}.folder-tree summary .folder-link{display:inline-flex;width:calc(100% - 1rem)}.folder-create{margin-top:1.2rem}.main-column{min-width:0}.breadcrumbs ol{display:flex;flex-wrap:wrap;gap:.4rem;list-style:none;padding:0;margin:.2rem 0 .8rem}.breadcrumbs li+li::before{content:"/";padding-right:.4rem;color:var(--muted)}.list-heading,.button-row,.modal-heading{display:flex;align-items:center;justify-content:space-between;gap:.8rem}.list-heading h1{margin:.15rem 0}.filter-form{display:flex;align-items:end;gap:1rem;padding:.8rem 0;border-bottom:1px solid var(--line)}.filter-form fieldset{display:flex;flex-wrap:wrap;gap:.7rem;border:0;padding:0;margin:0}.filter-form legend{margin-bottom:.4rem}.filter-form input{width:auto}.folder-controls{padding:.8rem 0;border-bottom:1px solid var(--line)}.folder-control-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;padding-top:.7rem}.todo-list{display:grid;gap:.8rem;padding:0;margin:1rem 0 0;list-style:none}.todo-card{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.75rem;padding:1rem;border:1px solid var(--line);border-radius:1.15rem;background:white}.drag-handle{align-self:start;min-height:auto;padding:.5rem .65rem;background:#f1eadb;color:var(--muted);cursor:grab;touch-action:none}.todo-summary{display:flex;align-items:start;justify-content:space-between;gap:.8rem}.todo-heading-group{min-width:0}.todo-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:.15rem 0;font-size:1.2rem}.todo-toggle{flex-shrink:0;min-height:2.2rem;padding:.45rem .8rem;font-size:.88rem}.todo-details{margin-top:.65rem}.todo-description{margin:.35rem 0 0;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.status-pill{margin:0;color:var(--muted);font-size:.78rem;font-weight:900;text-transform:uppercase}.todo-actions{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-top:.7rem}.todo-actions button,.todo-actions a{min-height:2.2rem;padding:.45rem .7rem;font-size:.88rem}.empty-state{color:var(--muted);font-weight:700}.notice{border-radius:1rem;padding:.75rem 1rem;font-weight:800}.success{background:#dff1df}.error{background:#ffe1dc;color:#731d18}.modal-shell{width:min(44rem,calc(100% - 1rem));max-width:none;border:0;padding:0;background:transparent}.modal-shell::backdrop{background:rgba(24,33,27,.32);backdrop-filter:blur(.25rem)}.status-history{margin-top:2rem}.status-history p{margin:.2rem 0}.status-history time{color:var(--muted);font-size:.9rem}.mobile-location{display:none}
    @media(max-width:760px){.workspace{display:block}.sidebar{display:none}.mobile-location{display:grid;grid-template-columns:1fr auto;gap:.5rem;margin-bottom:.8rem}.mobile-location label{grid-column:1/-1}.topbar,.list-heading,.button-row,.modal-heading,.filter-form,.todo-summary{align-items:stretch;flex-direction:column}.folder-control-grid{grid-template-columns:1fr}.todo-card{grid-template-columns:1fr}.drag-handle,.todo-toggle{width:fit-content}}
  `;
}

function renderClientScript(options: TodoPageOptions): string {
  const reorderQuery = new URLSearchParams();
  reorderQuery.set("folderId", options.folder?.id ?? "");
  for (const id of options.selectedStatusIds) reorderQuery.append("status", id);
  const reorderUrl = `/todos/reorder?${reorderQuery.toString()}`;

  return `
    <script>
      const list=document.querySelector("[data-todo-list]");
      document.querySelectorAll("[data-toggle-todo]").forEach((button)=>button.addEventListener("click",()=>{if(!(button instanceof HTMLButtonElement))return;const detailsId=button.getAttribute("aria-controls");if(detailsId===null)return;const details=document.getElementById(detailsId);if(details===null)return;const isExpanded=button.getAttribute("aria-expanded")==="true";button.setAttribute("aria-expanded",String(!isExpanded));button.textContent=isExpanded?"Expand":"Collapse";details.hidden=isExpanded}));
      function wireDialog(name,actionSuffix){const dialog=document.querySelector("[data-"+name+"-dialog]");const form=document.querySelector("[data-"+name+"-form]");const label=document.querySelector("[data-"+name+"-item-label]");document.querySelectorAll("[data-open-"+name+"-dialog]").forEach((button)=>button.addEventListener("click",()=>{if(!(dialog instanceof HTMLDialogElement)||!(form instanceof HTMLFormElement)||!(button instanceof HTMLButtonElement))return;form.action="/todos/"+encodeURIComponent(button.dataset.itemId||"")+"/"+actionSuffix;if(label)label.textContent=button.dataset.itemLabel||"";if(name==="move"){const select=document.querySelector("#move-folder-id");if(select instanceof HTMLSelectElement)select.value=button.dataset.folderId||"";}dialog.showModal()}));document.querySelectorAll("[data-close-"+name+"-dialog]").forEach((button)=>button.addEventListener("click",()=>{if(dialog instanceof HTMLDialogElement)dialog.close()}))}
      wireDialog("status","status");wireDialog("move","location");
      const createDialog=document.querySelector("[data-create-dialog]");document.querySelectorAll("[data-open-create-dialog]").forEach((button)=>button.addEventListener("click",()=>{if(createDialog instanceof HTMLDialogElement)createDialog.showModal()}));document.querySelectorAll("[data-close-create-dialog]").forEach((button)=>button.addEventListener("click",()=>{if(createDialog instanceof HTMLDialogElement)createDialog.close()}));
      let dragging=null,pointerId=null,longPressTimer=0;function cards(){return Array.from(document.querySelectorAll("[data-todo-id]"))}function persist(card){const ordered=cards(),index=ordered.indexOf(card),previous=ordered[index-1],next=ordered[index+1];fetch(${JSON.stringify(reorderUrl)},{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({movedId:card.dataset.todoId||"",previousId:previous?previous.dataset.todoId||null:null,nextId:next?next.dataset.todoId||null:null})}).then((response)=>{if(!response.ok)location.reload()}).catch(()=>location.reload())}function afterCard(y){let closest={offset:Number.NEGATIVE_INFINITY,element:null};for(const card of cards().filter((candidate)=>candidate!==dragging)){const box=card.getBoundingClientRect(),offset=y-box.top-box.height/2;if(offset<0&&offset>closest.offset)closest={offset,element:card}}return closest.element}function finish(event){clearTimeout(longPressTimer);if(!dragging||pointerId!==event.pointerId)return;dragging.classList.remove("dragging");dragging.releasePointerCapture(event.pointerId);persist(dragging);dragging=null;pointerId=null}if(list){list.addEventListener("pointerdown",(event)=>{const handle=event.target.closest("[data-drag-handle]"),card=event.target.closest("[data-todo-id]");if(!handle||!card)return;longPressTimer=setTimeout(()=>{dragging=card;pointerId=event.pointerId;card.classList.add("dragging");card.setPointerCapture(event.pointerId)},event.pointerType==="mouse"?0:350)});list.addEventListener("pointermove",(event)=>{if(!dragging||pointerId!==event.pointerId)return;event.preventDefault();const after=afterCard(event.clientY);if(after===null)list.appendChild(dragging);else list.insertBefore(dragging,after)});list.addEventListener("pointerup",finish);list.addEventListener("pointercancel",finish)}
    </script>
  `;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}
