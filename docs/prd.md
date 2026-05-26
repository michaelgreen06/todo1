# Todo MVP PRD

## Summary

Build a minimal multi-user todo web app. Users sign in with email-based magic links generated in the terminal for the MVP. Each user has one global todo list. Todo items can be created, edited, completed, deleted, and reordered on desktop and mobile.

The implementation should prioritize simplicity, type safety, and accessible HTML over framework complexity.

## Goals

- Let any user sign up or sign in with an email address.
- Generate magic auth links in the terminal instead of sending real email.
- Keep users isolated so each user only sees their own todo items.
- Store users, sessions, login tokens, and todo items in a local SQLite database.
- Support creating, editing, completing, soft-deleting, and reordering todo items.
- Provide a mobile-compatible UI with touch-friendly controls.
- Keep the MVP deployable later, but optimize first for local development.

## Non-Goals

- Real email delivery.
- Multiple lists per user.
- Tags.
- Nested tasks or projects.
- Offline support.
- Team sharing or collaboration.
- Production deployment setup.
- Password-based authentication.

## Users

### Anonymous Visitor

- Can enter an email address to request a magic login link.
- Cannot view or mutate todo data.

### Authenticated User

- Can view their active todo items.
- Can create todo items.
- Can edit todo items.
- Can complete todo items.
- Can soft-delete todo items.
- Can reorder active todo items.
- Can log out.

## Functional Requirements

### Authentication

- The login page must ask for an email address.
- Email addresses must be normalized to lowercase before lookup or storage.
- Anyone with an email address may sign up.
- If the submitted email does not exist, create a new user.
- Create a one-use magic login token.
- Magic login tokens expire after 30 minutes.
- The app must print the magic login URL to the terminal for the MVP.
- Visiting a valid magic login URL must create a session and mark the token as used.
- Sessions expire after 30 days.
- Users must be able to log out.
- Logout must invalidate the current session.

### Todo Items

- A todo item must have a required description/body.
- A todo item may have an optional title.
- Whitespace-only descriptions must be rejected.
- If an item has no title, the UI should display the description as the primary visible text.
- Todo items must have a database-backed status.
- Initial item status is `active`.
- Completing an item changes its status to `completed`.
- Deleting an item changes its status to `archived`.
- Completed and archived items are hidden from the main list.
- Users can edit item title and description after creation.
- Edits must preserve the item status and list position unless explicitly changed by another action.

### Ordering

- Ordering applies only to active items in a user's single global list.
- Each todo item stores a `sort_order` integer.
- New active items are appended after the user's existing active items.
- Reordering active items updates their `sort_order` values.
- Completed and archived items may keep their previous `sort_order`, but they are ignored by the active list ordering.
- The server should treat submitted reorder payloads as untrusted input and verify that all reordered IDs belong to the current user and are active.
- The simplest acceptable implementation is to renumber all active items for the user after a reorder.

### Reordering UI

- Each todo item should be its own card-like UI element.
- Desktop users should be able to drag and reorder items.
- Mobile users should be able to long-press and drag items.
- The UI must include non-drag fallback controls for reordering, such as move up and move down buttons.
- Reordering should not require a page reload if simple client-side JavaScript can avoid it.
- If JavaScript fails, the fallback controls should still allow ordering where practical.

### Editing UI

- The easiest acceptable editing approach is a simple edit form per item or a separate edit screen.
- The form must allow editing optional title and required description.
- The description field must show validation errors when empty or whitespace-only.
- Save and cancel actions should be clear.

## Data Model

### `users`

- `id`: primary key
- `email`: unique, lowercase, non-empty
- `created_at`: timestamp

### `login_tokens`

- `id`: primary key
- `user_id`: references `users.id`
- `token_hash`: unique hash of the raw token
- `expires_at`: timestamp
- `used_at`: nullable timestamp
- `created_at`: timestamp

### `sessions`

- `id`: primary key
- `user_id`: references `users.id`
- `session_hash`: unique hash of the raw session token
- `expires_at`: timestamp
- `created_at`: timestamp
- `revoked_at`: nullable timestamp

### `todo_items`

- `id`: primary key
- `user_id`: references `users.id`
- `title`: nullable text
- `body`: non-empty text
- `status`: text, one of `active`, `completed`, `archived`
- `sort_order`: integer
- `created_at`: timestamp
- `updated_at`: timestamp

## Suggested Routes

- `GET /login`: show email login form.
- `POST /login`: create user if needed, create login token, print login URL to terminal.
- `GET /auth/magic?token=...`: validate token, create session, redirect to todos.
- `POST /logout`: revoke session and clear cookie.
- `GET /`: show active todo list for current user, redirect anonymous users to login.
- `POST /todos`: create todo item.
- `GET /todos/:id/edit`: show edit form.
- `POST /todos/:id`: update todo item.
- `POST /todos/:id/complete`: mark todo item completed.
- `POST /todos/:id/archive`: soft-delete todo item.
- `POST /todos/reorder`: reorder active todo items.
- `POST /todos/:id/move-up`: accessible reorder fallback.
- `POST /todos/:id/move-down`: accessible reorder fallback.

## Security Requirements

- Never store raw magic tokens or session tokens in the database.
- Store only token hashes.
- Treat request bodies, cookies, route params, and reorder payloads as untrusted.
- Validate input at server boundaries.
- Do not allow users to access, edit, complete, archive, or reorder another user's items.
- Use HTTP-only session cookies.
- Use secure cookies when running in production.

## Accessibility Requirements

- Use semantic HTML forms, labels, buttons, and lists.
- Render todo items in a real list.
- Use buttons for actions.
- Do not rely only on drag and drop for ordering.
- Ensure controls are large enough for touch use.
- Keep visible labels for form fields.
- Show validation errors near the relevant fields.

## MVP Acceptance Criteria

- A new user can submit an email and receive a terminal-printed magic login URL.
- The magic login URL works once and expires after 30 minutes.
- A logged-in user stays logged in for up to 30 days.
- A logged-in user can log out.
- A logged-in user can create a todo item with a required description and optional title.
- A logged-in user can edit an existing todo item.
- A logged-in user can complete an item and it disappears from the active list.
- A logged-in user can soft-delete an item and it disappears from the active list.
- A logged-in user can reorder active items on desktop.
- A logged-in user can reorder active items on mobile with long-press drag.
- A logged-in user can reorder active items without drag using fallback buttons.
- One user's todos are never visible or editable by another user.

## Implementation Recommendation

Use a small Node.js TypeScript server with server-rendered HTML, SQLite, and minimal client-side JavaScript for drag reordering. This keeps the MVP simple while preserving enough structure for auth, validation, and future deployment.
