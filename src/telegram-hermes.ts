export type TelegramHermesConfig = {
  readonly botToken: string;
  readonly chatId: string;
  readonly botUsername: string;
};

type TelegramMethod = "createForumTopic" | "sendMessage";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TOPIC_NAME_MAX_LENGTH = 40;

export async function dispatchCaptureToTelegramHermes(config: TelegramHermesConfig, routedBody: string): Promise<void> {
  const messageThreadId = await createForumTopic(config, makeTopicName(routedBody));

  await sendMessage(config, messageThreadId, `@${config.botUsername} ${routedBody}`);
}

async function createForumTopic(config: TelegramHermesConfig, name: string): Promise<number> {
  const response = await callTelegramApi(config.botToken, "createForumTopic", {
    chat_id: config.chatId,
    name,
  });

  if (!isCreateForumTopicResponse(response)) {
    throw new Error("Telegram createForumTopic returned an unexpected response.");
  }

  return response.result.message_thread_id;
}

async function sendMessage(config: TelegramHermesConfig, messageThreadId: number, text: string): Promise<void> {
  const response = await callTelegramApi(config.botToken, "sendMessage", {
    chat_id: config.chatId,
    message_thread_id: messageThreadId,
    text,
  });

  if (!isOkTelegramResponse(response)) {
    throw new Error("Telegram sendMessage returned an unexpected response.");
  }
}

async function callTelegramApi(
  botToken: string,
  method: TelegramMethod,
  payload: Readonly<Record<string, string | number>>,
): Promise<unknown> {
  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  const parsedResponse: unknown = JSON.parse(responseText);

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed with HTTP ${response.status.toString()}.`);
  }

  return parsedResponse;
}

function makeTopicName(routedBody: string): string {
  const topicName = routedBody.slice(0, TOPIC_NAME_MAX_LENGTH).trim();

  if (topicName.length === 0) {
    return "Agent task";
  }

  return topicName;
}

function isCreateForumTopicResponse(value: unknown): value is {
  readonly ok: true;
  readonly result: { readonly message_thread_id: number };
} {
  if (!isRecord(value) || value["ok"] !== true || !isRecord(value["result"])) {
    return false;
  }

  return typeof value["result"]["message_thread_id"] === "number";
}

function isOkTelegramResponse(value: unknown): value is { readonly ok: true } {
  return isRecord(value) && value["ok"] === true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
