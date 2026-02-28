"""
Configurable retry logic with backoff strategies for the Escalation Engine SDK.

Supports exponential, linear, and no-backoff strategies with jitter to prevent
thundering herd problems.
"""

from __future__ import annotations

import asyncio
import random
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import TypeVar

T = TypeVar("T")


class BackoffStrategy(str, Enum):
    """Backoff strategy for retry delays."""

    EXPONENTIAL = "exponential"
    LINEAR = "linear"
    NONE = "none"


RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})


def is_retryable_status_code(status_code: int) -> bool:
    """Determine whether a given HTTP status code is retryable.

    Retryable statuses:
    - 429: Rate limit exceeded
    - 500, 502, 503, 504: Server errors (transient failures)
    """
    return status_code in RETRYABLE_STATUS_CODES


@dataclass(frozen=True)
class RetryConfig:
    """Configuration for retry logic.

    Attributes:
        max_retries: Maximum number of retry attempts.
        backoff: Backoff strategy.
        base_delay: Base delay in seconds for backoff calculation.
        max_delay: Maximum delay cap in seconds.
    """

    max_retries: int = 3
    backoff: BackoffStrategy = BackoffStrategy.EXPONENTIAL
    base_delay: float = 1.0
    max_delay: float = 30.0


@dataclass
class AttemptResult(Exception):
    """Result of a single request attempt, used by the retry executor.

    Attributes:
        response: The successful response data, if the attempt succeeded.
        status_code: The HTTP status code, used to decide whether to retry.
        error: The exception, if the attempt failed.
        retry_after: Retry-After header value in seconds, if present.
        should_retry: Whether this attempt should be retried.
    """

    response: object | None = None
    status_code: int | None = None
    error: Exception | None = None
    retry_after: float | None = None
    should_retry: bool = False


def calculate_delay(
    attempt: int,
    config: RetryConfig,
    retry_after: float | None = None,
) -> float:
    """Calculate the delay before the next retry attempt, with jitter.

    Args:
        attempt: Zero-based retry attempt number (0 = first retry).
        config: Retry configuration.
        retry_after: Optional Retry-After header value in seconds.

    Returns:
        Delay in seconds before the next attempt.
    """
    if retry_after is not None and retry_after > 0:
        return min(retry_after, config.max_delay)

    if config.backoff == BackoffStrategy.NONE:
        return 0.0

    if config.backoff == BackoffStrategy.LINEAR:
        delay = config.base_delay * (attempt + 1)
    else:
        # Exponential: 1s, 2s, 4s, 8s, ...
        delay = config.base_delay * (2**attempt)

    # Add jitter: random value between 0 and 50% of the delay
    jitter = random.random() * delay * 0.5  # noqa: S311
    delay = min(delay + jitter, config.max_delay)

    return delay


def execute_with_retry_sync(
    fn: Callable[[int], AttemptResult],
    config: RetryConfig,
) -> object:
    """Execute a synchronous operation with configurable retry logic.

    Args:
        fn: Function to execute. Receives the attempt number (0-based).
        config: Retry configuration.

    Returns:
        The result of the first successful attempt.

    Raises:
        Exception: The error from the last failed attempt if all retries are exhausted.
    """
    last_error: Exception | None = None

    for attempt in range(config.max_retries + 1):
        result = fn(attempt)

        if not result.should_retry or attempt == config.max_retries:
            if result.response is not None:
                return result.response
            raise result.error or last_error or Exception("Request failed after all retries")

        last_error = result.error

        delay = calculate_delay(attempt, config, result.retry_after)
        if delay > 0:
            time.sleep(delay)

    raise last_error or Exception("Request failed after all retries")


async def execute_with_retry_async(
    fn: Callable[[int], Awaitable[AttemptResult]],
    config: RetryConfig,
) -> object:
    """Execute an async operation with configurable retry logic.

    Args:
        fn: Async function to execute. Receives the attempt number (0-based).
        config: Retry configuration.

    Returns:
        The result of the first successful attempt.

    Raises:
        Exception: The error from the last failed attempt if all retries are exhausted.
    """
    last_error: Exception | None = None

    for attempt in range(config.max_retries + 1):
        result = await fn(attempt)

        if not result.should_retry or attempt == config.max_retries:
            if result.response is not None:
                return result.response
            raise result.error or last_error or Exception("Request failed after all retries")

        last_error = result.error

        delay = calculate_delay(attempt, config, result.retry_after)
        if delay > 0:
            await asyncio.sleep(delay)

    raise last_error or Exception("Request failed after all retries")
