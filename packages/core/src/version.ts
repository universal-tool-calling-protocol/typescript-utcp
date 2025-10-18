/**
 * Library version - replaced during build process.
 * Do not modify this file manually.
 */
const _VERSION = "__LIB_VERSION__";

/**
 * The library version. Falls back to "1.0.0" if the build script hasn't replaced the placeholder.
 */
export const LIB_VERSION = _VERSION === "__LIB_VERSION__" ? "1.0.0" : _VERSION;
