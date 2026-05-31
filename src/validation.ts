export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

export type TodoInput = {
  readonly title: string | null;
  readonly body: string;
};

export type StatusChangeInput = {
  readonly statusId: string;
  readonly note: string | null;
};

export type ReorderInput = {
  readonly movedId: string;
  readonly previousId: string | null;
  readonly nextId: string | null;
};

const MAX_EMAIL_LENGTH = 254;
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 10_000;
const MAX_STATUS_NOTE_LENGTH = 2_000;

export function validateEmail(rawEmail: string | null): ValidationResult<string> {
  if (rawEmail === null) {
    return { ok: false, message: "Email address is required." };
  }

  const email = rawEmail.trim().toLowerCase();

  if (email.length === 0) {
    return { ok: false, message: "Email address is required." };
  }

  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, message: "Email address is too long." };
  }

  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }

  return { ok: true, value: email };
}

export function validateTodoInput(
  rawTitle: string | null,
  rawBody: string | null,
): ValidationResult<TodoInput> {
  const title = normalizeOptionalText(rawTitle);

  if (title !== null && title.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: "Title must be 160 characters or fewer." };
  }

  if (rawBody === null) {
    return { ok: false, message: "Description is required." };
  }

  const body = rawBody.trim();

  if (body.length === 0) {
    return { ok: false, message: "Description is required." };
  }

  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, message: "Description must be 10,000 characters or fewer." };
  }

  return { ok: true, value: { title, body } };
}

export function validateStatusChangeInput(
  rawStatusId: string | null,
  rawNote: string | null,
): ValidationResult<StatusChangeInput> {
  if (rawStatusId === null || rawStatusId.trim().length === 0) {
    return { ok: false, message: "Choose a status." };
  }

  const note = normalizeOptionalText(rawNote);

  if (note !== null && note.length > MAX_STATUS_NOTE_LENGTH) {
    return { ok: false, message: "Status note must be 2,000 characters or fewer." };
  }

  return { ok: true, value: { statusId: rawStatusId.trim(), note } };
}

export function validateReorderInput(value: unknown): ValidationResult<ReorderInput> {
  if (!isRecord(value)) {
    return { ok: false, message: "Invalid reorder payload." };
  }

  const movedId = value["movedId"];
  const previousId = value["previousId"];
  const nextId = value["nextId"];

  if (
    typeof movedId !== "string"
    || !isNullableString(previousId)
    || !isNullableString(nextId)
  ) {
    return { ok: false, message: "Invalid reorder payload." };
  }

  return { ok: true, value: { movedId, previousId, nextId } };
}

function normalizeOptionalText(rawText: string | null): string | null {
  if (rawText === null) {
    return null;
  }

  const text = rawText.trim();
  return text.length === 0 ? null : text;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
