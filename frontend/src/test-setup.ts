import "@testing-library/jest-dom/vitest";

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: () => Promise.resolve() },
});

// Avoid Node's experimental localStorage shadowing jsdom's browser storage.
const localValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return localValues.size; },
    key: (index: number) => [...localValues.keys()][index] ?? null,
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
    removeItem: (key: string) => { localValues.delete(key); },
    clear: () => localValues.clear(),
  },
});
