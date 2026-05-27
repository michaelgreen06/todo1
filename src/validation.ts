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

const MAX_EMAIL_LENGTH = 254;
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 10_000;

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

export function isStringArray(value: unknown): value is ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((item) => typeof item === "string");
}

function normalizeOptionalText(rawText: string | null): string | null {
  if (rawText === null) {
    return null;
  }

  const text = rawText.trim();
  return text.length === 0 ? null : text;
}
