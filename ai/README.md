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
  -d '{"items":[{"name":"Eggs","quantity":1,"unit":"each"},{"name":"Spinach","quantity":1,"unit":"each"},{"name":"Rice","quantity":1,"unit":"each"}]}' \
  http://127.0.0.1:8788/meal-suggestion
```

A real call with that inventory returned HTTP 200 in 4.50 seconds on the development Mac with the model already loaded:

```json
{
  "title": "Spinach Egg Fried Rice",
  "ingredientsOnHand": ["Eggs", "Spinach", "Rice"],
  "optionalMissingIngredients": [],
  "steps": [
    "Cook the rice in plain water until tender, then set aside.",
    "Heat a nonstick pan over medium heat.",
    "Add the spinach to the pan and stir until wilted.",
    "Push spinach to the side, crack the egg into the pan, scramble until set, then mix with spinach.",
    "Fold in the cooked rice, stir until everything is heated through, and serve."
  ]
}
```

Inventory accepts 1–100 items. Names and units are trimmed and capped at 100 and 40 characters. Quantities must be finite positive numbers and can exceed the per-receipt limit after aggregation. The model sees the first 40 items in request order. The response includes up to ten exact inventory names, zero to three optional extras, and one to five required steps. Optional extras appear in their own list. Plain water for cooking is assumed available.

| Status | Error code | Condition |
| --- | --- | --- |
| 400 | `INVALID_JSON` | Malformed JSON |
| 400 | `EMPTY_INVENTORY` | The items array is empty |
| 400 | `INVALID_INVENTORY` | Inventory is missing, exceeds 100 items, or contains an invalid name, quantity, or unit |
| 413 | `BODY_TOO_LARGE` | Body exceeds 128 KiB |
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

The seven automated tests start the private HTTP service and stub Ollama. They exercise inventory validation, provider errors, response truncation, a timeout during the response body, and the regression for dry rice and required extras. Run the curl command above separately with Ollama running to verify real inference. A separate live request with 100 inventory rows returned HTTP 200 in 4.41 seconds.

## Demo and judging notes

- This feature uses `gpt-oss:20b` through local Ollama. The model sees up to 40 normalized inventory items. Receipt images and raw receipt text stay outside the meal service.
- Runtime validation checks the response shape, matches on-hand names to the inventory, and checks for specific recipe errors like unlisted oil or missing rice preparation. The generated steps can still make mistakes about quantities, allergens, or cooking instructions. Treat the result as a suggestion.
- Startup adds model-loading latency. Run one suggestion on the demo host before recording. Keep Ollama and the meal service running while testing the phone flow.
