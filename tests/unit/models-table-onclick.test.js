import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(
  resolve(__dirname, "../../src/app/(dashboard)/dashboard/providers/[id]/ModelsTable.js"),
  "utf8"
);

// Regression guard for the "Available Models table renders empty" bug.
//
// ModelsTable passed row action handlers as `onClick={onTest(model.id)}` —
// invoking the handler DURING render instead of on click. For built-in
// providers this fired handleDisableModel for every model on mount, which
// POSTed to /api/models/disabled and disabled the entire catalog; the next
// render then filtered every model out and the table showed "No models".
// onTest also called setState during render (React "Expected onClick listener
// to be a function" ×N). The fix wraps each in an arrow: `() => onTest(...)`.
describe("ModelsTable row action handlers", () => {
  for (const handler of ["onTest", "onDisable", "onDeleteAlias"]) {
    it(`binds ${handler} as an arrow, never invoked during render`, () => {
      // Matches `onClick={onTest(` — a direct call in JSX (the bug).
      const directInvoke = new RegExp(`onClick=\\{${handler}\\(`);
      expect(source).not.toMatch(directInvoke);
      // The handler must still be wired via an arrow wrapper somewhere.
      const arrowWrapped = new RegExp(`onClick=\\{\\(\\)\\s*=>\\s*${handler}\\(`);
      expect(source).toMatch(arrowWrapped);
    });
  }
});
