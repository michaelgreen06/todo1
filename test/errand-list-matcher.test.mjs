import assert from "node:assert/strict";
import { test } from "node:test";

import { matchErrandList } from "../dist/errand-list-matcher.js";

const costco = { name: "Costco" };
const casco = { name: "Casco" };
const cosco = { name: "Cosco" };

test("errand list matcher", async (suite) => {
  await suite.test("matches spacing, case, and punctuation exactly", () => {
    assert.deepEqual(matchErrandList("cost co", [costco]), { kind: "matched", candidate: costco, method: "exact" });
    assert.deepEqual(matchErrandList("Natural Grocers", [{ name: "natural-grocers." }]), {
      kind: "matched",
      candidate: { name: "natural-grocers." },
      method: "exact",
    });
  });

  await suite.test("matches a unique misspelling to the existing folder", () => {
    assert.deepEqual(matchErrandList("casco", [costco]), { kind: "matched", candidate: costco, method: "fuzzy" });
    assert.deepEqual(matchErrandList("cosco", [costco]), { kind: "matched", candidate: costco, method: "fuzzy" });
    assert.deepEqual(matchErrandList("costo", [costco]), { kind: "matched", candidate: costco, method: "fuzzy" });
  });

  await suite.test("prefers an exact match over similar stores", () => {
    assert.deepEqual(matchErrandList("casco", [costco, casco]), { kind: "matched", candidate: casco, method: "exact" });
  });

  await suite.test("sends ambiguous similar stores to review", () => {
    assert.deepEqual(matchErrandList("costco", [cosco, casco]), { kind: "review", reason: "ambiguous" });
    assert.deepEqual(matchErrandList("casco", [costco, cosco]), { kind: "review", reason: "ambiguous" });
    assert.deepEqual(matchErrandList("cost co", [{ name: "Cost Co" }, costco]), { kind: "review", reason: "ambiguous" });
  });

  await suite.test("sends unrelated, short, and empty names to review without matching", () => {
    assert.deepEqual(matchErrandList("target", [costco]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("cost", [costco]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("coast", [costco]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("the Costco", [costco]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("sams", [{ name: "Sims" }]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("shop", [{ name: "Ship" }]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("cvs", [{ name: "Cos" }]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("pharmacy", [{ name: "Farmacy" }]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("pet supplies", [{ name: "Pest supplies" }]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("milk", []), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("new", [{ name: "Netflix" }, { name: "Nu" }]), { kind: "review", reason: "no-match" });
    assert.deepEqual(matchErrandList("!!!", [costco]), { kind: "review", reason: "no-match" });
  });

  await suite.test("exact-matches short names only when they are identical", () => {
    assert.deepEqual(matchErrandList("new", [{ name: "New" }]), { kind: "matched", candidate: { name: "New" }, method: "exact" });
  });
});
