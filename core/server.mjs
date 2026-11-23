import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { decodeImage, maxImageBytes, scanReceipt } from './receipt.mjs';
import { openStore } from './store.mjs';

const port = Number(process.env.CORE_PORT ?? 8787);
const host = process.env.CORE_HOST ?? '127.0.0.1';
const mealService = process.env.MEAL_SERVICE_URL ?? 'http://127.0.0.1:8788/meal-suggestion';
const allowedOrigins = (process.env.CORE_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim());
const store = await openStore(process.env.CORE_DATA_FILE ?? fileURLToPath(new URL('.data/fridge.json', import.meta.url)));
const maxReceiptBody = Math.ceil(maxImageBytes / 3) * 4 + 1024;
const confirmRoute = /^\/api\/receipts\/([a-f0-9-]{36})\/confirm$/i;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (message) => new ApiError(400, 'INVALID_INPUT', message);
const missing = (message) => new ApiError(404, 'NOT_FOUND', message);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const tidy = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request, limit) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    throw invalid('Send an application/json request.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (object(value)) return value;
  } catch {
    // The response below covers malformed JSON and unexpected JSON types.
  }
  throw invalid('Send a valid JSON object.');
}

function confirmedItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw invalid('Provide between 1 and 100 grocery items.');
  }
  return items.map((item, index) => {
    const name = tidy(item?.name);
    const unit = tidy(item?.unit);
    const quantity = item?.quantity;
    if (!name || name.length > 100 || !unit || unit.length > 24 ||
        !Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000 ||
        Math.round(quantity * 1000) / 1000 !== quantity) {
      throw invalid(`Item ${index + 1} needs a name, unit, and positive numeric quantity with up to three decimal places.`);
    }
    return { name, quantity, unit };
  });
}

async function mealIdea(items) {
  if (items.length === 0) {
    throw new ApiError(409, 'EMPTY_INVENTORY', 'Add groceries to your fridge before requesting a meal idea.');
  }
  try {
    const response = await fetch(mealService, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.slice(0, 100) }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Meal service returned ${response.status}`);
    }
    const data = await response.json();
    if (!object(data)) throw new Error('Meal service returned invalid JSON content');
    const { title, ingredientsOnHand, optionalMissingIngredients, steps } = data;
    const lists = [ingredientsOnHand, optionalMissingIngredients, steps];
    if (!nonempty(title) || !lists.every((list) => Array.isArray(list) && list.every(nonempty)) ||
        !ingredientsOnHand.length || !steps.length) {
      throw new Error('Meal service returned an invalid meal');
    }
    return { title, ingredientsOnHand, optionalMissingIngredients, steps };
  } catch (error) {
    console.error('Meal service request failed:', error.message);
    throw new ApiError(503, 'MEAL_SERVICE_UNAVAILABLE', 'Meal suggestions are temporarily unavailable.');
  }
}

async function route(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  const method = request.method;
  if (method === 'GET' && path === '/api/inventory') {
    return send(response, 200, { items: store.inventory() });
  }

  if (method === 'POST' && path === '/api/receipts') {
    const { imageBase64 } = await readJson(request, maxReceiptBody);
    const image = decodeImage(imageBase64);
    if (!image) throw invalid('Send a base64-encoded JPEG or PNG image up to 4 MiB.');
    let items;
    try {
      items = await scanReceipt(image);
    } catch (error) {
      console.error('Receipt OCR failed:', error.code ?? error.name);
      throw new ApiError(503, 'RECEIPT_SCAN_UNAVAILABLE', 'Receipt scanning is temporarily unavailable.');
    }
    if (items.length === 0) {
      throw new ApiError(422, 'RECEIPT_UNREADABLE', 'No grocery items were found. Try a clearer receipt photo.');
    }
    return send(response, 201, await store.addReceipt(items));
  }

  const receipt = path.match(confirmRoute);
  if (method === 'POST' && receipt) {
    const { items } = await readJson(request, 128 * 1024);
    const result = await store.confirmReceipt(receipt[1], confirmedItems(items));
    if (result.status === 'missing') throw missing('Receipt not found. Scan the receipt again.');
    if (result.status === 'conflict') {
      throw new ApiError(409, 'RECEIPT_ALREADY_CONFIRMED', 'This receipt has already been added to your fridge.');
    }
    return send(response, 200, { items: result.items });
  }

  if (method === 'POST' && path === '/api/meals') {
    const body = await readJson(request, 1024);
    if (Object.keys(body).length) throw invalid('Send an empty JSON object to use your saved inventory.');
    return send(response, 200, await mealIdea(store.inventory()));
  }
  throw missing('Route not found.');
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  response.setHeader('Vary', 'Origin');
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    await route(request, response);
  } catch (error) {
    if (response.destroyed) return;
    if (error instanceof ApiError) {
      send(response, error.status, { error: { code: error.code, message: error.message } });
    } else {
      console.error('Core request failed:', error);
      send(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Could not complete the request.' } });
    }
  }
});

server.listen(port, host, () => {
  console.log(`AppFusion core listening on http://${host}:${server.address().port}`);
});
