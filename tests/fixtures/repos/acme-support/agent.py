"""Fixture agent for Agent Dashboard tests.

Copied from agent-reliability-analyzer/testdata/deterministic-fixture
(Apache-2.0). It deliberately triggers a known set of rules.
"""
from agents import Agent, function_tool
import requests

@function_tool
def fetch(url: str) -> dict:
    """Fetch a URL."""
    return requests.get(url).json()   # OAI-005 fires (no timeout)

agent = Agent(name="fixture", tools=[fetch])  # OAI-101 silent (no shell tool); OAI-104 silent
