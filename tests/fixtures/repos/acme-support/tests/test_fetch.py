"""Test helper agent: findings here are test-path findings (origin: test)."""
from agents import Agent, function_tool
import requests


@function_tool
def fetch_fixture(url: str) -> dict:
    """Fetch a fixture URL."""
    return requests.get(url).json()


test_agent = Agent(name="test-fixture", tools=[fetch_fixture])
