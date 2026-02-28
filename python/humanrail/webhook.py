"""
Webhook signature verification for the HumanRail.

The HumanRail signs webhook payloads using HMAC-SHA256 with a
per-organization webhook secret. The signature header includes a timestamp
to prevent replay attacks.

Signature header format: `t=<unix-timestamp>,v1=<hex-encoded HMAC>`
Signed payload format: `<timestamp>.<raw-body>`
"""

from __future__ import annotations

import hashlib
import hmac
import time


def verify_webhook_signature(
    *,
    payload: str,
    signature: str,
    secret: str,
    tolerance: int = 300,
) -> bool:
    """Verify the authenticity and freshness of an HumanRail webhook event.

    This function:
    1. Parses the timestamp and HMAC from the signature header.
    2. Recomputes the HMAC-SHA256 using the webhook secret.
    3. Compares the signatures using a timing-safe comparison.
    4. Rejects signatures older than the tolerance window.

    Args:
        payload: The raw request body as a string. Must be the exact bytes
            received, not a re-serialized JSON object.
        signature: The value of the `x-escalation-signature` header.
            Format: ``t=<timestamp>,v1=<hex-encoded HMAC>``
        secret: The webhook signing secret for your organization.
        tolerance: Maximum age of the signature in seconds. Signatures older
            than this are rejected to prevent replay attacks. Defaults to 300 (5 minutes).

    Returns:
        True if the signature is valid and fresh, False otherwise.

    Example::

        from humanrail import verify_webhook_signature

        is_valid = verify_webhook_signature(
            payload=request.body.decode("utf-8"),
            signature=request.headers["x-escalation-signature"],
            secret=os.environ["ESCALATION_WEBHOOK_SECRET"],
            tolerance=300,
        )
    """
    if not payload or not signature or not secret:
        return False

    # Parse the signature header: t=<timestamp>,v1=<hmac>
    parts = signature.split(",")
    timestamp_part: str | None = None
    signature_part: str | None = None

    for part in parts:
        if part.startswith("t="):
            timestamp_part = part[2:]
        elif part.startswith("v1="):
            signature_part = part[3:]

    if not timestamp_part or not signature_part:
        return False

    try:
        timestamp_num = int(timestamp_part)
    except ValueError:
        return False

    # Check timestamp tolerance to prevent replay attacks
    now = int(time.time())
    age = abs(now - timestamp_num)
    if age > tolerance:
        return False

    # Compute expected HMAC: HMAC-SHA256(secret, "<timestamp>.<payload>")
    signed_payload = f"{timestamp_part}.{payload}"
    computed_hmac = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    # Timing-safe comparison to prevent timing attacks
    return hmac.compare_digest(computed_hmac, signature_part)


def construct_webhook_signature(
    payload: str,
    secret: str,
    timestamp: int | None = None,
) -> str:
    """Construct a webhook signature header value for testing purposes.

    Do NOT use this in production. It is provided for writing tests.

    Args:
        payload: The raw request body string.
        secret: The webhook signing secret.
        timestamp: Optional unix timestamp (defaults to now).

    Returns:
        The signature string in the format ``t=<timestamp>,v1=<hmac>``.
    """
    ts = timestamp if timestamp is not None else int(time.time())
    signed_payload = f"{ts}.{payload}"
    hmac_hex = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"t={ts},v1={hmac_hex}"
