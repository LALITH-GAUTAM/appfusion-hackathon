import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const itemKey = ({ name, unit }) => JSON.stringify([name.toLowerCase(), unit.toLowerCase()]);

export async function openStore(path) {
  let state = { inventory: [], receipts: {} };
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });

  // Serialize read-modify-write operations in this server process.
  let pending = Promise.resolve();
  function update(change) {
    const operation = pending.then(async () => {
      const next = structuredClone(state);
      const { result, changed } = change(next);
      if (!changed) return result;

      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      state = next;
      return result;
    });
    pending = operation.catch(() => {});
    return operation;
  }

  return {
    inventory() {
      return state.inventory;
    },
    addReceipt(items) {
      const receiptId = randomUUID();
      return update((next) => {
        next.receipts[receiptId] = { confirmedItems: null };
        return { changed: true, result: { receiptId, items } };
      });
    },
    confirmReceipt(receiptId, items) {
      return update((next) => {
        const receipt = next.receipts[receiptId];
        if (!receipt) return { result: { status: 'missing' } };
        if (receipt.confirmedItems) {
          if (receipt.confirmedItems !== JSON.stringify(items)) {
            return { result: { status: 'conflict' } };
          }
          return { result: { items: next.inventory } };
        }

        const inventory = new Map(next.inventory.map((item) => [itemKey(item), item]));
        const updated = new Map();
        for (const item of items) {
          const key = itemKey(item);
          const existing = updated.get(key) ?? inventory.get(key);
          if (existing) {
            existing.quantity = Math.round((existing.quantity + item.quantity) * 1000) / 1000;
          } else {
            updated.set(key, { ...item });
            continue;
          }
          inventory.delete(key);
          updated.set(key, existing);
        }
        next.inventory = [...updated.values(), ...inventory.values()];
        receipt.confirmedItems = JSON.stringify(items);
        return { changed: true, result: { items: next.inventory } };
      });
    },
  };
}
