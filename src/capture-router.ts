export type CaptureRoute = DefaultCaptureRoute | FolderCaptureRoute;

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

const CAPTURE_RULES: ReadonlyArray<CaptureRule> = [
  routeAgentPrefix,
  routeListCommand,
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

function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}
