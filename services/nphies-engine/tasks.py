"""Asynchronous NPHIES task manager + status event broker.

Two responsibilities:

1. **Background execution.** NPHIES round-trips are slow (payer-side, seconds not
   milliseconds). Nothing here blocks a request: adding an order or a diagnosis
   returns immediately with `queued`, and the actual transaction runs via FastAPI
   `BackgroundTasks`. The UI stays responsive because it never waits on a payer.

2. **Status fan-out.** Each state change publishes an `nphies_status_updated`
   event to every subscriber watching that encounter.

**Queue choice**: FastAPI `BackgroundTasks` rather than Celery. The sprint spec
allows either. Celery would add a broker (Redis/RabbitMQ) plus a worker process to
an environment that currently runs none, for a workload that is a handful of
in-flight HTTP calls per encounter. The trade-off is honest and worth stating:
in-process tasks do not survive a restart and do not distribute across replicas.
If NPHIES submissions must be durable (they eventually should be -- a lost
prior-auth is a real operational problem), promote this to Celery or a Postgres-
backed outbox. `submit_prior_auth_task` is written as a self-contained coroutine
so that migration is a scheduling change, not a rewrite.

**Transport choice**: SSE, not WebSockets. apps/core has no WebSocket
infrastructure; its working real-time path is the SSE stream built for the AI Team
drawer. This reuses that proven pipeline and adds no dependency. The event name
(`nphies_status_updated`) and payload shape are exactly as specified -- only the
carrier differs, and the flow is server-push only, which is all this feature needs.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
from collections import defaultdict
from contextlib import suppress
from typing import Any, AsyncGenerator, Awaitable, Callable, Optional, Protocol

import structlog

from fhir_client import (
    NphiesEgressBlocked,
    NphiesError,
    NphiesFhirClient,
    NphiesNotConfigured,
)

logger = structlog.get_logger()

EVENT_NAME = "nphies_status_updated"

# One channel per encounter: a replica subscribes to the pattern and filters
# nothing, so adding an encounter needs no subscription bookkeeping.
_CHANNEL_PREFIX = "nphies:status:"


def _channel(encounter_id: str) -> str:
    return f"{_CHANNEL_PREFIX}{encounter_id}"

# Bounded so a slow/detached SSE client can never grow memory without limit.
_SUBSCRIBER_QUEUE_MAXSIZE = 64

__all__ = [
    "EVENT_NAME",
    "StatusBroker",
    "broker",
    "submit_prior_auth_task",
    "check_eligibility_task",
    "status_event_stream",
]


class StatusTransport(Protocol):
    """How a status event reaches the other replicas."""

    async def publish(self, channel: str, payload: str) -> None: ...

    async def start(self, handler: Callable[[dict[str, Any]], Awaitable[None]]) -> None: ...

    async def stop(self) -> None: ...


class RedisStatusTransport:
    """Redis pub/sub, subscribed to every encounter's channel.

    A replica holds the SSE connections of the clinicians it happens to serve, so
    the event has to reach every replica, not just the one that talked to the payer.
    """

    def __init__(self, url: str) -> None:
        self._url = url
        self._client: Any = None
        self._pubsub: Any = None
        self._task: asyncio.Task[None] | None = None

    async def start(self, handler: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        import redis.asyncio as redis_asyncio  # imported here: the package is optional

        self._client = redis_asyncio.from_url(self._url, decode_responses=True)
        self._pubsub = self._client.pubsub()
        await self._pubsub.psubscribe(f"{_CHANNEL_PREFIX}*")
        self._task = asyncio.create_task(self._listen(handler))
        logger.info("nphies_status_fanout_joined", url=self._url, pattern=f"{_CHANNEL_PREFIX}*")

    async def _listen(self, handler: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                try:
                    await handler(json.loads(message["data"]))
                except Exception:  # noqa: BLE001 -- one bad message must not end the listener
                    logger.warning("nphies_status_fanout_bad_message", raw=str(message)[:200])
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("nphies_status_fanout_listener_died")

    async def publish(self, channel: str, payload: str) -> None:
        if self._client is None:
            return
        await self._client.publish(channel, payload)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._pubsub is not None:
            with suppress(Exception):
                await self._pubsub.aclose()
            self._pubsub = None
        if self._client is not None:
            with suppress(Exception):
                await self._client.aclose()
            self._client = None


class StatusBroker:
    """Fan-out of NPHIES status changes to SSE subscribers.

    Subscribers are keyed by encounter so a clinician viewing one encounter is
    never sent another encounter's traffic. Local queues only hold the connections
    this process owns; the events themselves travel between replicas over the
    transport, because the clinician's SSE connection is on whichever replica the
    load balancer chose and the NPHIES response arrives on whichever replica made
    the call. Those are usually not the same process.

    Without a transport it degrades to the old in-process behaviour, and says so.
    """

    def __init__(
        self,
        transport: StatusTransport | None = None,
        replica_id: str | None = None,
    ) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = asyncio.Lock()
        self._transport = transport
        self._replica_id = replica_id or f"{socket.gethostname()}:{os.getpid()}"

    @property
    def shared(self) -> bool:
        return self._transport is not None

    async def start(self) -> None:
        if self._transport is not None:
            await self._transport.start(self._on_remote)

    async def stop(self) -> None:
        if self._transport is not None:
            await self._transport.stop()

    async def subscribe(self, encounter_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE_MAXSIZE)
        async with self._lock:
            self._subscribers[encounter_id].add(queue)
        return queue

    async def unsubscribe(self, encounter_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers[encounter_id].discard(queue)
            if not self._subscribers[encounter_id]:
                self._subscribers.pop(encounter_id, None)

    def deliver_local(self, encounter_id: str, event: dict[str, Any]) -> int:
        """Hand an event to this process's subscribers. A full queue is dropped
        rather than blocking the publisher -- a stalled reader must not stall a
        NPHIES transaction."""
        delivered = 0
        for queue in list(self._subscribers.get(encounter_id, ())):
            try:
                queue.put_nowait(event)
                delivered += 1
            except asyncio.QueueFull:
                logger.warning("nphies_event_dropped_slow_subscriber", encounter_id=encounter_id)
        return delivered

    async def publish(self, encounter_id: str, event: dict[str, Any]) -> int:
        """Deliver here and to every other replica. Returns the local delivery count."""
        delivered = self.deliver_local(encounter_id, event)
        if self._transport is not None:
            envelope = {
                "origin": self._replica_id,
                "encounter_id": encounter_id,
                "event": event,
            }
            try:
                await self._transport.publish(_channel(encounter_id), json.dumps(envelope))
            except Exception:  # noqa: BLE001 -- local delivery already happened
                logger.warning("nphies_status_fanout_publish_failed", encounter_id=encounter_id)
        return delivered

    async def _on_remote(self, envelope: dict[str, Any]) -> None:
        if envelope.get("origin") == self._replica_id:
            return  # our own event, already delivered locally before it was published
        self.deliver_local(str(envelope["encounter_id"]), envelope["event"])

    def subscriber_count(self, encounter_id: str) -> int:
        return len(self._subscribers.get(encounter_id, ()))


def _build_transport() -> StatusTransport | None:
    url = os.getenv("REDIS_URL")
    if not url:
        logger.warning(
            "nphies_status_fanout_local_only",
            detail="REDIS_URL is not set, so an SSE subscriber only sees events "
            "published by this process. Set REDIS_URL to share them.",
        )
        return None
    return RedisStatusTransport(url)


broker = StatusBroker(transport=_build_transport())


def _event(
    encounter_id: str,
    order_id: Optional[str],
    status: str,
    **extra: Any,
) -> dict[str, Any]:
    """Build one `nphies_status_updated` payload.

    `status` is one of: queued | approved | pended | error | eligible |
    not_eligible. `pended` is used by both flows: an undecided prior-auth
    outcome, and an eligibility response that arrived in a non-complete state
    (queued/partial) -- neither may read as approved or eligible downstream.
    """
    return {
        "event": EVENT_NAME,
        "encounter_id": encounter_id,
        "order_id": order_id,
        "status": status,
        **extra,
    }


async def submit_prior_auth_task(
    encounter_id: str,
    order_id: str,
    icd10_code: str,
    sbs_code: str,
    clinical_document: bytes | str,
    *,
    client: Optional[NphiesFhirClient] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Run one prior-authorization submission and publish the outcome.

    Never raises into the caller: a background task that raises would surface
    nowhere useful, so failures are converted into an `error` status event that
    the UI can actually render.
    """
    owns_client = client is None
    client = client or NphiesFhirClient()
    try:
        result = await client.submit_prior_auth(
            encounter_id, icd10_code, sbs_code, clinical_document, **kwargs
        )
        event = _event(
            encounter_id,
            order_id,
            result["status"],
            authorization_number=result.get("authorization_number"),
            disposition=result.get("disposition"),
            mode=result.get("mode"),
        )
    except (NphiesNotConfigured, NphiesEgressBlocked) as exc:
        # Configuration/policy refusals are the operator's to fix -- surface the
        # reason verbatim rather than a generic failure.
        logger.error("nphies_prior_auth_refused", encounter_id=encounter_id, error=str(exc))
        event = _event(encounter_id, order_id, "error", detail=str(exc))
    except NphiesError as exc:
        logger.error("nphies_prior_auth_failed", encounter_id=encounter_id, error=str(exc))
        event = _event(encounter_id, order_id, "error", detail="NPHIES transaction failed.")
    except Exception as exc:  # noqa: BLE001
        logger.error("nphies_prior_auth_unexpected", encounter_id=encounter_id, error=str(exc))
        event = _event(encounter_id, order_id, "error", detail="Unexpected error.")
    finally:
        if owns_client:
            await client.aclose()

    await broker.publish(encounter_id, event)
    return event


async def check_eligibility_task(
    encounter_id: str,
    patient_civil_id: str,
    payer_id: str,
    *,
    client: Optional[NphiesFhirClient] = None,
) -> dict[str, Any]:
    """Run one eligibility check and publish the outcome.

    Triggered automatically when a diagnosis or order lands on an active
    encounter, so coverage is confirmed before the clinician reaches submission.
    """
    owns_client = client is None
    client = client or NphiesFhirClient()
    try:
        result = await client.check_eligibility(patient_civil_id, payer_id)
        response = result.get("response", {}) or {}
        outcome = str(response.get("outcome") or "complete")
        if outcome != "complete":
            # An undecided eligibility response (queued/partial, or anything
            # unrecognised) is PENDED -- it must not render as eligible, and
            # calling it "not eligible" would overstate what the payer said.
            event = _event(
                encounter_id,
                None,
                "pended",
                disposition=response.get("disposition"),
                mode=result.get("mode"),
            )
        else:
            inforce = any(
                bool(ins.get("inforce"))
                for ins in (response.get("insurance") or [])
                if isinstance(ins, dict)
            )
            event = _event(
                encounter_id,
                None,
                "eligible" if inforce else "not_eligible",
                disposition=response.get("disposition"),
                mode=result.get("mode"),
            )
    except (NphiesNotConfigured, NphiesEgressBlocked) as exc:
        logger.error("nphies_eligibility_refused", encounter_id=encounter_id, error=str(exc))
        event = _event(encounter_id, None, "error", detail=str(exc))
    except NphiesError as exc:
        logger.error("nphies_eligibility_failed", encounter_id=encounter_id, error=str(exc))
        event = _event(encounter_id, None, "error", detail="NPHIES eligibility check failed.")
    except Exception as exc:  # noqa: BLE001
        logger.error("nphies_eligibility_unexpected", encounter_id=encounter_id, error=str(exc))
        event = _event(encounter_id, None, "error", detail="Unexpected error.")
    finally:
        if owns_client:
            await client.aclose()

    await broker.publish(encounter_id, event)
    return event


async def status_event_stream(
    encounter_id: str,
    *,
    heartbeat_seconds: float = 20.0,
) -> AsyncGenerator[str, None]:
    """SSE generator for one encounter's NPHIES status events.

    Emits a comment heartbeat when idle so proxies don't close the connection.
    """
    queue = await broker.subscribe(encounter_id)
    try:
        yield f"event: {EVENT_NAME}\ndata: {json.dumps(_event(encounter_id, None, 'connected'))}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
                continue
            yield f"event: {EVENT_NAME}\ndata: {json.dumps(event)}\n\n"
    finally:
        await broker.unsubscribe(encounter_id, queue)
