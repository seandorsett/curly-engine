"""Tiny sample service used during the office-hours demo.

The app does just enough to exercise a Redis service container and to give the
deployment workflow something to "ship". Keep it boring on purpose - the
spotlight should stay on the workflow files, not on application code.
"""
import os
import time

import redis


def connect(retries: int = 10, delay: float = 0.5) -> redis.Redis:
    client = redis.Redis(
        host=os.environ.get("REDIS_HOST", "localhost"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        password=os.environ.get("REDIS_PASSWORD") or None,
        decode_responses=True,
    )
    last_err: Exception | None = None
    for _ in range(retries):
        try:
            client.ping()
            return client
        except redis.RedisError as err:
            last_err = err
            time.sleep(delay)
    raise RuntimeError(f"redis never became ready: {last_err!r}")


def run() -> dict[str, str]:
    client = connect()
    client.set("demo:greeting", "hello from curly-engine")
    return {"greeting": client.get("demo:greeting"), "auth_required": str(bool(os.environ.get("REDIS_PASSWORD")))}


if __name__ == "__main__":
    print(run())
