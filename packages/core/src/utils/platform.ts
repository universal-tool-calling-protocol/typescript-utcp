// Platform detection utility to determine if we're in Node.js or browser
export const isNode = typeof process !== 'undefined' && 
                      process.versions != null && 
                      process.versions.node != null;

export const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
