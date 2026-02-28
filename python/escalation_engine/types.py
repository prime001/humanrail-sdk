"""
Pydantic models for the Escalation Engine API.

All request/response types are defined here, providing runtime validation
and automatic serialization/deserialization for API interactions.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    """Status of a task as it moves through the escalation pipeline.

    Lifecycle: posted -> assigned -> submitted -> verified -> paid
    Terminal states: verified, failed, cancelled, expired
    """

    POSTED = "posted"
    ASSIGNED = "assigned"
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class RiskTier(str, Enum):
    """Risk tier that determines worker pool selection and verification depth."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class PayoutCurrency(str, Enum):
    """Currency for worker payouts."""

    USD = "USD"
    SATS = "SATS"
    BTC = "BTC"


class PayoutRail(str, Enum):
    """Payment rail used for payouts."""

    LIGHTNING = "lightning"
    STRIKE = "strike"
    INTERNAL = "internal"


class Payout(BaseModel):
    """Payout configuration for a task."""

    currency: PayoutCurrency
    """Currency for the payout."""

    max_amount: float = Field(alias="maxAmount")
    """Maximum amount to pay for this task (in the specified currency)."""

    model_config = {"populate_by_name": True}


class PayoutResult(BaseModel):
    """Payout details returned after a task is paid."""

    id: str
    """Unique payout identifier."""

    amount: float
    """Amount paid to the worker."""

    currency: PayoutCurrency
    """Currency of the payout."""

    rail: PayoutRail
    """Payment rail used."""

    paid_at: str = Field(alias="paidAt")
    """ISO 8601 timestamp of when the payout was executed."""

    model_config = {"populate_by_name": True}


class TaskCreateParams(BaseModel):
    """Request body for creating a new task."""

    idempotency_key: str = Field(alias="idempotencyKey")
    """Client-provided idempotency key. Prevents duplicate task creation on retry."""

    task_type: str = Field(alias="taskType")
    """The type of task (e.g., 'refund_eligibility', 'content_moderation')."""

    risk_tier: RiskTier = Field(default=RiskTier.MEDIUM, alias="riskTier")
    """Risk tier that determines routing and verification depth."""

    sla_seconds: int = Field(default=600, alias="slaSeconds")
    """SLA in seconds. The task must be completed within this window."""

    payload: dict[str, Any]
    """Arbitrary payload provided to the worker as context."""

    output_schema: dict[str, Any] = Field(alias="outputSchema")
    """JSON Schema that the worker's output must conform to."""

    payout: Payout
    """Payout configuration for the worker."""

    callback_url: str | None = Field(default=None, alias="callbackUrl")
    """Optional webhook URL to receive task lifecycle events."""

    metadata: dict[str, Any] | None = None
    """Optional metadata for client-side tracking. Not visible to workers."""

    model_config = {"populate_by_name": True}


class Task(BaseModel):
    """A task in the Escalation Engine."""

    id: str
    """Unique task identifier (UUID v7)."""

    idempotency_key: str = Field(alias="idempotencyKey")
    """The idempotency key provided at creation time."""

    status: TaskStatus
    """Current status in the task lifecycle."""

    task_type: str = Field(alias="taskType")
    """Task type identifier."""

    risk_tier: RiskTier = Field(alias="riskTier")
    """Risk tier for routing and verification."""

    sla_seconds: int = Field(alias="slaSeconds")
    """SLA deadline in seconds from creation."""

    payload: dict[str, Any]
    """The input payload provided at creation."""

    output_schema: dict[str, Any] = Field(alias="outputSchema")
    """JSON Schema for the expected output."""

    payout: Payout
    """Payout configuration."""

    callback_url: str | None = Field(default=None, alias="callbackUrl")
    """Callback URL for webhook events."""

    metadata: dict[str, Any] | None = None
    """Client metadata."""

    output: dict[str, Any] | None = None
    """The verified output from the worker. Only present when status is 'verified'."""

    payout_result: PayoutResult | None = Field(default=None, alias="payoutResult")
    """Payout details. Only present when status is 'verified' and payment is complete."""

    failure_reason: str | None = Field(default=None, alias="failureReason")
    """Failure reason. Only present when status is 'failed'."""

    created_at: str = Field(alias="createdAt")
    """ISO 8601 timestamp of task creation."""

    updated_at: str = Field(alias="updatedAt")
    """ISO 8601 timestamp of the last status update."""

    expires_at: str = Field(alias="expiresAt")
    """ISO 8601 deadline computed from created_at + sla_seconds."""

    model_config = {"populate_by_name": True}


class TaskCancelResult(BaseModel):
    """Response for the task cancel endpoint."""

    id: str
    """The task ID that was cancelled."""

    status: TaskStatus
    """Updated status (should be 'cancelled')."""

    cancelled_at: str = Field(alias="cancelledAt")
    """ISO 8601 timestamp of cancellation."""

    model_config = {"populate_by_name": True}


class TaskListParams(BaseModel):
    """Parameters for listing tasks."""

    status: TaskStatus | None = None
    """Filter by status."""

    task_type: str | None = None
    """Filter by task type."""

    limit: int = 20
    """Maximum number of tasks to return."""

    after: str | None = None
    """Cursor for pagination (task ID to start after)."""

    created_after: str | None = None
    """Filter by creation time (ISO 8601, inclusive)."""

    created_before: str | None = None
    """Filter by creation time (ISO 8601, inclusive)."""


class TaskListResponse(BaseModel):
    """Paginated list of tasks."""

    data: list[Task]
    """Array of tasks matching the query."""

    has_more: bool = Field(alias="hasMore")
    """Whether there are more results after this page."""

    next_cursor: str | None = Field(default=None, alias="nextCursor")
    """Cursor to pass as 'after' for the next page."""

    model_config = {"populate_by_name": True}


class WebhookEventType(str, Enum):
    """Webhook event types emitted by the Escalation Engine."""

    TASK_POSTED = "task.posted"
    TASK_ASSIGNED = "task.assigned"
    TASK_SUBMITTED = "task.submitted"
    TASK_VERIFIED = "task.verified"
    TASK_FAILED = "task.failed"
    TASK_CANCELLED = "task.cancelled"
    TASK_EXPIRED = "task.expired"


class WebhookEvent(BaseModel):
    """A webhook event delivered to the callback URL."""

    id: str
    """Unique event identifier."""

    type: WebhookEventType
    """Event type."""

    created_at: str = Field(alias="createdAt")
    """ISO 8601 timestamp of event creation."""

    data: Task
    """The task data at the time of the event."""

    model_config = {"populate_by_name": True}
