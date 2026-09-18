import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every `t("namespace.key")` the components ask for must exist in **both** dictionaries.
 *
 * This exists because the opposite was true and nobody could see it: `interpreter.*` and
 * `narrative.*` were referenced by the interpreter and draft surfaces while neither
 * dictionary had the namespace, and those calls pass no `defaultValue`, so i18next
 * returned the key itself -- an Arabic-first clinician was shown `narrative.coverageHint`
 * on screen. English-only eyes never noticed, because the surrounding copy was English.
 *
 * A missing key is a blank or a raw key in one language; there is no benign case.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(here, f), "utf8")) as Record<string, unknown>;

function lookup(dict: Record<string, unknown>, key: string): boolean {
  const [ns = "", rest = ""] = key.split(".", 2);
  if (!(ns in dict)) return false;
  let cur: unknown = dict[ns];
  for (const part of rest.split(".")) {
    if (typeof cur !== "object" || cur === null || !(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

describe("i18n keys resolve in both languages", () => {
  it("every referenced namespace.key exists in en.json and ar.json", () => {
    const en = read("en.json");
    const ar = read("ar.json");
    const src = path.join(here, "..");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) files.push(full);
      }
    };
    walk(src);
    const asked = new Set<string>();
    for (const file of files) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/\bt\(\s*"([A-Za-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)"/g)) {
        asked.add(m[1] as string);
      }
    }
    const unresolved = [...asked].filter((k) => !lookup(en, k) || !lookup(ar, k));
    expect(unresolved).toEqual([]);
    expect(asked.size).toBeGreaterThan(50);
  });
});
