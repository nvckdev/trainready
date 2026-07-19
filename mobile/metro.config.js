const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

/**
 * Metro config for the Taper mobile app.
 *
 * The training engine (../engine) is pure TypeScript and runs ON-DEVICE — the
 * same code that generates plans on the dashboard generates them on the phone.
 * Three pieces make that work:
 *
 * 1. watchFolders: dev-server file watching for ../engine.
 * 2. An explicit resolver branch for engine files: the Expo CLI rebuilds the
 *    file map from its own roots, which can drop out-of-project folders — so
 *    any import that lands inside ../engine is resolved directly on disk
 *    instead of through the file map. Engine imports always carry their .ts
 *    extension, which keeps this branch exact.
 * 3. Node-builtin shims: engine/goal.ts and engine/learned.ts import node:fs /
 *    node:path for OPTIONAL corpus reads, all guarded by existsSync or
 *    try/catch with safe defaults ([], null). The shims make existsSync return
 *    false, so on device those callers take their documented "corpus absent"
 *    fallbacks. No engine math changes.
 */
const config = getDefaultConfig(__dirname);

const ENGINE_DIR = path.resolve(__dirname, "..", "engine");
config.watchFolders = [...(config.watchFolders ?? []), ENGINE_DIR];

const SHIMS = {
  fs: path.resolve(__dirname, "shims", "node-fs.js"),
  path: path.resolve(__dirname, "shims", "node-path.js"),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const bare = moduleName.replace(/^node:/, "");
  if (Object.prototype.hasOwnProperty.call(SHIMS, bare)) {
    return { type: "sourceFile", filePath: SHIMS[bare] };
  }
  // Relative import that lands inside the engine: resolve it on disk.
  if (moduleName.startsWith(".")) {
    const abs = path.resolve(path.dirname(context.originModulePath), moduleName);
    if (abs.startsWith(ENGINE_DIR + path.sep) && fs.existsSync(abs)) {
      return { type: "sourceFile", filePath: abs };
    }
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
