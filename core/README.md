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
