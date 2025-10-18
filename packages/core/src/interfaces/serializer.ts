let ensurePluginsInitialized: (() => void) | null = null;

export function setPluginInitializer(fn: () => void): void {
  ensurePluginsInitialized = fn;
}

export abstract class Serializer<T> {
  constructor() {
    // Use lazy initialization to avoid circular dependency during module loading
    if (ensurePluginsInitialized) {
      ensurePluginsInitialized();
    }
  }

  abstract toDict(obj: T): { [key: string]: any };

  abstract validateDict(obj: { [key: string]: any }): T;

  copy(obj: T): T {
    return this.validateDict(this.toDict(obj));
  }
}