// Node ESM loader hook: resolve extensionless relative TS imports (append .ts)
// and mark .json imports as JSON modules, so we can import the real plugship v1
// transform module (built for a bundler) under plain `node --experimental-strip-types`.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:")) {
    // JSON: attach the required import attribute + format.
    if (specifier.endsWith(".json")) {
      const url = new URL(specifier, context.parentURL).href;
      return { url, format: "json", importAttributes: { type: "json" }, shortCircuit: true };
    }
    // Extensionless relative import -> try appending .ts
    if (!/\.[cm]?[jt]s$/.test(specifier) && !specifier.endsWith(".json")) {
      const cand = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(cand))) {
        return nextResolve(cand.href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
