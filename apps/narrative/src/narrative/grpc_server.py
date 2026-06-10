from __future__ import annotations

import asyncio
from concurrent import futures

import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from grpc_health.v1.health import HealthServicer

import structlog

logger = structlog.get_logger()


class NarrativeHealthServicer(HealthServicer):
    """gRPC Health Check servicer — always returns SERVING for Slice 0."""

    def Check(  # noqa: N802
        self,
        request: health_pb2.HealthCheckRequest,
        context: grpc.ServicerContext,
    ) -> health_pb2.HealthCheckResponse:
        logger.info(
            "grpc_health_check",
            service=request.service or "narrative",
        )
        return health_pb2.HealthCheckResponse(
            status=health_pb2.HealthCheckResponse.SERVING
        )

    def Watch(  # noqa: N802
        self,
        request: health_pb2.HealthCheckRequest,
        context: grpc.ServicerContext,
    ) -> health_pb2.HealthCheckResponse:
        yield health_pb2.HealthCheckResponse(
            status=health_pb2.HealthCheckResponse.SERVING
        )


def create_grpc_server(port: int) -> grpc.Server:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    servicer = NarrativeHealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(servicer, server)
    server.add_insecure_port(f"[::]:{port}")
    return server
