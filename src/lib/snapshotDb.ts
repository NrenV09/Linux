import type { SavedSnapshotMeta, SavedSnapshotRecord } from '../types/v86';

const DB_NAME = 'v86_desktop_emulator_db';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function saveSnapshotToDb(record: SavedSnapshotRecord): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to store machine snapshot.'));
      tx.onabort = () => reject(tx.error ?? new Error('Snapshot transaction aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function listSnapshotsFromDb(): Promise<SavedSnapshotMeta[]> {
  const db = await openDatabase();
  try {
    return await new Promise<SavedSnapshotMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as SavedSnapshotRecord[]) ?? [];
        const metas: SavedSnapshotMeta[] = records
          .map(({ id, name, presetName, memoryMb, byteLength, savedAt }) => ({
            id,
            name,
            presetName,
            memoryMb,
            byteLength,
            savedAt,
          }))
          .sort((a, b) => b.savedAt - a.savedAt);
        resolve(metas);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read snapshots.'));
    });
  } finally {
    db.close();
  }
}

export async function loadSnapshotFromDb(id: string): Promise<SavedSnapshotRecord | null> {
  const db = await openDatabase();
  try {
    return await new Promise<SavedSnapshotRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve((req.result as SavedSnapshotRecord) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to load snapshot.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteSnapshotFromDb(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete snapshot.'));
    });
  } finally {
    db.close();
  }
}
