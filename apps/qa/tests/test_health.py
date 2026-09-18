from __future__ import annotations

import pytest
import unittest.mock as mock
from httpx import AsyncClient, ASGITransport


@pytest.fixture(autouse=True)
def _no_grpc(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent gRPC server from binding during unit tests."""
    fake_server = mock.MagicMock()
    fake_server.start.return_value = None
    fake_server.stop.return_value = None
    monkeypatch.setattr(
        "src.qa.grpc_server.create_grpc_server",
        lambda port: fake_server,
    )


@pytest.mark.asyncio
async def test_http_health_reports_degraded_without_its_database() -> None:
    """H02: this test used to assert `status == "ok"` with no database anywhere in
    sight, which pinned the very bug it should have caught. The contract is that the
    pool decides the answer, so both states are asserted here."""
    import main

    async with AsyncClient(
        transport=ASGITransport(app=main.app), base_url="http://test"
    ) as client:
        main._db_pool = None
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "degraded"
    assert data["database"] == "pool_not_initialised"
    assert "qa" in data["service"]


@pytest.mark.asyncio
async def test_http_health_is_ok_when_the_pool_answers() -> None:
    import main

    class _Conn:
        async def fetchval(self, _sql: str) -> int:
            return 1

    class _Acquire:
        async def __aenter__(self) -> _Conn:
            return _Conn()

        async def __aexit__(self, *_exc: object) -> None:
            return None

    class _Pool:
        def acquire(self) -> _Acquire:
            return _Acquire()

    async with AsyncClient(
        transport=ASGITransport(app=main.app), base_url="http://test"
    ) as client:
        main._db_pool = _Pool()  # type: ignore[assignment]
        try:
            resp = await client.get("/health")
        finally:
            main._db_pool = None
    assert resp.json()["status"] == "ok"


def test_grpc_health_check() -> None:
    """Unit test the gRPC servicer directly (no network)."""
    from src.qa.grpc_server import QaHealthServicer
    from grpc_health.v1 import health_pb2

    servicer = QaHealthServicer()
    request = health_pb2.HealthCheckRequest(service="qa")
    response = servicer.Check(request, context=mock.MagicMock())

    assert response.status == health_pb2.HealthCheckResponse.SERVING
