"""M01 — a status event must reach the replica that holds the clinician's SSE stream.

The NPHIES response arrives on whichever replica made the call; the clinician's
browser is connected to whichever replica the load balancer picked. Those are
usually different processes, so `publish` has to leave the process that called it.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from tasks import EVENT_NAME, StatusBroker, _channel


class FakeTransport:
    """Stands in for Redis pub/sub: records what was published, delivers on demand."""

    def __init__(self) -> None:
        self.published: list[tuple[str, str]] = []
        self.handler = None
        self.started = False
        self.stopped = False

    async def start(self, handler) -> None:
        self.handler = handler
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, payload))

    async def deliver_remotely(self, envelope: dict[str, Any]) -> None:
        assert self.handler is not None, "the broker never subscribed"
        await self.handler(envelope)


@pytest.mark.asyncio
async def test_publish_reaches_local_subscribers_and_leaves_the_process():
    transport = FakeTransport()
    broker = StatusBroker(transport=transport, replica_id="replica-a")
    await broker.start()

    queue = await broker.subscribe("enc-1")
    event = {"event": EVENT_NAME, "status": "approved"}

    delivered = await broker.publish("enc-1", event)

    assert delivered == 1, "the SSE client on this replica"
    assert queue.get_nowait() == event
    assert len(transport.published) == 1
    channel, payload = transport.published[0]
    assert channel == _channel("enc-1")
    envelope = json.loads(payload)
    assert envelope["origin"] == "replica-a"
    assert envelope["encounter_id"] == "enc-1"
    assert envelope["event"] == event


@pytest.mark.asyncio
async def test_an_event_from_another_replica_is_delivered_here():
    broker = StatusBroker(transport=FakeTransport(), replica_id="replica-a")
    transport = broker._transport  # type: ignore[attr-defined]
    await broker.start()

    queue = await broker.subscribe("enc-2")  # the SSE connection is on this replica
    await transport.deliver_remotely(
        {"origin": "replica-b", "encounter_id": "enc-2", "event": {"status": "approved"}}
    )

    assert queue.get_nowait()["status"] == "approved"


@pytest.mark.asyncio
async def test_a_replica_does_not_deliver_its_own_event_twice():
    transport = FakeTransport()
    broker = StatusBroker(transport=transport, replica_id="replica-a")
    await broker.start()

    queue = await broker.subscribe("enc-3")
    await broker.publish("enc-3", {"status": "queued"})

    # the transport echoes our own envelope back, as pub/sub does
    channel, payload = transport.published[0]
    await transport.deliver_remotely(json.loads(payload))

    assert queue.get_nowait()["status"] == "queued"
    assert queue.empty(), "the echo must not be delivered a second time"


@pytest.mark.asyncio
async def test_events_stay_local_to_their_encounter():
    broker = StatusBroker(transport=FakeTransport(), replica_id="replica-a")
    transport = broker._transport  # type: ignore[attr-defined]
    await broker.start()  # without joining the fan-out there is nothing to receive

    mine = await broker.subscribe("enc-4")
    await transport.deliver_remotely(
        {"origin": "replica-b", "encounter_id": "enc-9", "event": {"status": "approved"}}
    )

    assert mine.empty(), "another encounter's traffic must not leak into this stream"


@pytest.mark.asyncio
async def test_without_a_transport_it_is_in_process_and_says_so():
    broker = StatusBroker(transport=None, replica_id="replica-a")
    assert broker.shared is False

    await broker.start()  # must not raise without a transport
    queue = await broker.subscribe("enc-5")
    assert await broker.publish("enc-5", {"status": "error"}) == 1
    assert queue.get_nowait()["status"] == "error"


@pytest.mark.asyncio
async def test_a_slow_subscriber_is_dropped_not_awaited():
    broker = StatusBroker(transport=None, replica_id="replica-a")
    queue = await broker.subscribe("enc-6")

    # fill the bounded queue, then one more
    for _ in range(64):
        queue.put_nowait({"status": "queued"})
    await broker.publish("enc-6", {"status": "overflow"})

    assert queue.qsize() == 64, "the publisher was not blocked by the stalled reader"
