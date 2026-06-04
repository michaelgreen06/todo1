# React Workspace Migration PRD

## Purpose

Migrate the authenticated todo workspace from server-rendered HTML plus inline JavaScript to a Vite React TypeScript frontend. Preserve the current user-facing behavior and visual design as much as practical. The goal is to create a maintainable frontend foundation for upcoming workspace features such as bulk status changes, inline editing, mobile gestures, and swipe actions on cards.

Login, magic-link auth, logout, capture ingestion, database access, and existing backend domain logic should remain in the current Node server.

## Agent Architecture

Use a team of agents with explicit model expectations:

- Main coordinator: GPT-5.5 high only for hard planning, architecture, final review, and merge decisions.
- Default coordinator: GPT-5.5 medium for most orchestration turns.
- codebase-mapper: GPT-5.4-mini or GPT-5.4 medium, read-only, background OK.
- test-runner: GPT-5.4-mini or GPT-5.4 medium, Bash allowed, no edits, background OK.
- bug-hunter: GPT-5.4 medium or GPT-5.5 medium, foreground if permissions are likely needed.
- implementer: GPT-5.5 medium, isolated worktree preferred.
- reviewer: GPT-5.5 medium or GPT-5.5 high depending on risk.

Escalate to GPT-5.5 high only when a subagent gets stuck, makes cross-file design decisions, or needs deep architecture reasoning. Use weaker and cheaper subagents for discovery. Use the strongest model for final integration review.

## Goals

- Keep SSR login working.
- Convert the authenticated workspace to React.
- Preserve current workspace behavior.
- Preserve the current visual design initially.
- Add typed JSON APIs for the React workspace.
- Keep old SSR workspace routes temporarily as a fallback.
- Add TODO comments in code identifying fallback SSR paths to remove after the React workspace is stable.
- Use React state for workspace navigation/filtering instead of query params.
- Leave inline edit for a later feature.
- Add minimal Playwright coverage for one authenticated workspace smoke test.

## Non-Goals

- Full UI redesign.
- Next.js migration.
- Optimistic updates by default.
- Offline support.
- Inline edit in the initial migration.
- Full gesture/swipe implementation in the initial migration.
- Complex drag-and-drop between folders or status lanes.
- Removing SSR workspace code immediately.

## Tech Stack

- Vite
- React
- TypeScript
- Zod for API response validation
- Vitest for frontend tests
- Testing Library for component/user interaction tests
- Playwright for one minimal authenticated workspace smoke test

Future gesture features may add:

- `@use-gesture/react`
- `motion`

Do not add gesture dependencies until the first swipe feature unless implementation clearly benefits from adding them during migration.

## Current System Summary

The current backend is a hand-rolled Node HTTP server in `src/server.ts`. The current workspace is rendered in `src/html.ts`, including:

- folder sidebar
- mobile location selector
- breadcrumbs
- status filters
- folder controls
- todo list
- todo cards
- create dialog
- status dialog
- move dialog
- bulk selection toolbar
- inline client script for dialogs, selection, expansion, and reorder

Core data/domain behavior lives in `src/db.ts`. Form validation lives in `src/validation.ts`.

## Target Architecture

Add a Vite frontend under:

```text
frontend/
  index.html
  vite.config.ts
  src/
    main.tsx
    api/
    app/
    components/
    domain/
    state/
    styles/
```

Recommended frontend modules:

```text
frontend/src/api/
  api-client.ts
  schemas.ts

frontend/src/app/
  WorkspaceApp.tsx

frontend/src/components/
  Breadcrumbs.tsx
  BulkActions.tsx
  CreateTodoDialog.tsx
  FolderControls.tsx
  FolderSidebar.tsx
  MobileLocationSelect.tsx
  MoveDialog.tsx
  StatusDialog.tsx
  StatusFilter.tsx
  TodoCard.tsx
  TodoList.tsx

frontend/src/domain/
  todo-types.ts

frontend/src/state/
  workspace-reducer.ts

frontend/src/styles/
  workspace.css
```

Keep styles close to the current embedded CSS initially. Redesign later when concrete pain points are known.

## Backend API Requirements

Add JSON endpoints under `/api/*`. All endpoints must require the existing authenticated session unless explicitly stated otherwise.

Minimum endpoints:

- `GET /api/workspace`
- `POST /api/todos`
- `PATCH /api/todos/:id`
- `POST /api/todos/:id/status`
- `POST /api/todos/:id/location`
- `POST /api/todos/bulk/location`
- `POST /api/todos/reorder`
- `POST /api/folders`
- `POST /api/folders/:id/rename`
- `POST /api/folders/:id/delete`

The initial `GET /api/workspace` response should include:

- signed-in user summary
- current folder tree
- current selected folder ID from server default or frontend request body/query
- statuses
- selected status IDs from frontend state
- todos for selected state
- ancestors for selected folder
- inbox count

Because workspace navigation/filtering will use React state, the API may accept state through request parameters or request bodies, but React should own the active state. Do not rely on browser query params for workspace navigation.

## API Validation Rules

- Treat all request bodies as untrusted.
- Treat all response bodies in the frontend as untrusted.
- Use Zod in the frontend API client.
- Reuse or extend existing backend validation helpers.
- Do not use `any`.
- Do not use type assertions unless no safer alternative exists.
- Validate item ownership before mutation side effects.
- For bulk operations, validate every selected item belongs to the user before creating folders or applying any mutation.

## SSR Fallback Policy

Keep old SSR workspace behavior temporarily while the React workspace stabilizes.

When preserving old SSR code paths, add explicit TODO comments such as:

```ts
// TODO: Remove this SSR workspace fallback after the React workspace is stable.
```

Fallback code may remain for:

- old `renderTodoPage`
- old workspace form routes
- `/todos/:id/edit` SSR edit page

Do not remove SSR login.

## Frontend State Requirements

React should own:

- selected folder ID
- selected status IDs
- loaded todos
- loaded folders
- selected todo IDs for bulk actions
- active dialog
- dialog form draft state
- expanded/collapsed card text state
- reorder pending/error state

Do not implement optimistic updates unless the implementation is clearly simpler than waiting for server confirmation. Default behavior should wait for the server, then reload or patch React state from confirmed responses.

## Current Behavior To Preserve

- User can see Inbox by default.
- User can navigate folders.
- User can use the mobile location selector.
- User can filter by statuses.
- User can create folders.
- User can rename/delete eligible folders.
- User can create todos.
- User can change todo status with optional note.
- User can move one todo.
- User can select multiple todos and move them together.
- User can expand/collapse long todo text.
- User can reorder visible todos.
- User can log out.

## Future Feature Readiness

The migration should make these features straightforward later:

- bulk status change
- bulk archive/delete
- inline edit
- mobile-friendly drag and drop
- per-card swipe gestures
- status-age-based task surfacing
- richer review workflows

Do not implement these during the migration unless they are required to preserve current behavior.

## Testing Requirements

Keep current backend tests green.

Existing commands:

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

Add frontend test tooling:

- Vitest
- Testing Library
- user-event
- jsdom

Suggested scripts:

```json
{
  "test:backend": "npm run build && node --test test/*.test.mjs",
  "test:frontend": "vitest run",
  "test:e2e": "playwright test",
  "test": "npm run test:backend && npm run test:frontend",
  "check": "npm run typecheck && npm run lint && npm run build && npm run test:frontend"
}
```

Add frontend tests for:

- selected item state
- select all behavior
- bulk action enable/disable
- dialog open/close state
- API schema validation
- basic workspace reducer transitions

Add one minimal Playwright smoke test:

- create or inject an authenticated test session
- open the workspace
- verify todos render
- select two todos
- perform bulk move
- verify the moved items appear in the destination or no longer appear in Inbox

Keep Playwright minimal unless large errors appear.

## Development Serving

Development may run:

- backend on `127.0.0.1:3000`
- Vite dev server on another port
- Vite proxy for `/api/*`, `/login`, `/auth/*`, and `/logout`

Production should allow the Node server to serve the built Vite assets.

## Implementation Phases

### Phase 1: API Contract And Backend Endpoints

Owner: implementer.

Tasks:

- Add `/api/*` routes.
- Add JSON request parsing helpers.
- Add response helpers.
- Add API validation.
- Add backend tests for API equivalents of current SSR form behavior.

Acceptance:

- Existing SSR routes still work.
- New API endpoint tests pass.
- Ownership protections match current behavior.

### Phase 2: Vite React Scaffold

Owner: implementer.

Tasks:

- Add `frontend/` scaffold.
- Add React/Vite dependencies.
- Add frontend TypeScript config if needed.
- Add frontend test setup.
- Add API client shell and Zod schemas.

Acceptance:

- Frontend builds.
- Frontend tests can run.
- No TypeScript or lint failures.

### Phase 3: Workspace Component Port

Owner: implementer.

Tasks:

- Port current workspace markup into React components.
- Move current CSS into frontend stylesheet.
- Preserve visual structure.
- Wire API loading and mutation behavior.
- Use React state for folder/status selection.

Acceptance:

- Current workspace behaviors work in React.
- No intentional visual redesign.
- Bulk move works.
- Reorder works.

### Phase 4: Server Integration

Owner: implementer.

Tasks:

- Serve React workspace shell for authenticated workspace route.
- Serve Vite built assets in production.
- Keep SSR login.
- Keep SSR workspace fallback with TODO deletion comments.

Acceptance:

- Unauthenticated user still redirects to `/login`.
- Authenticated user reaches React workspace.
- SSR fallback remains available or isolated.

### Phase 5: Verification

Owner: test-runner and reviewer.

Tasks:

- Run backend tests.
- Run frontend tests.
- Run one minimal Playwright smoke.
- Run typecheck, lint, and build.

Acceptance:

- All required checks pass.
- Any known limitation is documented.

### Phase 6: Final Review

Owner: main coordinator, GPT-5.5 high.

Review:

- type safety
- auth behavior
- ownership protections
- mutation ordering
- fallback TODOs
- future feature extension points
- no accidental visual redesign

## Release Gate

Before merge:

```sh
npm run typecheck
npm run lint
npm run build
npm run test:backend
npm run test:frontend
npm run test:e2e
```

If `test:e2e` cannot run in the environment, document why and perform a manual workspace smoke test.

## Open Questions

- Should the React workspace initially mount at `/` only, or should a separate temporary route such as `/workspace` be used during development?
- Should the server keep both old SSR workspace and React workspace behind a temporary feature flag?
- Should API response schemas live only in `frontend/src/api/schemas.ts`, or should shared schemas be moved into a top-level shared module later?
