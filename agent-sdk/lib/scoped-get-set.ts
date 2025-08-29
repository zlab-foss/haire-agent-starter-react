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
      if (!old) {
        throw new Error(`${errorPrefix ? `${errorPrefix} - t` : 'T'}ried to get .${String(key)}, but it was not truthy - found ${JSON.stringify(old, null, 2)}`);
      }
      return { ...old, agent: fn(old.agent!) }
    }),
  };
}

