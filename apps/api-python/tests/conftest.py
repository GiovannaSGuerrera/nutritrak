"""Reject accidental integration-test connections to real databases."""

import os
from urllib.parse import urlsplit
import pytest


def pytest_sessionstart(session):
    url = os.getenv("DATABASE_URL")
    if url and (
        os.getenv("TEST_DATABASE_CONFIRM") != "disposable"
        or not urlsplit(url).path.endswith("_test")
    ):
        raise pytest.UsageError(
            "Set TEST_DATABASE_CONFIRM=disposable and use a database name ending in _test"
        )
