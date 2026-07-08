from __future__ import annotations

import asyncio
from concurrent import futures

import grpc
from grpc_health.v1 import health_pb2, health_pb2_grpc
from grpc_health.v1.health import HealthServicer

import structlog

logger = structlog.get_logger()


class NarrativeHealthServicer(HealthServicer):
    """gRPC Health Check servicer."""

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


# ---------------------------------------------------------------------------
# NarrativeServicer
#
# The gRPC stubs for narrative.proto are generated at build time via:
#   python -m grpc_tools.protoc -I proto --python_out=src/narrative/proto_gen
#       --grpc_python_out=src/narrative/proto_gen proto/narrative.proto
#
# In Slice 2 the servicer is wired in below.  When the generated stubs are
# present the try/except block loads them; otherwise the servicer is registered
# only if available (graceful degradation for environments without the stubs).
# ---------------------------------------------------------------------------

try:
    from .proto_gen import narrative_pb2, narrative_pb2_grpc  # type: ignore[import]

    class NarrativeServicer(narrative_pb2_grpc.NarrativeServiceServicer):
        """gRPC NarrativeService servicer.

        Runs the generate_narrative pipeline in a thread (gRPC uses synchronous
        servicers by default; asyncio pipeline is bridged via asyncio.run).
        """

        def __init__(
            self,
            pool: object,  # asyncpg.Pool — typed loosely to avoid import cycle
            model: object,  # ModelProvider
        ) -> None:
            self._pool = pool
            self._model = model

        def GenerateNarrative(  # noqa: N802
            self,
            request: narrative_pb2.GenerateNarrativeRequest,
            context: grpc.ServicerContext,
        ) -> narrative_pb2.GenerateNarrativeResponse:
            from .narrative_service import generate_narrative

            loop = asyncio.new_event_loop()
            try:
                output = loop.run_until_complete(
                    generate_narrative(
                        patient_id=request.patient_id,
                        language=request.language or "en",
                        scope=request.scope or "full",
                        pool=self._pool,  # type: ignore[arg-type]
                        model=self._model,  # type: ignore[arg-type]
                    )
                )
            finally:
                loop.close()

            provenance_entries = []
            for entry in output.provenance:
                sources = [
                    narrative_pb2.SourceRef(
                        type=s.get("type", ""),
                        id=s.get("id", ""),
                        field=s.get("field", ""),
                    )
                    for s in entry.sources
                ]
                provenance_entries.append(
                    narrative_pb2.ProvenanceEntry(
                        sentence_index=entry.sentence_index,
                        char_start=entry.char_start,
                        char_end=entry.char_end,
                        sources=sources,
                    )
                )

            return narrative_pb2.GenerateNarrativeResponse(
                narrative_id=output.narrative_id,
                patient_id=output.patient_id,
                text=output.text or "",
                fallback_message=output.fallback_message or "",
                provenance=provenance_entries,
                model_version=output.model_version,
                prompt_template_version=output.prompt_template_version,
                generated_at=output.generated_at,
                language=output.language,
                scope=output.scope,
                blocklist_triggered=output.blocklist_triggered,
                blocklist_retries=output.blocklist_retries,
            )

    _NARRATIVE_STUBS_AVAILABLE = True
except ImportError:
    _NARRATIVE_STUBS_AVAILABLE = False
    # Not an error: core talks to this service over REST (see
    # apps/core/src/narrative-proxy/narrative-proxy.service.ts). gRPC is
    # reserved for a future transport swap and nothing calls it today, so
    # missing stubs are expected in every environment until that swap
    # happens — only the health check + narrative REST API need to be up.
    logger.info(
        "narrative_grpc_stubs_not_found",
        detail="gRPC transport not built (REST is the active transport; run grpc_tools.protoc only if you need to test gRPC)",
    )


def create_grpc_server(
    port: int,
    pool: object | None = None,
    model: object | None = None,
) -> grpc.Server:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))

    # Health
    servicer = NarrativeHealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(servicer, server)

    # Narrative (only if stubs were generated and pool/model are provided)
    if _NARRATIVE_STUBS_AVAILABLE and pool is not None and model is not None:
        narrative_servicer = NarrativeServicer(pool=pool, model=model)  # type: ignore[possibly-undefined]
        narrative_pb2_grpc.add_NarrativeServiceServicer_to_server(narrative_servicer, server)  # type: ignore[possibly-undefined]

    server.add_insecure_port(f"[::]:{port}")
    return server
