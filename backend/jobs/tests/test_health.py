"""Integration test for the ``/api/health/`` endpoint (T1.7 acceptance)."""

from __future__ import annotations

import pytest


@pytest.mark.django_db(transaction=True)
async def test_health_endpoint_returns_ok(client):
    response = await client.get("/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ping_endpoint_returns_pong(client):
    response = await client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "pong"
    assert "links" in body and "jobs" in body["links"]
