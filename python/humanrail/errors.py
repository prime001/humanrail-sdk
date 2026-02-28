"""
Error hierarchy for the Escalation Engine SDK.

All SDK-specific errors inherit from EscalationError, making it easy to catch
any Escalation-related error in a single except block.
"""

from __future__ import annotations

from typing import Any


class EscalationError(Exception):
    """Base error class for all Escalation Engine SDK errors.

    Attributes:
        message: Human-readable error description.
        status_code: HTTP status code from the API response, if applicable.
        request_id: Unique request identifier for support and debugging.
        body: Raw error response body from the API.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        request_id: str | None = None,
        body: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.request_id = request_id
        self.body = body


class AuthenticationError(EscalationError):
    """Raised when the API key is missing, invalid, or revoked (HTTP 401)."""


class AuthorizationError(EscalationError):
    """Raised when the API returns HTTP 403, indicating insufficient permissions."""


class RateLimitError(EscalationError):
    """Raised when the API returns HTTP 429 (rate limit exceeded).

    Attributes:
        retry_after: Suggested wait time in seconds before retrying.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        request_id: str | None = None,
        body: dict[str, Any] | None = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status_code, request_id=request_id, body=body
        )
        self.retry_after = retry_after


class ValidationError(EscalationError):
    """Raised when the request fails validation (HTTP 400/422).

    Check `body['error']['details']` for field-level validation errors.
    """


class TaskNotFoundError(EscalationError):
    """Raised when the requested task does not exist (HTTP 404).

    Attributes:
        task_id: The task ID that was not found.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        request_id: str | None = None,
        body: dict[str, Any] | None = None,
        task_id: str | None = None,
    ) -> None:
        super().__init__(
            message, status_code=status_code, request_id=request_id, body=body
        )
        self.task_id = task_id


class TimeoutError(EscalationError):
    """Raised when an operation times out.

    This includes HTTP request timeouts and wait_for_completion() exceeding
    its timeout window.

    Attributes:
        timeout_seconds: The timeout duration in seconds that was exceeded.
    """

    def __init__(
        self,
        message: str,
        *,
        timeout_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.timeout_seconds = timeout_seconds


class ConflictError(EscalationError):
    """Raised on HTTP 409, e.g., trying to cancel a task that is already verified."""


class ServerError(EscalationError):
    """Raised when the server returns a 5xx error after all retries are exhausted."""


def build_api_error(
    status_code: int,
    body: dict[str, Any] | None,
    request_id: str | None,
    retry_after: float | None = None,
) -> EscalationError:
    """Map an HTTP status code to the appropriate error class.

    Used internally by the client to raise typed errors.

    Args:
        status_code: The HTTP response status code.
        body: The parsed JSON error response body.
        request_id: The x-request-id header value.
        retry_after: The Retry-After header value in seconds.

    Returns:
        An instance of the appropriate EscalationError subclass.
    """
    message = "API request failed"
    if body and isinstance(body.get("error"), dict):
        message = body["error"].get("message", message)

    kwargs: dict[str, Any] = {
        "status_code": status_code,
        "request_id": request_id,
        "body": body,
    }

    if status_code == 401:
        return AuthenticationError(message, **kwargs)
    if status_code == 403:
        return AuthorizationError(message, **kwargs)
    if status_code == 404:
        return TaskNotFoundError(message, **kwargs)
    if status_code == 409:
        return ConflictError(message, **kwargs)
    if status_code in (400, 422):
        return ValidationError(message, **kwargs)
    if status_code == 429:
        return RateLimitError(message, retry_after=retry_after, **kwargs)
    if status_code >= 500:
        return ServerError(message, **kwargs)

    return EscalationError(message, **kwargs)
