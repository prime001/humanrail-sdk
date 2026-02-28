# HumanRail Python SDK

Official Python client library for the [HumanRail](https://humanrail.dev) API.

Route tasks to vetted human workers when your AI hits its limits. Verified results. Instant payouts. One API call.

## Installation

```bash
pip install humanrail
```

Requires Python 3.12+.

## Quick Start

```python
import os
from humanrail import EscalationClient

client = EscalationClient(api_key=os.environ["HUMANRAIL_API_KEY"])

task = client.tasks.create(
    idempotency_key="order-12345-refund",
    task_type="refund_eligibility",
    risk_tier="medium",
    sla_seconds=300,
    payload={
        "orderId": "order-12345",
        "reason": "Item arrived damaged",
    },
    output_schema={
        "type": "object",
        "required": ["eligible", "reason_code"],
        "properties": {
            "eligible": {"type": "boolean"},
            "reason_code": {"type": "string", "enum": ["approved", "denied_policy", "needs_review"]},
        },
    },
    payout={"currency": "USD", "max_amount": 0.50},
)

result = client.tasks.wait_for_completion(task.id, timeout=600)
print(result.output)
# {"eligible": True, "reason_code": "approved"}
```

### Async Usage

```python
from humanrail import AsyncEscalationClient

async_client = AsyncEscalationClient(api_key=os.environ["HUMANRAIL_API_KEY"])
task = await async_client.tasks.acreate(...)
result = await async_client.tasks.await_for_completion(task.id)
```

## Features

- Synchronous and async clients
- Automatic retries with exponential backoff
- Webhook signature verification (HMAC-SHA256)
- Idempotency support
- Typed responses with Pydantic models
- OpenTelemetry tracing

## Documentation

- [API Docs](https://docs.humanrail.dev)
- [SDK Guide](https://docs.humanrail.dev/sdk/python)
- [Examples](https://github.com/prime001/humanrail-sdk/tree/main/python/examples)

## License

MIT - see [LICENSE](https://github.com/prime001/humanrail-sdk/blob/main/LICENSE)
