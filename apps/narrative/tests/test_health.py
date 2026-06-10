from __future__ import annotations

import pytest
from httpx import AsyncClient, ASGITransport

# Patch grpc server so tests don't actually bind ports
import unittest.mock as mock


@pytest.fixture(autouse=True)
def _no_grpc(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent gRPC server from binding during unit tests."""
    fake_server = mock.MagicMock()
    fake_server.start.return_value = None
    fake_server.stop.return_value = None
    monkeypatch.setattr(
        "src.narrative.grpc_server.create_grpc_server",
        lambda port: fake_server,
    )


@pytest.mark.asyncio
async def test_http_health() -> None:
    from main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "narrative" in data["service"]


def test_grpc_health_check() -> None:
    """Unit test the gRPC servicer directly (no network)."""
    from src.narrative.grpc_server import NarrativeHealthServicer
    from grpc_health.v1 import health_pb2

    servicer = NarrativeHealthServicer()

    request = health_pb2.HealthCheckRequest(service="narrative")
    response = servicer.Check(request, context=mock.MagicMock())

    assert response.status == health_pb2.HealthCheckResponse.SERVING
