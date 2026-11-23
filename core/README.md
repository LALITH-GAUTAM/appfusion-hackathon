# Wellness fridge core API

The first demo scans one grocery receipt, lets the user correct the proposed items, adds the confirmed items to the fridge, and generates a meal idea from the saved inventory. The API serves one shared fridge in a single demo server process.

## Scan a receipt

`POST /api/receipts` with `Content-Type: application/json`. Send standard, padded base64 for a JPEG or PNG image up to 4 MiB.

```json
{"imageBase64":"<base64 image bytes>"}
```

`201 Created` returns editable OCR candidates. The scan leaves inventory unchanged. Review the names, quantities, and units before confirmation.

```json
{"receiptId":"b6735b16-3788-4733-839f-810a74a7e138","items":[{"name":"EGGS","quantity":1,"unit":"each"},{"name":"SPINACH","quantity":1,"unit":"each"}]}
```

## Confirm and read inventory

`POST /api/receipts/b6735b16-3788-4733-839f-810a74a7e138/confirm` accepts the corrected list. The user can edit, remove, or add rows. Send 1–100 items. Each item requires a name (1–100 characters), a positive numeric quantity (up to 10,000 with at most three decimal places), and a unit (1–24 characters). Use the same unit across scans for quantities that should combine.

```json
{"items":[{"name":"Eggs","quantity":12,"unit":"each"},{"name":"Spinach","quantity":1,"unit":"bag"}]}
```

`200 OK` returns the full current inventory. Items with matching names and units are combined case-insensitively. Retrying the same confirmation returns the current inventory without adding the items again. Edits to a completed confirmation return `409 RECEIPT_ALREADY_CONFIRMED`.

```json
{"items":[{"name":"Eggs","quantity":12,"unit":"each"},{"name":"Spinach","quantity":1,"unit":"bag"}]}
```

`GET /api/inventory` returns the same shape, with `{"items":[]}` for an empty fridge.

## Generate a meal idea

`POST /api/meals` with JSON `{}` uses the saved fridge inventory. Core forwards the same `{"items":[...]}` shape from the inventory response to the private AI service. Quantities are numbers, and units are strings. The default local AI endpoint is `POST http://127.0.0.1:8788/meal-suggestion`.

`200 OK` returns one meal idea. Any optional ingredients must be skippable. The optional list may be empty.

```json
{"title":"Spinach Omelet","ingredientsOnHand":["Eggs","Spinach"],"optionalMissingIngredients":["Chives"],"steps":["Wilt the spinach.","Beat the eggs and cook with the spinach until set."]}
```

## Errors

Errors include a stable code and a displayable message.

```json
{"error":{"code":"RECEIPT_UNREADABLE","message":"No grocery items were found. Try a clearer receipt photo."}}
```

| HTTP | Code | When it occurs |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Invalid JSON, image, item fields, or meal request |
| 404 | `NOT_FOUND` | Unknown route or receipt ID |
| 409 | `RECEIPT_ALREADY_CONFIRMED` | Submitted changes to a completed confirmation |
| 409 | `EMPTY_INVENTORY` | Meal requested before any groceries were added |
| 413 | `PAYLOAD_TOO_LARGE` | Request exceeds the route's body limit |
| 422 | `RECEIPT_UNREADABLE` | Scan yielded no usable rows |
| 503 | `RECEIPT_SCAN_UNAVAILABLE` | OCR process unavailable |
| 503 | `MEAL_SERVICE_UNAVAILABLE` | AI service unavailable, timed out, or returned invalid data |
| 500 | `INTERNAL_ERROR` | Core could not complete the request |

```json
{"error":{"code":"MEAL_SERVICE_UNAVAILABLE","message":"Meal suggestions are temporarily unavailable."}}
```

## Run locally

Requires Node.js 22+ and Tesseract with English language data. On macOS, install Tesseract with `brew install tesseract`. On Debian or Ubuntu, install `tesseract-ocr` and `tesseract-ocr-eng`.

Start the AI service with `node ai/server.mjs` from a checkout containing the AI backend, with its model configured as described in `ai/README.md`. Then start core from the repo root.

```sh
CORE_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 \
MEAL_SERVICE_URL=http://127.0.0.1:8788/meal-suggestion \
node core/server.mjs
```

The API base URL is `http://127.0.0.1:8787`. Set `CORE_CORS_ORIGINS` to the browser frontend's exact origin or comma-separated origins. A frontend served on the same origin can omit it. For a test phone on the same trusted network, start core with `CORE_HOST=0.0.0.0` and use `http://<computer-LAN-IP>:8787` from the phone. Include the frontend's LAN origin in the CORS list for a browser-based frontend. The core server is intended for a single demo fridge on a trusted machine or network.

Inventory and confirmation IDs persist in `core/.data/fridge.json`. Set `CORE_DATA_FILE` to a new file path for an empty demo or QA fridge. Use one core process per data file. Receipt images are temporarily written for OCR and removed when scanning completes. The OCR parser uses English receipt text and priced lines; the review step lets users fix abbreviations, counts, and missed rows.

Core sends up to 100 inventory entries to the AI service, with entries from the most recent confirmations first. The AI prompt can use up to 40 of those entries. Inventory storage and `GET /api/inventory` retain the full list.

To upload a fixture through the same HTTP API used by the frontend, run the following from a checkout containing the QA fixture.

```sh
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const imageBase64 = readFileSync(process.argv[1]).toString("base64");
  process.stdout.write(JSON.stringify({ imageBase64 }));
' qa/fixtures/grocery-receipt-0042.png |
  curl -sS -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:8787/api/receipts
```
