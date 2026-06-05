export type CaptureRoute = DefaultCaptureRoute | FolderCaptureRoute;

export type CapturePromptRule = {
  readonly name: string;
  readonly spokenPattern: string;
  readonly destination: string;
  readonly itemBody: string;
};

type DefaultCaptureRoute = {
  readonly kind: "default";
  readonly title: null;
  readonly body: string;
  readonly folderPath: null;
};

type FolderCaptureRoute = {
  readonly kind: "folder";
  readonly title: null;
  readonly body: string;
  readonly folderPath: ReadonlyArray<string>;
  readonly ruleName: string;
};

type CaptureRule = (text: string) => FolderCaptureRoute | null;

const AGENT_PREFIX_PATTERN = /^\s*agent\b[\s,.:;!?-]*/iu;
const LIST_COMMAND_PATTERN = /^\s*add\s+(.+?)\s+to\s+(.+?)\s+list\s*[.!?]*\s*$/iu;
const ISSUE_COMMAND_PATTERN = /^\s*add\s+an\s+issue\s+for\s+(.+?)\s+that\s+(.+?)\s*$/iu;
const MEETING_NOTE_COMMAND_PATTERN = /^\s*add\s+meeting\s+note\s+to\s+(.+?)\s+that\s+(.+?)\s*$/iu;

export const CAPTURE_PROMPT_RULES: ReadonlyArray<CapturePromptRule> = [
  {
    name: "Agent",
    spokenPattern: "agent, search facebook marketplace for swingtop bottles",
    destination: "Agent",
    itemBody: "search facebook marketplace for swingtop bottles",
  },
  {
    name: "List",
    spokenPattern: "add peanut butter to my costco list",
    destination: "Errands / costco",
    itemBody: "peanut butter",
  },
  {
    name: "Issue",
    spokenPattern: "add an issue for kitchen sink that order a replacement aerator",
    destination: "Issues / kitchen sink",
    itemBody: "order a replacement aerator",
  },
  {
    name: "Meeting note",
    spokenPattern: "add meeting note to regen hub that ask about the launch checklist",
    destination: "Meetings / regen hub",
    itemBody: "ask about the launch checklist",
  },
];

const CAPTURE_RULES: ReadonlyArray<CaptureRule> = [
  routeAgentPrefix,
  routeListCommand,
  routeIssueCommand,
  routeMeetingNoteCommand,
];

export function routeCaptureText(text: string): CaptureRoute {
  for (const rule of CAPTURE_RULES) {
    const route = rule(text);

    if (route !== null) {
      return route;
    }
  }

  return {
    kind: "default",
    title: null,
    body: text,
    folderPath: null,
  };
}

function routeAgentPrefix(text: string): FolderCaptureRoute | null {
  const match = AGENT_PREFIX_PATTERN.exec(text);

  if (match === null) {
    return null;
  }

  const body = collapseWhitespace(text.slice(match[0].length));

  if (body.length === 0) {
    return null;
  }

  return {
    kind: "folder",
    title: null,
    body,
    folderPath: ["Agent"],
    ruleName: "agent-prefix",
  };
}

function routeListCommand(text: string): FolderCaptureRoute | null {
  const match = LIST_COMMAND_PATTERN.exec(text);

  if (match === null) {
    return null;
  }

  const item = collapseWhitespace(match[1] ?? "");
  const destination = collapseWhitespace(match[2] ?? "");
  const list = collapseWhitespace(destination.replace(/^(?:my|the)\s+/iu, ""));

  if (item.length === 0 || list.length === 0 || /^(?:my|the)$/iu.test(list)) {
    return null;
  }

  return {
    kind: "folder",
    title: null,
    body: item,
    folderPath: ["Errands", list],
    ruleName: "list-command",
  };
}

function routeIssueCommand(text: string): FolderCaptureRoute | null {
  const match = ISSUE_COMMAND_PATTERN.exec(text);

  if (match === null) {
    return null;
  }

  const folder = collapseWhitespace(match[1] ?? "");
  const body = collapseWhitespace(match[2] ?? "");

  if (folder.length === 0 || body.length === 0) {
    return null;
  }

  return {
    kind: "folder",
    title: null,
    body,
    folderPath: ["Issues", folder],
    ruleName: "issue-command",
  };
}

function routeMeetingNoteCommand(text: string): FolderCaptureRoute | null {
  const match = MEETING_NOTE_COMMAND_PATTERN.exec(text);

  if (match === null) {
    return null;
  }

  const folder = collapseWhitespace(match[1] ?? "");
  const body = collapseWhitespace(match[2] ?? "");

  if (folder.length === 0 || body.length === 0) {
    return null;
  }

  return {
    kind: "folder",
    title: null,
    body,
    folderPath: ["Meetings", folder],
    ruleName: "meeting-note-command",
  };
}

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}
