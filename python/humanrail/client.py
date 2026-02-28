"""
Main client for the Escalation Engine API.

Provides both synchronous and asynchronous interfaces via httpx.

Example::

    from humanrail import EscalationClient

    client = EscalationClient(api_key="ek_live_...")
    task = client.tasks.create(
        idempotency_key="order-12345-refund",
        task_type="refund_eligibility",
        payload={"orderId": "order-12345"},
        output_schema={"type": "object", "required": ["eligible"], "properties": {"eligible": {"type": "boolean"}}},
        payout={"currency": "USD", "maxAmount": 0.50},
    )
    result = client.tasks.wait_for_completion(task.id, timeout=600)
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from .errors import (
    AuthenticationError,
    EscalationError,
    build_api_error,
)
from .retry import (
    AttemptResult,
    BackoffStrategy,
    RetryConfig,
    execute_with_retry_async,
    execute_with_retry_sync,
    is_retryable_status_code,
)
from .types import (
    Payout,
    Task,
    TaskCancelResult,
    TaskCreateParams,
    TaskListParams,
    TaskListResponse,
    TaskStatus,
)
from .errors import TimeoutError as EscalationTimeoutError

SDK_VERSION = "0.1.0"
DEFAULT_BASE_URL = "https://api.escalation.engine/v1"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 3

TERMINAL_STATUSES = frozenset({
    TaskStatus.VERIFIED,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED,
    TaskStatus.EXPIRED,
})


class EscalationClient:
    """Main client for the Escalation Engine API.

    Supports both synchronous and asynchronous usage. For async, use the
    ``async_tasks`` property or call ``acreate``, ``aget``, etc. directly.

    Args:
        api_key: API key for authentication.
        base_url: Base URL of the Escalation Engine API.
        timeout: Request timeout in seconds.
        max_retries: Maximum number of retries for failed requests.
        retry_backoff: Backoff strategy ('exponential', 'linear', or 'none').
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_backoff: str = "exponential",
    ) -> None:
        if not api_key:
            raise AuthenticationError(
                "API key is required. Pass it as `api_key` or set the "
                "ESCALATION_API_KEY environment variable."
            )

        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._retry_config = RetryConfig(
            max_retries=max_retries,
            backoff=BackoffStrategy(retry_backoff),
        )

        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": f"escalation-engine-sdk-python/{SDK_VERSION}",
        }

        self._sync_client: httpx.Client | None = None
        self._async_client: httpx.AsyncClient | None = None

        self.tasks = TasksResource(self)

    @property
    def _sync(self) -> httpx.Client:
        """Lazily create the synchronous httpx client."""
        if self._sync_client is None:
            self._sync_client = httpx.Client(
                base_url=self._base_url,
                headers=self._headers,
                timeout=self._timeout,
            )
        return self._sync_client

    @property
    def _async(self) -> httpx.AsyncClient:
        """Lazily create the asynchronous httpx client."""
        if self._async_client is None:
            self._async_client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=self._timeout,
            )
        return self._async_client

    def close(self) -> None:
        """Close the synchronous HTTP client."""
        if self._sync_client is not None:
            self._sync_client.close()
            self._sync_client = None

    async def aclose(self) -> None:
        """Close the asynchronous HTTP client."""
        if self._async_client is not None:
            await self._async_client.aclose()
            self._async_client = None

    def __enter__(self) -> EscalationClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    async def __aenter__(self) -> EscalationClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    def _request_sync(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        """Send an authenticated synchronous HTTP request with retries."""

        def attempt(attempt_num: int) -> AttemptResult:
            headers: dict[str, str] = {}
            if idempotency_key:
                headers["Idempotency-Key"] = idempotency_key

            try:
                response = self._sync.request(
                    method,
                    path,
                    json=body,
                    params=_clean_query(query),
                    headers=headers,
                )
            except httpx.TimeoutException as exc:
                return AttemptResult(
                    error=EscalationTimeoutError(
                        f"Request to {method} {path} timed out after {self._timeout}s",
                        timeout_seconds=self._timeout,
                    ),
                    should_retry=True,
                )
            except httpx.HTTPError as exc:
                return AttemptResult(
                    error=EscalationError(f"Network error: {exc}"),
                    should_retry=True,
                )

            request_id = response.headers.get("x-request-id")

            if response.is_success:
                return AttemptResult(response=response.json(), should_retry=False)

            error_body = _parse_error_body(response)
            retry_after = _parse_retry_after(response)
            error = build_api_error(response.status_code, error_body, request_id, retry_after)

            if is_retryable_status_code(response.status_code):
                return AttemptResult(
                    status_code=response.status_code,
                    error=error,
                    retry_after=retry_after,
                    should_retry=True,
                )

            return AttemptResult(error=error, should_retry=False)

        return execute_with_retry_sync(attempt, self._retry_config)

    async def _request_async(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        """Send an authenticated asynchronous HTTP request with retries."""

        async def attempt(attempt_num: int) -> AttemptResult:
            headers: dict[str, str] = {}
            if idempotency_key:
                headers["Idempotency-Key"] = idempotency_key

            try:
                response = await self._async.request(
                    method,
                    path,
                    json=body,
                    params=_clean_query(query),
                    headers=headers,
                )
            except httpx.TimeoutException:
                return AttemptResult(
                    error=EscalationTimeoutError(
                        f"Request to {method} {path} timed out after {self._timeout}s",
                        timeout_seconds=self._timeout,
                    ),
                    should_retry=True,
                )
            except httpx.HTTPError as exc:
                return AttemptResult(
                    error=EscalationError(f"Network error: {exc}"),
                    should_retry=True,
                )

            request_id = response.headers.get("x-request-id")

            if response.is_success:
                return AttemptResult(response=response.json(), should_retry=False)

            error_body = _parse_error_body(response)
            retry_after = _parse_retry_after(response)
            error = build_api_error(response.status_code, error_body, request_id, retry_after)

            if is_retryable_status_code(response.status_code):
                return AttemptResult(
                    status_code=response.status_code,
                    error=error,
                    retry_after=retry_after,
                    should_retry=True,
                )

            return AttemptResult(error=error, should_retry=False)

        return await execute_with_retry_async(attempt, self._retry_config)


class TasksResource:
    """Namespaced resource for task operations.

    Accessed via ``client.tasks``. Provides both sync and async methods.
    """

    def __init__(self, client: EscalationClient) -> None:
        self._client = client

    # ── Synchronous Methods ──────────────────────────────────────────────

    def create(
        self,
        *,
        idempotency_key: str,
        task_type: str,
        payload: dict[str, Any],
        output_schema: dict[str, Any],
        payout: dict[str, Any] | Payout,
        risk_tier: str = "medium",
        sla_seconds: int = 600,
        callback_url: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Task:
        """Create a new task for human review (synchronous).

        If a task with the same ``idempotency_key`` already exists, the existing
        task is returned (idempotent).

        Args:
            idempotency_key: Prevents duplicate task creation on retry.
            task_type: The type of task (e.g., 'refund_eligibility').
            payload: Context provided to the human worker.
            output_schema: JSON Schema the worker's output must conform to.
            payout: Payout configuration for the worker.
            risk_tier: Risk tier for routing ('low', 'medium', 'high', 'critical').
            sla_seconds: SLA in seconds. Defaults to 600.
            callback_url: Optional webhook URL for task events.
            metadata: Optional client-side tracking metadata.

        Returns:
            The created (or existing) Task.
        """
        payout_dict = payout.model_dump(by_alias=True) if isinstance(payout, Payout) else payout
        body: dict[str, Any] = {
            "idempotencyKey": idempotency_key,
            "taskType": task_type,
            "riskTier": risk_tier,
            "slaSeconds": sla_seconds,
            "payload": payload,
            "outputSchema": output_schema,
            "payout": payout_dict,
        }
        if callback_url is not None:
            body["callbackUrl"] = callback_url
        if metadata is not None:
            body["metadata"] = metadata

        data = self._client._request_sync(
            "POST", "/tasks", body=body, idempotency_key=idempotency_key
        )
        return Task.model_validate(data)

    def get(self, task_id: str) -> Task:
        """Retrieve a task by its ID (synchronous).

        Args:
            task_id: The unique task identifier.

        Returns:
            The Task.

        Raises:
            TaskNotFoundError: If the task does not exist.
        """
        data = self._client._request_sync("GET", f"/tasks/{quote(task_id, safe='')}")
        return Task.model_validate(data)

    def cancel(self, task_id: str) -> TaskCancelResult:
        """Cancel a task that has not yet reached a terminal state (synchronous).

        Args:
            task_id: The unique task identifier.

        Returns:
            Cancellation confirmation.

        Raises:
            ConflictError: If the task cannot be cancelled.
        """
        data = self._client._request_sync("POST", f"/tasks/{quote(task_id, safe='')}/cancel")
        return TaskCancelResult.model_validate(data)

    def list(
        self,
        *,
        status: str | TaskStatus | None = None,
        task_type: str | None = None,
        limit: int = 20,
        after: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
    ) -> TaskListResponse:
        """List tasks with optional filters and pagination (synchronous).

        Args:
            status: Filter by task status.
            task_type: Filter by task type.
            limit: Maximum number of tasks to return (default 20).
            after: Cursor for pagination.
            created_after: Filter by creation time (ISO 8601).
            created_before: Filter by creation time (ISO 8601).

        Returns:
            A paginated TaskListResponse.
        """
        query: dict[str, Any] = {"limit": limit}
        if status is not None:
            query["status"] = status.value if isinstance(status, TaskStatus) else status
        if task_type is not None:
            query["task_type"] = task_type
        if after is not None:
            query["after"] = after
        if created_after is not None:
            query["created_after"] = created_after
        if created_before is not None:
            query["created_before"] = created_before

        data = self._client._request_sync("GET", "/tasks", query=query)
        return TaskListResponse.model_validate(data)

    def wait_for_completion(
        self,
        task_id: str,
        *,
        poll_interval: float = 2.0,
        timeout: float = 600.0,
    ) -> Task:
        """Poll a task until it reaches a terminal state (synchronous).

        Args:
            task_id: The unique task identifier.
            poll_interval: Seconds between polls. Defaults to 2.0.
            timeout: Maximum wait time in seconds. Defaults to 600.

        Returns:
            The Task in its terminal state.

        Raises:
            TimeoutError: If the task does not complete within the timeout window.
        """
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline:
            task = self.get(task_id)
            if task.status in TERMINAL_STATUSES:
                return task

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(poll_interval, remaining))

        raise EscalationTimeoutError(
            f"Task {task_id} did not reach a terminal state within {timeout}s",
            timeout_seconds=timeout,
        )

    # ── Asynchronous Methods ─────────────────────────────────────────────

    async def acreate(
        self,
        *,
        idempotency_key: str,
        task_type: str,
        payload: dict[str, Any],
        output_schema: dict[str, Any],
        payout: dict[str, Any] | Payout,
        risk_tier: str = "medium",
        sla_seconds: int = 600,
        callback_url: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Task:
        """Create a new task for human review (asynchronous).

        Same parameters and behavior as :meth:`create`, but uses async I/O.
        """
        payout_dict = payout.model_dump(by_alias=True) if isinstance(payout, Payout) else payout
        body: dict[str, Any] = {
            "idempotencyKey": idempotency_key,
            "taskType": task_type,
            "riskTier": risk_tier,
            "slaSeconds": sla_seconds,
            "payload": payload,
            "outputSchema": output_schema,
            "payout": payout_dict,
        }
        if callback_url is not None:
            body["callbackUrl"] = callback_url
        if metadata is not None:
            body["metadata"] = metadata

        data = await self._client._request_async(
            "POST", "/tasks", body=body, idempotency_key=idempotency_key
        )
        return Task.model_validate(data)

    async def aget(self, task_id: str) -> Task:
        """Retrieve a task by its ID (asynchronous).

        Same parameters and behavior as :meth:`get`, but uses async I/O.
        """
        data = await self._client._request_async("GET", f"/tasks/{quote(task_id, safe='')}")
        return Task.model_validate(data)

    async def acancel(self, task_id: str) -> TaskCancelResult:
        """Cancel a task (asynchronous).

        Same parameters and behavior as :meth:`cancel`, but uses async I/O.
        """
        data = await self._client._request_async(
            "POST", f"/tasks/{quote(task_id, safe='')}/cancel"
        )
        return TaskCancelResult.model_validate(data)

    async def alist(
        self,
        *,
        status: str | TaskStatus | None = None,
        task_type: str | None = None,
        limit: int = 20,
        after: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
    ) -> TaskListResponse:
        """List tasks with optional filters (asynchronous).

        Same parameters and behavior as :meth:`list`, but uses async I/O.
        """
        query: dict[str, Any] = {"limit": limit}
        if status is not None:
            query["status"] = status.value if isinstance(status, TaskStatus) else status
        if task_type is not None:
            query["task_type"] = task_type
        if after is not None:
            query["after"] = after
        if created_after is not None:
            query["created_after"] = created_after
        if created_before is not None:
            query["created_before"] = created_before

        data = await self._client._request_async("GET", "/tasks", query=query)
        return TaskListResponse.model_validate(data)

    async def await_for_completion(
        self,
        task_id: str,
        *,
        poll_interval: float = 2.0,
        timeout: float = 600.0,
    ) -> Task:
        """Poll a task until it reaches a terminal state (asynchronous).

        Same parameters and behavior as :meth:`wait_for_completion`, but uses async I/O.
        """
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline:
            task = await self.aget(task_id)
            if task.status in TERMINAL_STATUSES:
                return task

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            await asyncio.sleep(min(poll_interval, remaining))

        raise EscalationTimeoutError(
            f"Task {task_id} did not reach a terminal state within {timeout}s",
            timeout_seconds=timeout,
        )


def generate_idempotency_key(namespace: str, *parts: str) -> str:
    """Generate a deterministic idempotency key from a namespace and parts.

    Uses SHA-256 to produce a consistent key regardless of input length.
    Useful for ensuring that retried agent calls don't create duplicate tasks.

    Args:
        namespace: A namespace prefix (e.g., your service name).
        *parts: Variable number of string parts that uniquely identify the operation.

    Returns:
        A deterministic idempotency key string.

    Example::

        from humanrail import generate_idempotency_key

        key = generate_idempotency_key("order-service", "order-12345", "refund-check")
        # => "order-service:a1b2c3d4..."
    """
    input_str = ":".join(parts)
    hash_hex = hashlib.sha256(input_str.encode()).hexdigest()[:32]
    return f"{namespace}:{hash_hex}"


def _clean_query(query: dict[str, Any] | None) -> dict[str, str] | None:
    """Remove None values from query params and convert values to strings."""
    if query is None:
        return None
    return {k: str(v) for k, v in query.items() if v is not None}


def _parse_error_body(response: httpx.Response) -> dict[str, Any] | None:
    """Attempt to parse the error response body as JSON."""
    try:
        return response.json()  # type: ignore[no-any-return]
    except Exception:
        return None


def _parse_retry_after(response: httpx.Response) -> float | None:
    """Parse the Retry-After header value as seconds."""
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None
