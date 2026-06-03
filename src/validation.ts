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

export type LocationInput = {
  readonly folderId: string | null;
  readonly folderPathSegments: ReadonlyArray<string> | null;
};

export type CaptureInput = {
  readonly clientCaptureId: string;
  readonly text: string;
  readonly capturedAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

const MAX_EMAIL_LENGTH = 254;
const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 10_000;
const MAX_STATUS_NOTE_LENGTH = 2_000;
const MAX_FOLDER_NAME_LENGTH = 160;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;
const CAPTURE_KEYS = new Set(["client_capture_id", "text", "captured_at", "metadata"]);

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

export function validateFolderPath(rawPath: string | null): ValidationResult<ReadonlyArray<string>> {
  if (rawPath === null || rawPath.trim().length === 0) {
    return { ok: false, message: "Enter a folder path." };
  }

  const segments = rawPath.split("/").map((segment) => segment.trim());

  if (segments.some((segment) => segment.length === 0)) {
    return { ok: false, message: "Folder paths cannot contain blank segments." };
  }

  for (const segment of segments) {
    const nameResult = validateFolderName(segment);

    if (!nameResult.ok) {
      return nameResult;
    }
  }

  return { ok: true, value: segments };
}

export function validateFolderName(rawName: string | null): ValidationResult<string> {
  if (rawName === null || rawName.trim().length === 0) {
    return { ok: false, message: "Folder name is required." };
  }

  const name = rawName.trim();

  if (name.includes("/")) {
    return { ok: false, message: "Folder names cannot contain slash characters." };
  }

  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return { ok: false, message: "Folder names must be 160 characters or fewer." };
  }

  return { ok: true, value: name };
}

export function validateLocationInput(
  rawFolderId: string | null,
  rawFolderPath: string | null,
): ValidationResult<LocationInput> {
  const folderId = normalizeOptionalText(rawFolderId);
  const folderPath = normalizeOptionalText(rawFolderPath);

  if (folderPath === null) {
    return { ok: true, value: { folderId, folderPathSegments: null } };
  }

  const pathResult = validateFolderPath(folderPath);
  return pathResult.ok
    ? { ok: true, value: { folderId: null, folderPathSegments: pathResult.value } }
    : pathResult;
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

export function validateCaptureInput(value: unknown): ValidationResult<CaptureInput> {
  if (!isRecord(value) || Object.keys(value).some((key) => !CAPTURE_KEYS.has(key))) {
    return { ok: false, message: "Invalid capture payload." };
  }

  const clientCaptureId = value["client_capture_id"];
  const text = value["text"];
  const capturedAt = value["captured_at"];
  const metadata = value["metadata"];

  if (typeof clientCaptureId !== "string" || !UUID_PATTERN.test(clientCaptureId)) {
    return { ok: false, message: "client_capture_id must be a UUID." };
  }

  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, message: "text must be a non-empty string." };
  }

  if (
    typeof capturedAt !== "string"
    || !isValidIsoTimestamp(capturedAt)
  ) {
    return { ok: false, message: "captured_at must be an ISO timestamp." };
  }

  if (!isRecord(metadata)) {
    return { ok: false, message: "metadata must be an object." };
  }

  return {
    ok: true,
    value: {
      clientCaptureId,
      text,
      capturedAt,
      metadata,
    },
  };
}

function isValidIsoTimestamp(value: string): boolean {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (match === null || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, rawOffsetHour, rawOffsetMinute] = match;

  if (
    rawYear === undefined
    || rawMonth === undefined
    || rawDay === undefined
    || rawHour === undefined
    || rawMinute === undefined
    || rawSecond === undefined
  ) {
    return false;
  }

  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);
  const offsetHour = rawOffsetHour === undefined ? 0 : Number(rawOffsetHour);
  const offsetMinute = rawOffsetMinute === undefined ? 0 : Number(rawOffsetMinute);

  return (
    month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth(year, month)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
