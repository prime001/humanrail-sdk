"""
Basic Escalation Example

Demonstrates creating a task, waiting for the human worker to complete it,
and handling the result. This is the simplest possible integration.

Run with: python examples/basic_escalation.py
"""

from __future__ import annotations

import os

from humanrail import EscalationClient, generate_idempotency_key


def main() -> None:
    # Initialize the client with your API key
    client = EscalationClient(
        api_key=os.environ["ESCALATION_API_KEY"],
        # base_url defaults to https://api.escalation.engine/v1
        # timeout defaults to 30s
        # max_retries defaults to 3 with exponential backoff
    )

    # Create a task for human review
    task = client.tasks.create(
        # Idempotency key ensures retries don't create duplicate tasks
        idempotency_key=generate_idempotency_key("example", "order-12345", "refund"),
        task_type="refund_eligibility",
        risk_tier="medium",
        sla_seconds=300,  # 5-minute SLA
        # Context provided to the human worker
        payload={
            "orderId": "order-12345",
            "orderTotal": 89.99,
            "reason": "Item arrived damaged",
            "policyText": (
                "Refunds are allowed within 30 days for damaged items. "
                "Customer must provide photo evidence."
            ),
        },
        # JSON Schema the worker's response must conform to
        output_schema={
            "type": "object",
            "required": ["eligible", "reason_code"],
            "properties": {
                "eligible": {"type": "boolean"},
                "reason_code": {
                    "type": "string",
                    "enum": ["approved", "denied_policy", "denied_timeframe", "needs_review"],
                },
                "notes": {"type": "string"},
            },
        },
        # Worker payout: $0.50 for this task
        payout={"currency": "USD", "maxAmount": 0.50},
        # Optional: receive webhook events at this URL
        callback_url="https://myapp.com/webhooks/escalation",
    )

    print(f"Task created: {task.id}")
    print(f"Status: {task.status}")  # "posted"
    print(f"Expires at: {task.expires_at}")

    # Wait for the task to be completed and verified
    # This polls every 2 seconds for up to 10 minutes
    print("\nWaiting for human worker to complete the task...")

    result = client.tasks.wait_for_completion(
        task.id,
        poll_interval=2.0,
        timeout=600.0,  # 10 minutes
    )

    print(f"\nTask completed!")
    print(f"Final status: {result.status}")  # "verified"
    print(f"Output: {result.output}")
    # => {"eligible": True, "reason_code": "approved", "notes": "Photo evidence confirms damage."}

    if result.payout_result:
        print(
            f"Worker paid: {result.payout_result.amount} "
            f"{result.payout_result.currency} via {result.payout_result.rail}"
        )

    # List recent verified tasks
    recent_tasks = client.tasks.list(status="verified", limit=10)
    print(f"\nRecent verified tasks: {len(recent_tasks.data)}")


if __name__ == "__main__":
    main()
