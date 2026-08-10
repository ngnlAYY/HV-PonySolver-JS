const values = new Map<string, string>()
const testStorage: Storage = {
  get length() {
    return values.size
  },
  clear() {
    values.clear()
  },
  getItem(key) {
    return values.get(String(key)) ?? null
  },
  key(index) {
    return Array.from(values.keys())[index] ?? null
  },
  removeItem(key) {
    values.delete(String(key))
  },
  setItem(key, value) {
    values.set(String(key), String(value))
  },
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  value: testStorage,
})
