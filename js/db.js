// Persistência local em IndexedDB: pastas (projetos) e croquis.
const DB_NAME = 'croqui-db';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sketches')) {
        const s = db.createObjectStore('sketches', { keyPath: 'id' });
        s.createIndex('folderId', 'folderId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async listFolders() {
    const all = await tx('folders', 'readonly', (s) => reqP(s.getAll()));
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  getFolder: (id) => tx('folders', 'readonly', (s) => reqP(s.get(id))),
  putFolder: (f) => tx('folders', 'readwrite', (s) => reqP(s.put(f))),
  async deleteFolder(id) {
    const sketches = await db.listSketches(id);
    await tx('sketches', 'readwrite', (s) => Promise.all(sketches.map((k) => reqP(s.delete(k.id)))));
    await tx('folders', 'readwrite', (s) => reqP(s.delete(id)));
  },
  async listSketches(folderId) {
    const all = await tx('sketches', 'readonly', (s) => reqP(s.index('folderId').getAll(folderId)));
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },
  getSketch: (id) => tx('sketches', 'readonly', (s) => reqP(s.get(id))),
  putSketch: (k) => tx('sketches', 'readwrite', (s) => reqP(s.put(k))),
  deleteSketch: (id) => tx('sketches', 'readwrite', (s) => reqP(s.delete(id))),
};

// Pede ao navegador para não apagar os dados (Safari limpa storage de sites não usados).
export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}
