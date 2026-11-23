import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createMealServer } from './server.mjs';

const items = [
  { name: 'Eggs', quantity: 2, unit: 'each' },
  { name: 'Spinach', quantity: 1, unit: 'cup' },
  { name: 'Cooked rice', quantity: 1, unit: 'cup' },
];
const sample = {
  title: 'Spinach and Egg Fried Rice',
  ingredientsOnHand: ['Eggs', 'Spinach', 'Cooked rice'],
  optionalMissingIngredients: ['soy sauce'],
  steps: ['Scramble the eggs, wilt the spinach, then stir in cooked rice until hot.'],
};

async function listen(context, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function start(context, providerHandler, timeoutMs = 1000) {
  const providerUrl = await listen(context, createServer(providerHandler));
  const url = await listen(context, createMealServer({ ollamaUrl: providerUrl, timeoutMs }));
  return body => fetch(`${url}/meal-suggestion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

function sendMeal(response, meal, doneReason = 'stop') {
  response.end(JSON.stringify({
    done: true,
    done_reason: doneReason,
    response: JSON.stringify(meal),
  }));
}

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
}

test('returns the agreed success shape and sends normalized inventory and schema to Ollama', async context => {
  let forwarded;
  const call = await start(context, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    forwarded = { path: request.url, body: JSON.parse(Buffer.concat(chunks)) };
    sendMeal(response, sample);
  });

  const response = await call(JSON.stringify({ items }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sample);
  assert.equal(forwarded.path, '/api/generate');
  assert.deepEqual(JSON.parse(forwarded.body.prompt), { items });
  assert.deepEqual(forwarded.body.format.properties.ingredientsOnHand.items.enum,
    ['Eggs', 'Spinach', 'Cooked rice']);
});

test('rejects invalid inventory, malformed JSON, and oversized bodies before contacting Ollama', async context => {
  let providerCalls = 0;
  const call = await start(context, (_, response) => {
    providerCalls += 1;
    response.end();
  });

  await assertError(await call('{"items":[]}'), 400, 'EMPTY_INVENTORY');
  await assertError(await call('{}'), 400, 'INVALID_INVENTORY');
  await assertError(await call('{"items":[null]}'), 400, 'INVALID_INVENTORY');
  await assertError(await call('{"items":[{"name":"Eggs","quantity":"2","unit":"each"}]}'),
    400, 'INVALID_INVENTORY');
  await assertError(await call('{'), 400, 'INVALID_JSON');
  await assertError(await call(' '.repeat(32 * 1024 + 1)), 413, 'BODY_TOO_LARGE');
  assert.equal(providerCalls, 0);
});

test('sanitizes provider errors', async context => {
  const call = await start(context, (_, response) => {
    response.writeHead(503);
    response.end('private provider diagnostics');
  });

  await assertError(await call(JSON.stringify({ items })), 502, 'AI_UNAVAILABLE');
});

test('rejects invented on-hand ingredients and truncated output', async context => {
  let providerCalls = 0;
  const call = await start(context, (_, response) => {
    providerCalls += 1;
    if (providerCalls === 1) {
      sendMeal(response, { ...sample, ingredientsOnHand: ['chicken'] });
    } else {
      sendMeal(response, sample, 'length');
    }
  });

  await assertError(await call(JSON.stringify({ items })), 502, 'AI_UNAVAILABLE');
  await assertError(await call(JSON.stringify({ items })), 502, 'AI_UNAVAILABLE');
});

test('times out even if the provider sends headers before stalling', async context => {
  const call = await start(context, (_, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.flushHeaders();
  }, 200);

  await assertError(await call(JSON.stringify({ items })), 504, 'AI_TIMEOUT');
});
