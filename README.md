# AppFusion Hackathon

Team workspace for the TRUSU AI Club’s AppFusion hackathon.

## Wellness fridge demo

Scan a grocery receipt, correct the proposed items, add them to your fridge, and generate a meal idea from the saved inventory. The UI calls the [core HTTP API](core/README.md). Core calls the [local AI meal service](ai/README.md).

### Run both backends

Install Node.js 22+, Tesseract with English language data, and Ollama. Use separate terminals from this checkout.

```sh
ollama serve
```

```sh
ollama pull gpt-oss:20b
node ai/server.mjs
```

```sh
fridge_demo_dir="$(mktemp -d)"
CORE_DATA_FILE="$fridge_demo_dir/fridge.json" \
CORE_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 \
MEAL_SERVICE_URL=http://127.0.0.1:8788/meal-suggestion \
node core/server.mjs
```

The UI connects to `http://127.0.0.1:8787`. For a phone on the same trusted network, use `CORE_HOST=0.0.0.0` and the computer's LAN IP. For a browser frontend on a different origin, include its exact origin in `CORE_CORS_ORIGINS`.

### Verify the flow

Follow the [QA receipt fixture](qa/fixtures/grocery-receipt-0042-expected.txt). The [core API guide](core/README.md#run-locally) includes the receipt upload command. Confirm the corrected items with the receipt ID from that upload, then call `GET /api/inventory` to check the saved items.

```sh
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8787/api/meals
```

To check recovery, stop the AI server and repeat the meal request. Expect a `503 MEAL_SERVICE_UNAVAILABLE` response. Verify that `GET /api/inventory` still returns the saved items, restart the AI server with `node ai/server.mjs`, and retry the meal request.

## Deadlines · Kamloops time

| When | What |
| --- | --- |
| Monday, Nov 23, 2026, 2:00 p.m. | Submit the project. Late entries are ineligible for judging. |
| Monday, Nov 23, 2026, 4:45 p.m. | Check in at Old Main, room OM 2791. |
| Monday, Nov 23, 2026, 5:00–7:00 p.m. | Presentations and awards. |

[Event page](https://aiclubtrusu.vercel.app/events/appfusion) · [Official student guide](https://aiclubtrusu.vercel.app/events/appfusion/guide) · [Submission form](https://aiclubtrusu.vercel.app/events/appfusion/submit)

## Build requirements

- [ ] Pick a specific user group, a real problem, and a category. Categories include event planning, fitness and wellbeing, student life and learning, productivity, community and accessibility, sustainability, or a custom category.
- [ ] Build a mobile app that runs on a phone or emulator. An installable web app (PWA) qualifies.
- [ ] Implement one working core feature and at least one working AI feature that helps solve the problem as part of the app flow.
- [ ] Test the main flow, bad input, and connectivity or AI failures. Write down what changed after testing.
- [ ] If reusing an app or course project, document what existed before Nov 20 and what changed during the hackathon. Existing AI models and AI coding tools are allowed.

## Submission checklist

- [ ] Team name, both full names, and a contact email.
- [ ] App name, category, and problem statement.
- [ ] What the AI feature does, its model or service, and what was built during the hackathon. Disclosing AI coding tools and their use is optional.
- [ ] Repo link that judges can view. This team repo starts private. Confirm judges can access the repo before submitting.
- [ ] One Google Drive folder with a **2–3 minute demo video**, **3–5 screenshots**, and optional slides. Set access to **Anyone with the link can view** and test the links in a private window.
- [ ] Submit by **2 p.m.** The form allows resubmissions before the deadline and uses the latest entry.

## Presentation and judging

You have **5 minutes total**, including the recorded demo, followed by **2 minutes of Q&A**. Organizers play the submitted files. Use the demo to show the working core feature and the AI in one flow. Be ready to explain why the AI belongs in the app, how it was tested, and its limits.

| Criterion | Points |
| --- | ---: |
| Core functionality and AI | 15 |
| Usefulness | 10 |
| Usability and accessibility | 5 |
| Creativity | 5 |
| Presentation and demonstration | 15 |

[Full judging rubric](https://aiclubtrusu.vercel.app/events/appfusion/guide#criterion-A)
