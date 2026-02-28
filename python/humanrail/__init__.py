"""
Escalation Engine SDK — Official Python client library.

Route tasks to vetted human workers when AI hits its limits.

Example::

    import os
    from humanrail import EscalationClient

    client = EscalationClient(api_key=os.environ["ESCALATION_API_KEY"])

    task = client.tasks.create(
        idempotency_key="order-12345-refund-check",
        task_type="refund_eligibility",
        payload={"orderId": "order-12345"},
        output_schema={"type": "object", "required": ["eligible"], "properties": {"eligible": {"type": "boolean"}}},
        payout={"currency": "USD", "maxAmount": 0.50},
    )

    result = client.tasks.wait_for_completion(task.id, timeout=600)
    print(result.output)
"""

from __future__ import annotations

from .client import EscalationClient, generate_idempotency_key
from .errors import (
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    EscalationError,
    RateLimitError,
    ServerError,
    TaskNotFoundError,
    TimeoutError,
    ValidationError,
)
from .types import (
    Payout,
    PayoutCurrency,
    PayoutResult,
    PayoutRail,
    RiskTier,
    Task,
    TaskCancelResult,
    TaskCreateParams,
    TaskListParams,
    TaskListResponse,
    TaskStatus,
    WebhookEvent,
    WebhookEventType,
)
from .webhook import construct_webhook_signature, verify_webhook_signature

__all__ = [
    # Client
    "EscalationClient",
    "generate_idempotency_key",
    # Errors
    "EscalationError",
    "AuthenticationError",
    "AuthorizationError",
    "RateLimitError",
    "ValidationError",
    "TaskNotFoundError",
    "TimeoutError",
    "ConflictError",
    "ServerError",
    # Types
    "Task",
    "TaskCreateParams",
    "TaskStatus",
    "TaskCancelResult",
    "TaskListParams",
    "TaskListResponse",
    "RiskTier",
    "Payout",
    "PayoutCurrency",
    "PayoutResult",
    "PayoutRail",
    "WebhookEvent",
    "WebhookEventType",
    # Webhook
    "verify_webhook_signature",
    "construct_webhook_signature",
]
