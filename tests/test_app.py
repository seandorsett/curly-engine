"""Integration test executed inside the demo workflows.

It expects a Redis service container to be reachable on localhost. The two demo
workflows wire that up in different ways so we can compare them side by side.
"""
import os

from src.app import run


def test_app_round_trip():
    result = run()
    assert result["greeting"] == "hello from curly-engine"
    # When the service container is launched with an entrypoint override that
    # forces --requirepass, REDIS_PASSWORD must be set for the test to pass.
    if os.environ.get("REDIS_REQUIRE_AUTH") == "1":
        assert result["auth_required"] == "True"
