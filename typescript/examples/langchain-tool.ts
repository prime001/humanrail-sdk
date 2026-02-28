/**
 * LangChain Tool Integration Example
 *
 * Demonstrates how to wrap the Escalation Engine as a LangChain tool,
 * allowing an AI agent to escalate tasks to human workers when it
 * encounters low-confidence decisions or tasks requiring human judgment.
 *
 * Prerequisites:
 *   npm install @langchain/core zod @escalation-engine/sdk
 *
 * Run with: npx tsx examples/langchain-tool.ts
 */

import { EscalationClient } from "../src/index.js";

// NOTE: In a real project, import these from their respective packages:
// import { tool } from '@langchain/core/tools';
// import { z } from 'zod';

// ── Setup ───────────────────────────────────────────────────────────────────

const client = new EscalationClient({
  apiKey: process.env.ESCALATION_API_KEY ?? "",
});

// ── Define the Escalation Tool ──────────────────────────────────────────────

/**
 * This is the tool definition that integrates with LangChain's tool() API.
 *
 * Usage with LangChain:
 *
 * ```typescript
 * import { tool } from '@langchain/core/tools';
 * import { z } from 'zod';
 *
 * const escalateToHuman = tool(
 *   async ({ taskType, context, question }) => {
 *     const task = await client.tasks.create({
 *       idempotencyKey: `langchain-${Date.now()}`,
 *       taskType,
 *       riskTier: 'medium',
 *       slaSeconds: 300,
 *       payload: { context, question },
 *       outputSchema: {
 *         type: 'object',
 *         required: ['answer', 'confidence'],
 *         properties: {
 *           answer: { type: 'string' },
 *           confidence: { type: 'number', minimum: 0, maximum: 1 },
 *         },
 *       },
 *       payout: { currency: 'SATS', maxAmount: 1000 },
 *     });
 *
 *     const result = await client.tasks.waitForCompletion(task.id);
 *     return JSON.stringify(result.output);
 *   },
 *   {
 *     name: 'escalate_to_human',
 *     description:
 *       'Escalate a task to a human worker when AI confidence is low ' +
 *       'or the task requires human judgment.',
 *     schema: z.object({
 *       taskType: z.string().describe('The type of task to escalate'),
 *       context: z.string().describe('Relevant context for the human worker'),
 *       question: z.string().describe('The specific question or decision needed'),
 *     }),
 *   },
 * );
 * ```
 */

// ── Standalone example (without LangChain dependency) ───────────────────────

async function escalateToHuman(params: {
  taskType: string;
  context: string;
  question: string;
}): Promise<string> {
  const { taskType, context, question } = params;

  console.log(`Escalating to human: ${taskType}`);
  console.log(`Context: ${context}`);
  console.log(`Question: ${question}`);

  const task = await client.tasks.create({
    idempotencyKey: `langchain-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    taskType,
    riskTier: "medium",
    slaSeconds: 300,
    payload: { context, question },
    outputSchema: {
      type: "object",
      required: ["answer", "confidence"],
      properties: {
        answer: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    payout: { currency: "SATS", maxAmount: 1000 },
  });

  console.log(`Task created: ${task.id}, waiting for completion...`);

  const result = await client.tasks.waitForCompletion(task.id, {
    pollIntervalMs: 2000,
    timeoutMs: 600_000,
  });

  console.log(`Task completed with status: ${result.status}`);
  return JSON.stringify(result.output);
}

// ── Demo ────────────────────────────────────────────────────────────────────

async function main() {
  // Simulate an AI agent deciding to escalate
  const output = await escalateToHuman({
    taskType: "customer_sentiment",
    context:
      "Customer has been a member for 5 years, spent $12,000 total. " +
      "They are asking about cancellation after a billing dispute of $45.99. " +
      "Previous sentiment scores: positive (0.8), neutral (0.6).",
    question:
      "Should we offer a retention discount? If so, what percentage? " +
      "Consider the customer's lifetime value and current sentiment.",
  });

  console.log("\nHuman worker response:", output);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
