import assert from "node:assert/strict";
import { test } from "node:test";

import { routeCaptureText } from "../dist/capture-router.js";

test("capture router", async (suite) => {
  await suite.test("routes agent prefix captures to Agent", () => {
    assert.deepEqual(routeCaptureText("agent, search facebook marketplace for swingtop bottles"), {
      kind: "folder",
      title: null,
      body: "search facebook marketplace for swingtop bottles",
      folderPath: ["Agent"],
      ruleName: "agent-prefix",
    });
    assert.equal(routeCaptureText("Agent: search facebook marketplace for swingtop bottles").body, "search facebook marketplace for swingtop bottles");
    assert.equal(routeCaptureText("agent search facebook marketplace for swingtop bottles").body, "search facebook marketplace for swingtop bottles");
  });

  await suite.test("leaves empty agent prefix captures in the inbox", () => {
    assert.deepEqual(routeCaptureText("agent"), {
      kind: "default",
      title: null,
      body: "agent",
      folderPath: null,
    });
  });

  await suite.test("routes spoken list commands to Errands subfolders", () => {
    assert.deepEqual(routeCaptureText("add peanut butter to my costco list"), {
      kind: "folder",
      title: null,
      body: "peanut butter",
      folderPath: ["Errands", "costco"],
      ruleName: "list-command",
    });
    assert.deepEqual(routeCaptureText("add oats to the natural grocers list."), {
      kind: "folder",
      title: null,
      body: "oats",
      folderPath: ["Errands", "natural grocers"],
      ruleName: "list-command",
    });
  });

  await suite.test("routes issue commands to Issues subfolders", () => {
    assert.deepEqual(routeCaptureText("add an issue for kitchen sink that order a replacement aerator"), {
      kind: "folder",
      title: null,
      body: "order a replacement aerator",
      folderPath: ["Issues", "kitchen sink"],
      ruleName: "issue-command",
    });
  });

  await suite.test("routes meeting note commands to Meetings subfolders", () => {
    assert.deepEqual(routeCaptureText("add meeting note to regen hub that ask about the launch checklist"), {
      kind: "folder",
      title: null,
      body: "ask about the launch checklist",
      folderPath: ["Meetings", "regen hub"],
      ruleName: "meeting-note-command",
    });
  });

  await suite.test("routes message commands to Messages", () => {
    assert.deepEqual(routeCaptureText("message Sam that I am running ten minutes late"), {
      kind: "folder",
      title: null,
      body: "Sam that I am running ten minutes late",
      folderPath: ["Messages"],
      ruleName: "message-command",
    });
  });

  await suite.test("leaves malformed list commands in the inbox", () => {
    for (const text of [
      "add to my costco list",
      "add peanut butter to my list",
      "add peanut butter to costco",
      "please add peanut butter to my costco list",
    ]) {
      assert.deepEqual(routeCaptureText(text), {
        kind: "default",
        title: null,
        body: text,
        folderPath: null,
      });
    }
  });

  await suite.test("leaves malformed issue and meeting note commands in the inbox", () => {
    for (const text of [
      "add an issue for kitchen sink",
      "add an issue that order a replacement aerator",
      "add meeting note to regen hub",
      "add meeting note that ask about the launch checklist",
    ]) {
      assert.deepEqual(routeCaptureText(text), {
        kind: "default",
        title: null,
        body: text,
        folderPath: null,
      });
    }
  });
});
