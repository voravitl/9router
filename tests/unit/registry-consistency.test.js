// Guard against bug #75c4bf9: dangling imports/exports in registry index.js
// after provider cleanup. Keeps the registry index in sync with on-disk files.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const REGISTRY_DIR = path.resolve(__dirname, "../../open-sse/providers/registry");
const INDEX_PATH = path.join(REGISTRY_DIR, "index.js");
const EXCLUDED = new Set(["index.js", "shared.js", "schema.js"]);

function listProviderFiles() {
  return fs
    .readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith(".js") && !EXCLUDED.has(f))
    .sort();
}

function readIndex() {
  return fs.readFileSync(INDEX_PATH, "utf8");
}

describe("registry index.js consistency", () => {
  const providerFiles = listProviderFiles();
  const indexSrc = readIndex();

  // Capture `import pN from "./xxx.js";`
  const importMap = new Map();
  for (const line of indexSrc.split("\n")) {
    const m = line.match(/^import\s+(\w+)\s+from\s+"\.\/(.+)";/);
    if (m) importMap.set(m[2], m[1]);
  }

  // Capture the `export default [...]` array contents (lines like `  pN,`)
  const exportedNames = new Set();
  const exportBlockMatch = indexSrc.match(/export\s+default\s+\[([\s\S]*?)\]/);
  if (exportBlockMatch) {
    for (const m of exportBlockMatch[1].matchAll(/\b(\w+)\b/g)) {
      exportedNames.add(m[1]);
    }
  }

  it("every provider .js file has a matching import in index.js", () => {
    const missing = providerFiles.filter((f) => !importMap.has(f));
    expect(missing, `providers without an import: ${missing.join(", ")}`).toEqual([]);
  });

  it("every provider .js file has a matching export entry in index.js", () => {
    // Build set of imported basenames to compare against exported alias names
    const importedAliasByFile = new Map();
    for (const [file, alias] of importMap) {
      importedAliasByFile.set(file, alias);
    }
    const missing = providerFiles.filter((f) => {
      const alias = importedAliasByFile.get(f);
      return !alias || !exportedNames.has(alias);
    });
    expect(missing, `providers not in export array: ${missing.join(", ")}`).toEqual([]);
  });

  it('every "./..." import in index.js resolves to a real file on disk', () => {
    const dangling = [];
    for (const [file] of importMap) {
      const full = path.join(REGISTRY_DIR, file);
      if (!fs.existsSync(full)) dangling.push(file);
    }
    expect(dangling, `imports with no file on disk: ${dangling.join(", ")}`).toEqual([]);
  });

  it("every entry in the export array corresponds to an import", () => {
    const importedAliases = new Set(importMap.values());
    const orphans = [...exportedNames].filter((name) => !importedAliases.has(name));
    expect(orphans, `exported but never imported: ${orphans.join(", ")}`).toEqual([]);
  });
});
