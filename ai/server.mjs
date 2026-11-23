import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { MealSuggestionError, suggestMeal } from './meal-suggestion.mjs';

const MAX_BODY_BYTES = 32 * 1024;
const MEAL_PATH = '/meal-suggestion';

const MEAL_ERROR_STATUS = {
  EMPTY_INVENTORY: 400,
  INVALID_INVENTORY: 400,
  AI_UNAVAILABLE: 502,
  AI_TIMEOUT: 504,
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}

async function handleMeal(request, response, mealOptions) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return sendError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request.');
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      response.setHeader('Connection', 'close');
      request.resume();
      return sendError(response, 413, 'BODY_TOO_LARGE', 'The request body exceeds 32 KiB.');
    }
    chunks.push(chunk);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch {
    return sendError(response, 400, 'INVALID_JSON', 'Send a valid JSON request body.');
  }

  try {
    const meal = await suggestMeal(payload?.items, mealOptions);
    return sendJson(response, 200, meal);
  } catch (error) {
    if (!(error instanceof MealSuggestionError)) throw error;
    return sendError(response, MEAL_ERROR_STATUS[error.code], error.code, error.message);
  }
}

export function createMealServer(mealOptions) {
  return createServer(async (request, response) => {
    if (request.url !== MEAL_PATH) {
      request.resume();
      return sendError(response, 404, 'NOT_FOUND', 'Meal suggestion route not found.');
    }
    if (request.method !== 'POST') {
      request.resume();
      response.setHeader('Allow', 'POST');
      return sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Use POST for meal suggestions.');
    }

    try {
      await handleMeal(request, response, mealOptions);
    } catch {
      if (!response.destroyed) {
        sendError(response, 500, 'INTERNAL_ERROR', 'The meal service could not process this request.');
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.APPFUSION_MEAL_PORT ?? 8788);
  createMealServer().listen(port, '127.0.0.1', () => {
    console.log(`Meal suggestion service listening at http://127.0.0.1:${port}${MEAL_PATH}`);
  });
}
