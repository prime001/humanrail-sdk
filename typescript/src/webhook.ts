import { createHmac, timingSafeEqual } from "node:crypto";
import type { VerifyWebhookSignatureParams } from "./types.js";

/**
 * Verifies the authenticity and freshness of an Escalation Engine webhook event.
 *
 * The signature header has the format: `t=<unix-timestamp>,v1=<hex-hmac>`
 *
 * The signed payload is constructed as: `<timestamp>.<raw-body>`
 *
 * This function:
 * 1. Parses the timestamp and HMAC from the signature header.
 * 2. Recomputes the HMAC-SHA256 using the webhook secret.
 * 3. Compares the signatures using a timing-safe comparison.
 * 4. Rejects signatures older than the tolerance window (default: 300s).
 *
 * @param params - Verification parameters.
 * @returns `true` if the signature is valid and fresh, `false` otherwise.
 *
 * @example
 * ```typescript
 * import { verifyWebhookSignature } from '@escalation-engine/sdk';
 *
 * const isValid = verifyWebhookSignature({
 *   payload: req.body,       // raw request body string
 *   signature: req.headers['x-escalation-signature'],
 *   secret: process.env.ESCALATION_WEBHOOK_SECRET,
 *   tolerance: 300,
 * });
 * ```
 */
export function verifyWebhookSignature(
  params: VerifyWebhookSignatureParams,
): boolean {
  const { payload, signature, secret, tolerance = 300 } = params;

  if (!payload || !signature || !secret) {
    return false;
  }

  // Parse the signature header: t=<timestamp>,v1=<hmac>
  const parts = signature.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v1="));

  if (!timestampPart || !signaturePart) {
    return false;
  }

  const timestamp = timestampPart.slice(2); // Remove "t="
  const expectedSignature = signaturePart.slice(3); // Remove "v1="

  if (!timestamp || !expectedSignature) {
    return false;
  }

  const timestampNum = Number.parseInt(timestamp, 10);
  if (Number.isNaN(timestampNum)) {
    return false;
  }

  // Check timestamp tolerance to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - timestampNum);
  if (age > tolerance) {
    return false;
  }

  // Compute expected HMAC: HMAC-SHA256(secret, "<timestamp>.<payload>")
  const signedPayload = `${timestamp}.${payload}`;
  const computedHmac = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(computedHmac, "hex");
    const b = Buffer.from(expectedSignature, "hex");

    if (a.length !== b.length) {
      return false;
    }

    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Constructs a webhook signature header value for testing purposes.
 * Do NOT use this in production — it is provided for writing tests.
 *
 * @param payload - The raw request body string.
 * @param secret - The webhook signing secret.
 * @param timestamp - Optional unix timestamp (defaults to now).
 * @returns The signature string in the format `t=<timestamp>,v1=<hmac>`.
 */
export function constructWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number,
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${payload}`;
  const hmac = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return `t=${ts},v1=${hmac}`;
}
