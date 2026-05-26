# HTML and Markup Standards

## Purpose

Use this guide when editing HTML, JSX, TSX markup, forms, navigation, layout structure, or accessibility-related UI.

The goal is not clever markup. The goal is boring, semantic, accessible markup that is easy to style, test, and maintain.

## Core Rules

- Prefer semantic HTML over generic `div` and `span` wrappers.
- Use native elements before ARIA.
- Use `button` for actions and `a` for navigation.
- Use real `form`, `label`, `input`, `select`, `textarea`, and `fieldset` elements for forms.
- Keep heading order meaningful.
- Avoid wrapper soup.
- Avoid clickable non-interactive elements.
- Avoid ARIA unless native HTML cannot express the interaction.
- Do not hide important text from sighted users just to expose it to screen readers.
- Do not add layout-only markup unless the CSS actually needs it.


## HTML-Heavy Repo Setup
- For repos with substantial raw `.html` work, ensure `npm install --save-dev prettier html-validate eslint @html-eslint/parser @html-eslint/eslint-plugin` has been run before treating markup work as complete.
- Add `npm install --save-dev eslint-plugin-jsx-a11y` only when the repo also contains meaningful JSX or TSX.
- Do not treat HTML work as complete until the configured formatting and HTML lint/validation commands pass.

## Page and Region Structure

Prefer clear landmarks:

```html
<header>
  <nav aria-label="Main navigation">
    <!-- links -->
  </nav>
</header>

<main>
  <section aria-labelledby="billing-heading">
    <h1 id="billing-heading">Billing</h1>
  </section>
</main>

<footer>
  <!-- footer links -->
</footer>
```

Rules:

- Each page should usually have one `main`.
- Use `header`, `nav`, `main`, `section`, `article`, `aside`, and `footer` when they describe the content.
- Do not use `section` unless it has a meaningful heading or accessible name.
- Use `div` only when no semantic element fits.

## Headings

Headings describe document structure, not visual size.

```html
<h1>Account settings</h1>
<h2>Profile</h2>
<h2>Security</h2>
<h3>Two-factor authentication</h3>
```

Rules:

- Use one clear `h1` for the main page or screen title when practical.
- Do not skip heading levels for styling.
- Do not choose headings only because they look big or small.
- Style headings with CSS instead of changing semantic level.

## Links and Buttons

Use links for navigation:

```html
<a href="/settings">Account settings</a>
```

Use buttons for actions:

```html
<button type="button">Open menu</button>
```

Bad:

```html
<div role="button" tabindex="0" onclick="openMenu()">Open menu</div>
<a href="#" onclick="saveForm()">Save</a>
```

Rules:

- Do not use `div`, `span`, or `a href="#"` as fake buttons.
- Buttons inside forms must explicitly set `type`.
- Use `type="button"` unless the button is meant to submit the form.
- Links must have a real destination.
- Link text should describe the destination; avoid vague text like “click here.”

## Forms

Every form control needs an accessible label.

Good:

```html
<label for="email">Email address</label>
<input id="email" name="email" type="email" autocomplete="email" required>
```

Good for checkbox/radio:

```html
<label>
  <input name="termsAccepted" type="checkbox">
  I agree to the terms
</label>
```

Bad:

```html
<input placeholder="Email">
```

Rules:

- Do not rely on placeholder text as the only label.
- Use `fieldset` and `legend` for grouped radio buttons or checkboxes.
- Use `autocomplete` where it is useful and valid.
- Show validation errors near the relevant field.
- Use `aria-describedby` to connect help text or error text to a field.
- Keep visible labels unless the UI truly requires a visually hidden label.

Example with help text:

```html
<label for="password">Password</label>
<input
  id="password"
  name="password"
  type="password"
  aria-describedby="password-help"
  autocomplete="new-password"
>
<p id="password-help">Use at least 12 characters.</p>
```

## Images and Icons

Informative images need useful alt text:

```html
<img src="/team.jpg" alt="The support team standing outside the Boulder office">
```

Decorative images use empty alt text:

```html
<img src="/divider.svg" alt="">
```

Rules:

- Do not write alt text like “image” or “picture of.”
- If an icon button has no visible text, give the button an accessible name.
- Hide decorative icons from assistive technology.

Good icon button:

```html
<button type="button" aria-label="Close dialog">
  <svg aria-hidden="true" focusable="false">
    <!-- icon paths -->
  </svg>
</button>
```

## Lists

Use lists for repeated related items.

```html
<ul>
  <li>Fast setup</li>
  <li>Typed API contracts</li>
  <li>Accessible forms</li>
</ul>
```

Rules:

- Use `ul` for unordered groups.
- Use `ol` when order matters.
- Do not build lists from repeated `div`s when a real list fits.

## Tables

Use tables for tabular data, not layout.

```html
<table>
  <caption>Monthly usage</caption>
  <thead>
    <tr>
      <th scope="col">Month</th>
      <th scope="col">Requests</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">May</th>
      <td>12,400</td>
    </tr>
  </tbody>
</table>
```

Rules:

- Include a `caption` when the table needs context.
- Use `th` for headers.
- Use `scope` for simple row and column headers.
- Do not use tables for page layout.

## ARIA

ARIA is a fallback, not a first choice.

Rules:

- Prefer native HTML semantics over ARIA roles.
- Do not add redundant roles, such as `role="button"` on a `button`.
- Do not use ARIA to fix markup that should be a native element.
- Use `aria-label` only when there is no visible label to reference.
- Prefer `aria-labelledby` when visible label text already exists.
- Do not put ARIA attributes on random non-interactive elements unless they are part of a real accessible pattern.

Bad:

```html
<div role="form">
  <input aria-label="Email">
</div>
```

Good:

```html
<form>
  <label for="email">Email</label>
  <input id="email" name="email" type="email">
</form>
```

## JSX and TSX Markup

The same HTML rules apply in JSX/TSX.

Rules:

- Do not create unnecessary wrapper components.
- Keep component markup shallow.
- Extract a component only when it improves readability or reuse.
- Prefer semantic elements over styled generic containers.
- Do not pass arbitrary `className` strings through many component layers unless the component is intentionally low-level.
- Keep event handlers on native interactive elements.
- Avoid disabling lint/a11y rules. Fix the markup instead.

Good:

```tsx
type SaveButtonProps = {
  readonly isSaving: boolean;
};

export function SaveButton({ isSaving }: SaveButtonProps) {
  return (
    <button type="submit" disabled={isSaving}>
      {isSaving ? "Saving…" : "Save"}
    </button>
  );
}
```

Bad:

```tsx
type SaveButtonProps = {
  readonly isSaving?: boolean;
};

export function SaveButton({ isSaving }: SaveButtonProps) {
  return (
    <div role="button" onClick={() => submit()}>
      {isSaving ? "Saving…" : "Save"}
    </div>
  );
}
```

## Validation and Formatting

Before finishing meaningful markup changes, run the project’s existing checks.

Preferred checks when available:

```bash
npm run lint
npm run typecheck
npm test
```

If the project includes raw HTML files, also run the HTML validator command configured by the project.


## Review Checklist

Before considering markup complete, verify:

- The page has a clear semantic structure.
- Interactive elements are native `button`, `a`, `input`, `select`, or `textarea` elements where possible.
- Every form control has a label.
- Images have correct alt text.
- Headings are meaningful and ordered.
- There are no fake buttons or fake links.
- ARIA is minimal and justified.
- Markup is not full of unnecessary wrappers.
- Existing lint, typecheck, and test commands pass.
