import type { FirearmId } from './config';

export const CUSTOM_WEAPONS: FirearmId[] = ['ak', 'm4', 'awp', 'pistol'];
export const MAX_SAMPLE_BYTES = 2 * 1024 * 1024;
export const MAX_SAMPLE_SECONDS = 5;
export interface StoredShot { id: FirearmId; name: string; bytes: ArrayBuffer }

export function validateAudioFile(file: { name: string; size: number }) {
  if (!/\.(wav|mp3|ogg)$/i.test(file.name)) throw new Error('Choose a WAV, MP3, or OGG audio file. ZIP packs and game archives must be extracted first.');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_SAMPLE_BYTES) throw new Error('Each sound must be non-empty and no larger than 2 MB.');
}

export function validateDecodedShot(duration: number, channels: number) {
  if (!Number.isFinite(duration) || duration < .01 || duration > MAX_SAMPLE_SECONDS || !Number.isInteger(channels) || channels < 1 || channels > 2) throw new Error('Use a mono or stereo gunshot between 0.01 and 5 seconds long.');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Browser audio storage is unavailable.')); return; }
    const request = indexedDB.open('opencs.custom-audio', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('shots', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Audio storage is blocked by another tab.'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shots', mode);
    const request = operation(tx.objectStore('shots'));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? request.error ?? new Error('Could not update audio storage.')); };
  });
}

export async function loadStoredShots(): Promise<StoredShot[]> {
  const records: unknown[] = await transaction('readonly', store => store.getAll());
  return records.filter((value): value is StoredShot => {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<StoredShot>;
    return CUSTOM_WEAPONS.includes(record.id as FirearmId) && typeof record.name === 'string' && record.bytes instanceof ArrayBuffer && record.bytes.byteLength > 0 && record.bytes.byteLength <= MAX_SAMPLE_BYTES;
  });
}

export async function saveStoredShot(record: StoredShot) { await transaction('readwrite', store => store.put(record)); }
export async function deleteStoredShot(id: FirearmId) { await transaction('readwrite', store => store.delete(id)); }
