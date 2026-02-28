"""
LangChain Tool Integration Example

Demonstrates how to wrap the Escalation Engine as a LangChain tool,
allowing an AI agent to escalate tasks to human workers when it
encounters low-confidence decisions or tasks requiring human judgment.

Prerequisites:
    pip install langchain-core escalation-engine

Run with: python examples/langchain_tool.py
"""

from __future__ import annotations

import json
import os
import time
import random

from escalation_engine import EscalationClient

# NOTE: In a real project, uncomment these imports:
# from langchain_core.tools import tool
# from pydantic import BaseModel, Field

# ── Setup ────────────────────────────────────────────────────────────────────

client = EscalationClient(api_key=os.environ.get("ESCALATION_API_KEY", "ek_demo"))


# ── LangChain Tool Definition ───────────────────────────────────────────────
#
# To use this with LangChain, define the tool like this:
#
# class EscalateToHumanInput(BaseModel):
#     """Input schema for the escalate_to_human tool."""
#     task_type: str = Field(description="The type of task to escalate")
#     context: str = Field(description="Relevant context for the human worker")
#     question: str = Field(description="The specific question or decision needed")
#
#
# @tool("escalate_to_human", args_schema=EscalateToHumanInput)
# def escalate_to_human(task_type: str, context: str, question: str) -> str:
#     """Escalate a task to a human worker when AI confidence is low
#     or the task requires human judgment."""
#     task = client.tasks.create(
#         idempotency_key=f"langchain-{int(time.time())}-{random.randint(0, 99999)}",
#         task_type=task_type,
#         risk_tier="medium",
#         sla_seconds=300,
#         payload={"context": context, "question": question},
#         output_schema={
#             "type": "object",
#             "required": ["answer", "confidence"],
#             "properties": {
#                 "answer": {"type": "string"},
#                 "confidence": {"type": "number", "minimum": 0, "maximum": 1},
#             },
#         },
#         payout={"currency": "SATS", "maxAmount": 1000},
#     )
#
#     result = client.tasks.wait_for_completion(task.id, timeout=600)
#     return json.dumps(result.output)


# ── Standalone example (without LangChain dependency) ────────────────────────


def escalate_to_human(task_type: str, context: str, question: str) -> str:
    """Escalate a task to a human worker.

    This function can be used standalone or wrapped in a LangChain tool.
    """
    print(f"Escalating to human: {task_type}")
    print(f"Context: {context}")
    print(f"Question: {question}")

    task = client.tasks.create(
        idempotency_key=f"langchain-{int(time.time())}-{random.randint(0, 99999)}",
        task_type=task_type,
        risk_tier="medium",
        sla_seconds=300,
        payload={"context": context, "question": question},
        output_schema={
            "type": "object",
            "required": ["answer", "confidence"],
            "properties": {
                "answer": {"type": "string"},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            },
        },
        payout={"currency": "SATS", "maxAmount": 1000},
    )

    print(f"Task created: {task.id}, waiting for completion...")

    result = client.tasks.wait_for_completion(task.id, poll_interval=2.0, timeout=600.0)
    print(f"Task completed with status: {result.status}")

    return json.dumps(result.output)


def main() -> None:
    # Simulate an AI agent deciding to escalate
    output = escalate_to_human(
        task_type="customer_sentiment",
        context=(
            "Customer has been a member for 5 years, spent $12,000 total. "
            "They are asking about cancellation after a billing dispute of $45.99. "
            "Previous sentiment scores: positive (0.8), neutral (0.6)."
        ),
        question=(
            "Should we offer a retention discount? If so, what percentage? "
            "Consider the customer's lifetime value and current sentiment."
        ),
    )

    print(f"\nHuman worker response: {output}")


if __name__ == "__main__":
    main()
