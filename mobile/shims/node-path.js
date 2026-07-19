/** node:path shim: the engine only uses join() to build corpus paths that the
 *  fs shim then reports absent. A plain separator join is sufficient. */
exports.join = (...parts) => parts.filter(Boolean).join("/");
