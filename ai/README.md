# Meal suggestions

After a user reviews a grocery receipt and confirms the items, the core app sends the current fridge inventory to this service. The service returns one meal with ingredients already on hand, optional extras the user can skip, and short preparation steps.

## Run locally

Use Node.js 22 or later and Ollama on the same host as the core app. Run these commands from the repo root. Start Ollama in a separate terminal if it is not already running.

```sh
ollama serve
```

```sh
ollama pull gpt-oss:20b
node ai/server.mjs
```

Set `MEAL_SERVICE_URL=http://127.0.0.1:8788/meal-suggestion` in the **core server** environment before starting it. The frontend sends `POST /api/meals` with `{}` to core. Core supplies the saved inventory to the private service. Allow more than 30 seconds in core's upstream timeout so it can receive the service's own timeout response.

The private service binds to loopback and calls Ollama at `http://127.0.0.1:11434` by default. This local setup requires no model credentials. Configure `APPFUSION_MEAL_PORT`, `APPFUSION_OLLAMA_URL`, and `APPFUSION_MEAL_MODEL` in the meal service process if needed. The configured model must support Ollama's JSON Schema output and low thinking mode.

## Private HTTP contract

```sh
curl --fail-with-body --max-time 35 \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"name":"eggs","quantity":2,"unit":"each"},{"name":"spinach","quantity":1,"unit":"cup"},{"name":"cooked rice","quantity":1,"unit":"cup"}]}' \
  http://127.0.0.1:8788/meal-suggestion
```

A real call returned HTTP 200 in 16.3 seconds on the development Mac:

```json
{
  "title": "Spinach‑Egg Rice Skillet",
  "ingredientsOnHand": ["eggs", "spinach", "cooked rice"],
  "optionalMissingIngredients": ["salt", "pepper", "cheese"],
  "steps": [
    "Heat a small skillet over medium heat.",
    "Add the spinach and cook until wilted, about 1‑2 min.",
    "Beat the eggs in a bowl, pour into the skillet, and scramble until just set.",
    "Fold in the cooked rice, stirring to combine and heat through.",
    "If you like, season with salt and pepper (or sprinkle cheese on top)."
  ]
}
```

Inventory accepts 1–40 items. Names and units are trimmed and capped at 80 and 40 characters. Quantities must be finite positive numbers. The response includes up to ten exact inventory names, zero to three optional extras, and one to five steps.

| Status | Error code | Condition |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Malformed JSON |
| 400 | `EMPTY_INVENTORY` | The items array is empty |
| 400 | `INVALID_INVENTORY` | Inventory is missing, exceeds 40 items, or contains an invalid name, quantity, or unit |
| 413 | `BODY_TOO_LARGE` | Body exceeds 32 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Request lacks an `application/json` content type |
| 502 | `AI_UNAVAILABLE` | Ollama is unreachable, returns an error, or produces incomplete or invalid output |
| 504 | `AI_TIMEOUT` | Ollama does not finish within 30 seconds |

An empty inventory returns:

```json
{"error":{"code":"EMPTY_INVENTORY","message":"Add at least one item to your fridge first."}}
```

Core reports provider failures through the public API as HTTP 503 with `error.code` set to `MEAL_SERVICE_UNAVAILABLE`.

## Verify

```sh
node --test ai/server.test.mjs
```

The automated tests start the private HTTP service and stub Ollama to verify validation, provider errors, invented and truncated output, and a timeout during the response body. Run the curl command above separately with Ollama running to verify real inference.

## Demo and judging notes

- This feature uses `gpt-oss:20b` through local Ollama. Only normalized inventory goes into the prompt. Receipt images and raw receipt text stay outside the meal service.
- Runtime validation checks the response shape and matches the named on-hand ingredients to the inventory. The generated steps can still make mistakes about quantities, allergens, or cooking instructions. Treat the result as a suggestion.
- Startup adds model-loading latency. Run one suggestion on the demo host before recording. Keep Ollama and the meal service running while testing the phone flow.
