# HumanRail SDK

**Official client libraries for the HumanRail API**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![npm version](https://img.shields.io/npm/v/@humanrail/sdk)](https://www.npmjs.com/package/@humanrail/sdk)
[![PyPI version](https://img.shields.io/pypi/v/humanrail)](https://pypi.org/project/humanrail/)

---

HumanRail is an escalation layer for AI agents. When your AI hits a confidence or risk threshold, call our API to route the task to a vetted human worker pool. We verify the result, pay the worker, and return a structured response to your agent. These SDKs provide idiomatic, type-safe clients for the HumanRail API in TypeScript, Python, and Go.

**Website:** [humanrail.dev](https://humanrail.dev) | **Documentation:** [docs.humanrail.dev](https://docs.humanrail.dev)

---

## Installation

### TypeScript / JavaScript

```bash
npm install @humanrail/sdk
```

Requires Node.js 18+.

### Python

```bash
pip install humanrail
```

Requires Python 3.12+.

### Go

```bash
go get github.com/prime001/humanrail-sdk/go
```

Requires Go 1.22+.

---

## Quick Start

### TypeScript

```typescript
import { HumanRailClient } from "@humanrail/sdk";

const client = new HumanRailClient({
  apiKey: process.env.HUMANRAIL_API_KEY!,
});

// Create a task for human review
const task = await client.tasks.create({
  idempotencyKey: "order-12345-refund-check",
  taskType: "refund_eligibility",
  riskTier: "medium",
  slaSeconds: 300,
  payload: {
    orderId: "order-12345",
    reason: "Item arrived damaged",
  },
  outputSchema: {
    type: "object",
    required: ["eligible", "reason"],
    properties: {
      eligible: { type: "boolean" },
      reason: { type: "string" },
    },
  },
  payout: { currency: "USD", maxAmount: 0.50 },
});

console.log(`Task created: ${task.id} (status: ${task.status})`);

// Poll until a human completes the task
const result = await client.tasks.waitForCompletion(task.id, {
  pollIntervalMs: 2000,
  timeoutMs: 600_000, // 10 minutes
});

if (result.status === "verified") {
  console.log("Human verdict:", result.output);
  // => { eligible: true, reason: "Damage confirmed via photo" }
} else {
  console.log(`Task ended with status: ${result.status}`);
}
```

### Python

```python
from humanrail import HumanRailClient

client = HumanRailClient(api_key="hr_live_...")

task = client.tasks.create(
    idempotency_key="order-12345-refund-check",
    task_type="refund_eligibility",
    payload={"orderId": "order-12345", "reason": "Item arrived damaged"},
    output_schema={
        "type": "object",
        "required": ["eligible"],
        "properties": {"eligible": {"type": "boolean"}},
    },
    payout={"currency": "USD", "maxAmount": 0.50},
)

result = client.tasks.wait_for_completion(task.id, timeout=600)
print(result.status, result.output)
```

Async usage is also supported:

```python
async with HumanRailClient(api_key="hr_live_...") as client:
    task = await client.tasks.acreate(
        idempotency_key="ticket-9876-classify",
        task_type="ticket_classification",
        payload={"subject": "Can't log in", "body": "..."},
        output_schema={"type": "object", "required": ["category"]},
        payout={"currency": "USD", "maxAmount": 0.25},
    )
    result = await client.tasks.await_for_completion(task.id)
```

### Go

```go
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	humanrail "github.com/prime001/humanrail-sdk/go/humanrail"
)

func main() {
	client := humanrail.NewClient("hr_live_...",
		humanrail.WithTimeout(10*time.Second),
	)

	ctx := context.Background()

	task, err := client.CreateTask(ctx, humanrail.TaskCreateRequest{
		IdempotencyKey: "order-12345-refund-check",
		TaskType:       "refund_eligibility",
		Payload:        map[string]any{"orderId": "order-12345"},
		OutputSchema:   map[string]any{"type": "object"},
		Payout:         humanrail.Payout{Currency: "USD", MaxAmount: 0.50},
	})
	if err != nil {
		log.Fatal(err)
	}

	result, err := client.WaitForCompletion(ctx, task.ID, &humanrail.WaitOptions{
		PollInterval: 2 * time.Second,
		Timeout:      10 * time.Minute,
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Status: %s, Output: %v\n", result.Status, result.Output)
}
```

---

## Features

- **Typed responses** -- Full type definitions in all three languages. TypeScript types, Python Pydantic models, Go structs.
- **Automatic retries with backoff** -- Retries on 429, 500, 502, 503, 504 with configurable exponential, linear, or fixed backoff.
- **Idempotency support** -- Every mutating request accepts an `idempotency_key`. A built-in `generateIdempotencyKey` helper produces deterministic SHA-256 keys from a namespace and parts.
- **Webhook signature verification** -- HMAC-SHA256 signature checking with timestamp tolerance to prevent replay attacks.
- **OpenTelemetry tracing** -- Instrumentation hooks for distributed tracing across your agent pipeline.
- **Polling and webhooks** -- Use `waitForCompletion` for simple polling, or configure webhook endpoints for event-driven workflows.
- **Async support** -- The Python SDK provides both synchronous and asynchronous interfaces. The Go SDK uses context-based cancellation.

---

## Webhook Verification

HumanRail signs every webhook payload with HMAC-SHA256. The signature header (`X-HumanRail-Signature`) has the format:

```
t=<unix-timestamp>,v1=<hex-hmac>
```

The signed content is `<timestamp>.<raw-body>`. Always verify signatures before processing webhook events.

### TypeScript

```typescript
import { verifyWebhookSignature } from "@humanrail/sdk";

app.post("/webhooks/humanrail", (req, res) => {
  const isValid = verifyWebhookSignature({
    payload: req.body,                                  // raw body string
    signature: req.headers["x-humanrail-signature"],
    secret: process.env.HUMANRAIL_WEBHOOK_SECRET!,
    tolerance: 300,                                     // reject if older than 5 minutes
  });

  if (!isValid) {
    return res.status(401).send("Invalid signature");
  }

  const event = JSON.parse(req.body);
  // Handle event.type: "task.verified", "task.failed", etc.
  res.status(200).send("OK");
});
```

### Python

```python
from humanrail import verify_webhook_signature

@app.post("/webhooks/humanrail")
def handle_webhook(request):
    is_valid = verify_webhook_signature(
        payload=request.body.decode(),
        signature=request.headers["X-HumanRail-Signature"],
        secret=WEBHOOK_SECRET,
        tolerance=300,
    )

    if not is_valid:
        return Response(status_code=401)

    event = request.json()
    # Handle event["type"]: "task.verified", "task.failed", etc.
    return Response(status_code=200)
```

### Go

```go
import "github.com/prime001/humanrail-sdk/go/humanrail"

func webhookHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)

    valid := humanrail.VerifyWebhookSignature(humanrail.WebhookVerifyParams{
        Payload:   string(body),
        Signature: r.Header.Get("X-HumanRail-Signature"),
        Secret:    os.Getenv("HUMANRAIL_WEBHOOK_SECRET"),
        Tolerance: 300,
    })

    if !valid {
        http.Error(w, "Invalid signature", http.StatusUnauthorized)
        return
    }

    // Parse and handle event
    w.WriteHeader(http.StatusOK)
}
```

---

## SDK Documentation

| Language | Package | Docs |
|----------|---------|------|
| TypeScript | [@humanrail/sdk](https://www.npmjs.com/package/@humanrail/sdk) | [docs.humanrail.dev/sdk/typescript](https://docs.humanrail.dev/sdk/typescript) |
| Python | [humanrail](https://pypi.org/project/humanrail/) | [docs.humanrail.dev/sdk/python](https://docs.humanrail.dev/sdk/python) |
| Go | [github.com/prime001/humanrail-sdk/go](https://pkg.go.dev/github.com/prime001/humanrail-sdk/go) | [docs.humanrail.dev/sdk/go](https://docs.humanrail.dev/sdk/go) |

The full API reference is available at [docs.humanrail.dev/api](https://docs.humanrail.dev/api). The OpenAPI 3.1 spec is included in the [`openapi/`](./openapi) directory of this repository.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a pull request.

To get started:

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make your changes and add tests.
4. Open a pull request with a clear description of the change.

Bug reports and feature requests can be filed via [GitHub Issues](https://github.com/prime001/humanrail-sdk/issues).

---

## License

This project is licensed under the [MIT License](./LICENSE).

---

## Contact

For questions, support, or partnership inquiries: [contact@humanrail.dev](mailto:contact@humanrail.dev)
