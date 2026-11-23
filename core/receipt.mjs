import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const maxImageBytes = 4 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodeImage(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxImageBytes) return null;
  if (bytes.toString('base64') !== value) return null;
  if (bytes.subarray(0, 8).equals(pngSignature)) return bytes;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return bytes;
  return null;
}

export async function scanReceipt(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'appfusion-receipt-'));
  try {
    const image = join(dir, 'receipt');
    await writeFile(image, bytes);
    const { stdout } = await run('tesseract', [image, 'stdout', '-l', 'eng', '--psm', '6'], {
      timeout: 12_000,
      maxBuffer: 256 * 1024,
    });
    return extractItems(stdout);
  } catch (error) {
    if (error.code === 1 && /error (in pixRead|during processing)|cannot be read/i.test(error.stderr)) {
      return [];
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function extractItems(text) {
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (/^(?:sub\s*total|grand total|total|balance due|amount due)\b/i.test(row)) break;

    // OCR candidates are priced receipt rows. The user can correct package counts or add missed items.
    const priced = row.match(/^(.+?)\s+\$?\d{1,6}[.,]\d{2}(?:\s+[A-Z*]{1,3})?$/);
    if (!priced) continue;
    const description = priced[1].replace(/^\d{5,15}\s+/, '').trim();
    if (/^(?:GST|HST|PST|tax|change|cash|credit|debit|visa|mastercard|coupon|discount|savings|deposit|tender|rounding)\b/i.test(description)) continue;

    const counted = description.match(/^(\d{1,4})\s*[xX×]\s+(.+)$/);
    const name = (counted?.[2] ?? description).replace(/\s+/g, ' ').trim();
    const quantity = counted ? Number(counted[1]) : 1;
    if (!/\p{L}/u.test(name) || name.length > 100 || quantity < 1) continue;
    items.push({ name, quantity, unit: 'each' });
    if (items.length === 100) break;
  }
  return items;
}
