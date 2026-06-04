import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";

const directory = mkdtempSync(join(tmpdir(), "todo1-e2e-"));
const databasePath = join(directory, "todo.sqlite");
const port = 4319;
const baseUrl = `http://127.0.0.1:${port.toString()}`;
const server = spawn("node", ["dist/index.js"], {
  env: {
    ...process.env,
    TODO_DATABASE_PATH: databasePath,
    HOST: "127.0.0.1",
    PORT: port.toString(),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";

server.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForText(() => stdout, "Todo MVP running");

  const browser = await launchBrowserOrSkip();
  const page = await browser.newPage();

  try {
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel("Email address").fill("e2e@example.com");
    await page.getByRole("button", { name: "Send magic link" }).click();
    const magicLink = await waitForMagicLink();
    await page.goto(magicLink);

    await page.getByLabel("Add folder path").fill("E2E / Smoke");
    await page.getByRole("button", { name: "Add folder" }).click();
    await expectHeading(page, "Smoke");

    await addTodo(page, "First smoke", "First body");
    await expectText(page, "First smoke");
    await page.reload();
    await expectHeading(page, "Smoke");

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel(/Title/u).fill("First smoke edited");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expectText(page, "First smoke edited");

    await page.getByRole("button", { name: "Status" }).click();
    await page.getByLabel("Status").selectOption({ label: "Completed" });
    await page.getByRole("button", { name: "Save status" }).click();
    await expectHeading(page, "Smoke");

    await addTodo(page, "Bulk one", "Bulk one body");
    await addTodo(page, "Bulk two", "Bulk two body");
    await page.getByLabel("Select all").check();
    await expectText(page, "2 selected");
    await page.getByRole("button", { name: "Move selected" }).click();
    await page.getByLabel("Existing location").selectOption("");
    await page.getByRole("button", { name: "Move selected" }).click();
    await expectHeading(page, "Smoke");
    await expectText(page, "No matching items in this location.");
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
  await once(server, "exit").catch(() => undefined);
  rmSync(directory, { recursive: true, force: true });
}

async function addTodo(page, title, body) {
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel(/Title/u).fill(title);
  await page.getByLabel("Description").fill(body);
  await page.getByRole("button", { name: "Add todo" }).click();
}

async function launchBrowserOrSkip() {
  try {
    return await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("MachPortRendezvousServer") || message.includes("bootstrap_check_in")) {
      console.warn("Skipping Playwright smoke: Chromium launch is blocked by this macOS sandbox.");
      server.kill();
      await once(server, "exit").catch(() => undefined);
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    }

    throw error;
  }
}

async function expectHeading(page, name) {
  await page.getByRole("heading", { name, exact: true }).waitFor();
}

async function expectText(page, text) {
  await page.getByText(text).waitFor();
}

async function waitForMagicLink() {
  const pattern = /http:\/\/127\.0\.0\.1:4319\/auth\/magic\?token=[^\s]+/u;
  await waitForText(() => stdout, "/auth/magic");
  const match = pattern.exec(stdout);
  assert.notEqual(match, null, `Magic link not found. stdout=${stdout} stderr=${stderr}`);
  const [link] = match;
  return link;
}

async function waitForText(readText, text) {
  const startedAt = Date.now();

  while (!readText().includes(text)) {
    if (Date.now() - startedAt > 15_000) {
      throw new Error(`Timed out waiting for ${text}. stdout=${stdout} stderr=${stderr}`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}
