# Hospital System HIS Transactional Connector — Dummy/Stub

**Status:** Dummy integration, built on an UNCONFIRMED assumed interface profile. No real network call
exists in `stub` mode (the only mode currently runnable). Nothing here has been validated with any real
hospital's IT/informatics team. "Hospital System" ("hospital sys" in code identifiers) is a generic
stand-in name — this connector is not built against, or associated with, any specific named hospital or
vendor.

---

> ## ⚠️ ASSUMPTION NOTICE — no confirmed real-world interface spec exists
>
> This connector was built at the CTO's direction to prototype the "single pane of glass" order/
> prescription-transmission architecture, with the explicit instruction to assume plausible answers to an
> integration-discovery questionnaire rather than wait for a real one. **Every technical detail below is
> an assumption, not a confirmed fact about any specific hospital:**
>
> - **Platform:** assumed Cerner Millennium-class HIS, as a representative example of a Gulf-region
>   flagship/private hospital operating at HIMSS EMRAM Stage 7 (Stage 7 requires closed-loop CPOE +
>   closed-loop medication administration as certification criteria, and Cerner is a common Stage 7 vendor
>   among such hospitals) — a generic illustrative assumption, not a confirmed fact about any real site.
> - **Order transactions:** assumed HL7v2 `ORM^O01` out / `ORR^O02` (accept/reject) back, via an existing
>   hospital interface engine. Reads already use FHIR (existing ingestion pipeline); this assumption is
>   about the write/order path specifically, where HL7v2 ORM remains more common than FHIR order write-back
>   even in modern Gulf-region Cerner deployments.
> - **Safety validation:** assumed to happen entirely on the receiving hospital's side, synchronously, on
>   receipt of the order message — this was an explicit CTO decision, not a technical fact about any real
>   hospital's system.
>
> **Before any production use:** confirm the actual HIS product/version with the target hospital's IT team,
> confirm whether they expose a real-time order interface at all (many hospital systems only support batch
> HL7v2 feeds, or don't accept third-party inbound orders), get interface-engine access and sandbox
> credentials, and reconcile whatever their real message format turns out to be against the assumptions
> here.

---

## Why this stays inside the non-SaMD boundary (CLAUDE.md §2)

Cortex.ai performs **no interaction, allergy, or dose checking anywhere in this connector.** The receiving
HIS is the sole clinical safety validator. Concretely:

- `HospitalSysConnectorService.transmit()` always **re-derives** the transmitted order content server-side
  from the clinician's own already-confirmed `app.service_request` or `app.refill_request` row — it never
  accepts order content as a parameter, so there is nothing for Cortex.ai to construct, judge, or modify.
- A rejection's `backend_reason_code`/`backend_reason_text` are stored and displayed **exactly as
  received** (in stub mode: exactly as simulated) — `HisTransmitControl.tsx` renders `backend_reason_text`
  verbatim inside a plain disclosure, with no summarization, no rephrasing, no severity styling.
- Transmission status (`pending`/`accepted`/`rejected`/`failed`) uses one neutral style regardless of
  outcome — it is an administrative transmission status, never a clinical-severity indicator, same rule
  every other status display in this codebase already follows.
- An `idempotency_key` (`sha256(source_type:source_id)`) prevents a retried request from producing a
  second live transmission of the same order — the one genuine patient-safety property a connector layer
  itself is responsible for (never double-ordering), independent of what the receiving HIS decides.

## What's simulated in `stub` mode (the only mode that runs)

Everything. `HIS_CONNECTOR=stub` (default) makes `HospitalSysConnectorService` compute a **deterministic**
simulated `ORR` outcome from a hash of the order's own id (same "deterministic, not random" dev-data
convention as `seed:nphies-claims`) — so the same order always reproduces the same simulated result across
repeated calls, which made the idempotency/re-transmission behavior easy to verify live. Service-request
(imaging/lab) transmissions mostly simulate `accepted`; refill-request (medication) transmissions
occasionally simulate a rejection from two canned reasons (`DUPLICATE_THERAPY`, `FORMULARY_RESTRICTED`).
`HIS_CONNECTOR=live` throws `HOSPITAL_SYS_LIVE_NOT_CONFIGURED` honestly — same pattern as
`NPHIES_LIVE_NOT_CONFIGURED` in `nphies/connector.service.ts` — rather than silently falling back to stub
behavior.

## What a real integration would need

1. Confirmed HIS product/version and its actual third-party integration capability, from the target
   hospital's own IT/informatics team — not inferred from a HIMSS award or any other public signal.
2. Interface-engine access (Mirth/Rhapsody/Cloverleaf-class, or whatever the hospital already runs) with a
   confirmed message spec — HL7v2 ORM/ORR fields, or a FHIR-based order-write API if one exists.
3. Guaranteed-delivery messaging with real acknowledgment tracking, not the request/response HTTP call
   this stub uses — a dropped acknowledgment must be distinguishable from a genuine rejection.
4. Sandbox credentials and a certification/testing process before any real order reaches a real patient.
5. A resolved answer to which regulatory track applies (separate from SFDA MDS-G027 non-SaMD Health IT) —
   flagged in the original architecture discussion, not resolved here.
6. A specific target hospital, confirmed and named, once one is selected for a real pilot — this document
   deliberately does not name one.

## Tables / code

- Migration `1719700000000_his-order-transmission.ts` — `app.his_order_transmission`.
- `apps/core/src/his-connector/` — `HospitalSysConnectorService`, `HospitalSysConnectorController`,
  `HisConnectorModule`.
- `apps/web/src/components/HisTransmitControl/` — shared UI, used from both `ServiceRequestPanel.tsx` and
  `RefillPanel.tsx`.
- New permission `his_transmission:write` (`packages/shared-types/src/index.ts`), granted to `physician`
  and `nurse` — the same roles that already hold `service_request:write`/`refill_request:write`.
