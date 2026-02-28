/**
 * Express Webhook Handler Example
 *
 * Demonstrates how to receive and verify webhook events from the
 * Escalation Engine using Express.js.
 *
 * Prerequisites:
 *   npm install express @escalation-engine/sdk
 *   npm install -D @types/express
 *
 * Run with: npx tsx examples/webhook-handler-express.ts
 */

import { verifyWebhookSignature } from "../src/index.js";
import type { WebhookEvent, Task } from "../src/index.js";

// NOTE: In a real project, import Express normally:
// import express from 'express';
// const app = express();

// ── Webhook handler implementation ──────────────────────────────────────────

/**
 * Core webhook handler logic, framework-agnostic.
 * This can be adapted to Express, Fastify, Next.js, or any other framework.
 */
function handleWebhookRequest(
  rawBody: string,
  signatureHeader: string | undefined,
): { status: number; body: string } {
  const webhookSecret = process.env.ESCALATION_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("ESCALATION_WEBHOOK_SECRET is not set");
    return { status: 500, body: "Server configuration error" };
  }

  if (!signatureHeader) {
    return { status: 401, body: "Missing signature header" };
  }

  // Verify the webhook signature to ensure it came from Escalation Engine
  const isValid = verifyWebhookSignature({
    payload: rawBody,
    signature: signatureHeader,
    secret: webhookSecret,
    tolerance: 300, // Reject events older than 5 minutes
  });

  if (!isValid) {
    console.warn("Invalid webhook signature received");
    return { status: 401, body: "Invalid signature" };
  }

  // Parse the event
  const event: WebhookEvent = JSON.parse(rawBody);

  console.log(`Received event: ${event.type} (${event.id})`);

  // Route to the appropriate handler based on event type
  switch (event.type) {
    case "task.verified":
      handleVerifiedTask(event.data);
      break;
    case "task.failed":
      handleFailedTask(event.data);
      break;
    case "task.expired":
      handleExpiredTask(event.data);
      break;
    case "task.assigned":
      handleAssignedTask(event.data);
      break;
    case "task.cancelled":
      console.log(`Task ${event.data.id} was cancelled`);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  // Always respond 200 quickly to acknowledge receipt.
  // Process the event asynchronously if it requires heavy work.
  return { status: 200, body: "ok" };
}

// ── Event Handlers ──────────────────────────────────────────────────────────

function handleVerifiedTask(task: Task): void {
  console.log(`Task ${task.id} verified!`);
  console.log(`Output:`, task.output);

  // Example: update your database with the human's decision
  // await db.orders.update({
  //   where: { id: task.payload.orderId },
  //   data: { refundEligible: task.output.eligible },
  // });

  if (task.payoutResult) {
    console.log(
      `Worker paid: ${task.payoutResult.amount} ${task.payoutResult.currency}`,
    );
  }
}

function handleFailedTask(task: Task): void {
  console.error(`Task ${task.id} failed: ${task.failureReason}`);

  // Example: retry the task or escalate to your team
  // await alerting.notify({
  //   channel: 'escalation-failures',
  //   message: `Task ${task.id} failed: ${task.failureReason}`,
  // });
}

function handleExpiredTask(task: Task): void {
  console.warn(`Task ${task.id} expired (SLA: ${task.slaSeconds}s)`);

  // Example: fall back to AI decision or alert your team
  // await fallbackToAI(task);
}

function handleAssignedTask(task: Task): void {
  console.log(`Task ${task.id} assigned to a worker`);
}

// ── Express App Setup ───────────────────────────────────────────────────────

/**
 * Example Express setup:
 *
 * ```typescript
 * import express from 'express';
 *
 * const app = express();
 *
 * // IMPORTANT: Use express.raw() for the webhook route to get the raw body
 * // for signature verification. Do NOT use express.json() here.
 * app.post(
 *   '/webhooks/escalation',
 *   express.raw({ type: 'application/json' }),
 *   (req, res) => {
 *     const rawBody = req.body.toString('utf-8');
 *     const signature = req.headers['x-escalation-signature'] as string | undefined;
 *
 *     const result = handleWebhookRequest(rawBody, signature);
 *     res.status(result.status).send(result.body);
 *   },
 * );
 *
 * const PORT = process.env.PORT || 3000;
 * app.listen(PORT, () => {
 *   console.log(`Webhook server listening on port ${PORT}`);
 * });
 * ```
 */

// ── Demo ────────────────────────────────────────────────────────────────────

// Demonstrate the handler with a simulated event
import { constructWebhookSignature } from "../src/index.js";

function demo() {
  const secret = "whsec_test_secret_key_for_demo";
  process.env.ESCALATION_WEBHOOK_SECRET = secret;

  const event: WebhookEvent = {
    id: "evt_abc123",
    type: "task.verified",
    createdAt: new Date().toISOString(),
    data: {
      id: "task_xyz789",
      idempotencyKey: "order-12345-refund-check",
      status: "verified",
      taskType: "refund_eligibility",
      riskTier: "medium",
      slaSeconds: 300,
      payload: { orderId: "order-12345" },
      outputSchema: {
        type: "object",
        required: ["eligible"],
        properties: { eligible: { type: "boolean" } },
      },
      payout: { currency: "USD", maxAmount: 0.5 },
      output: { eligible: true, reason_code: "approved", notes: "Damage confirmed." },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  };

  const rawBody = JSON.stringify(event);
  const signature = constructWebhookSignature(rawBody, secret);

  console.log("--- Simulating webhook delivery ---");
  const result = handleWebhookRequest(rawBody, signature);
  console.log(`Response: ${result.status} ${result.body}`);
}

demo();
