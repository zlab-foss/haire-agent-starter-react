export function createScopedGetSet<Instance extends Record<string, any>, Key extends keyof Instance>(
  get: () => Instance,
  set: (fn: (old: Instance) => Instance) => void,
  key: Key,
  errorPrefix?: string,
): {
  get: () => NonNullable<Instance[Key]>,
  set: (fn: (old: NonNullable<Instance[Key]>) => NonNullable<Instance[Key]>) => void,
} {
  return {
    get: () => {
      const value = get()[key];
      if (!value) {
        throw new Error(`${errorPrefix ? `${errorPrefix} - t` : 'T'}ried to get .${String(key)}, but it was not truthy - found ${JSON.stringify(value, null, 2)}`);
      }
      return value;
    },
    set: (fn) => set((old) => {
      const value = old[key];
      if (!value) {
        throw new Error(`${errorPrefix ? `${errorPrefix} - t` : 'T'}ried to set .${String(key)}, but it was not truthy - found ${JSON.stringify(value, null, 2)}`);
      }

      const newValue = fn(value);
      if (newValue !== value) {
        return { ...old, [key]: newValue };
      } else {
        return old;
      }
    }),
  };
}

