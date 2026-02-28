/**
 * Basic Escalation Example
 *
 * Demonstrates creating a task, waiting for the human worker to complete it,
 * and handling the result. This is the simplest possible integration.
 *
 * Run with: npx tsx examples/basic-escalation.ts
 */

import { EscalationClient, generateIdempotencyKey } from "../src/index.js";

async function main() {
  // Initialize the client with your API key
  const client = new EscalationClient({
    apiKey: process.env.ESCALATION_API_KEY ?? "",
    // baseUrl defaults to https://api.escalation.engine/v1
    // timeout defaults to 30s
    // maxRetries defaults to 3 with exponential backoff
  });

  // Create a task for human review
  const task = await client.tasks.create({
    // Idempotency key ensures retries don't create duplicate tasks
    idempotencyKey: generateIdempotencyKey("example", "order-12345", "refund"),
    taskType: "refund_eligibility",
    riskTier: "medium",
    slaSeconds: 300, // 5-minute SLA

    // Context provided to the human worker
    payload: {
      orderId: "order-12345",
      orderTotal: 89.99,
      reason: "Item arrived damaged",
      policyText:
        "Refunds are allowed within 30 days for damaged items. " +
        "Customer must provide photo evidence.",
    },

    // JSON Schema the worker's response must conform to
    outputSchema: {
      type: "object",
      required: ["eligible", "reason_code"],
      properties: {
        eligible: { type: "boolean" },
        reason_code: {
          type: "string",
          enum: [
            "approved",
            "denied_policy",
            "denied_timeframe",
            "needs_review",
          ],
        },
        notes: { type: "string" },
      },
    },

    // Worker payout: $0.50 for this task
    payout: { currency: "USD", maxAmount: 0.5 },

    // Optional: receive webhook events at this URL
    callbackUrl: "https://myapp.com/webhooks/escalation",
  });

  console.log(`Task created: ${task.id}`);
  console.log(`Status: ${task.status}`); // "posted"
  console.log(`Expires at: ${task.expiresAt}`);

  // Wait for the task to be completed and verified
  // This polls every 2 seconds for up to 10 minutes
  console.log("\nWaiting for human worker to complete the task...");

  const result = await client.tasks.waitForCompletion(task.id, {
    pollIntervalMs: 2000,
    timeoutMs: 600_000, // 10 minutes
  });

  console.log(`\nTask completed!`);
  console.log(`Final status: ${result.status}`); // "verified"
  console.log(`Output:`, result.output);
  // => { eligible: true, reason_code: 'approved', notes: 'Photo evidence confirms damage.' }

  if (result.payoutResult) {
    console.log(
      `Worker paid: ${result.payoutResult.amount} ${result.payoutResult.currency} via ${result.payoutResult.rail}`,
    );
  }

  // List recent verified tasks
  const recentTasks = await client.tasks.list({
    status: "verified",
    limit: 10,
  });
  console.log(`\nRecent verified tasks: ${recentTasks.data.length}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
