// Polyfills the window.storage API (get/set/delete/list) that the app was
// originally written against inside Claude.ai's artifact sandbox, backed by
// the browser's localStorage instead. Same method shapes, so the app code
// doesn't need to change. Import this once, before the app renders.
//
// Note: "shared" here just means a different key namespace on the SAME
// machine/browser profile - it does not sync data across users or devices
// the way it does inside an artifact. For a real multi-user deployment,
// swap this out for calls to your own backend + database.

function fullKey(key, shared) {
  return `lpa:${shared ? "shared" : "user"}:${key}`;
}

window.storage = {
  async get(key, shared = false) {
    const raw = localStorage.getItem(fullKey(key, shared));
    if (raw === null) {
      throw new Error(`Key not found: ${key}`);
    }
    return { key, value: raw, shared };
  },

  async set(key, value, shared = false) {
    localStorage.setItem(fullKey(key, shared), value);
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    localStorage.removeItem(fullKey(key, shared));
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    const searchPrefix = fullKey(prefix, shared);
    const nsPrefix = fullKey("", shared);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(searchPrefix)) {
        keys.push(k.slice(nsPrefix.length));
      }
    }
    return { keys, prefix, shared };
  }
};
