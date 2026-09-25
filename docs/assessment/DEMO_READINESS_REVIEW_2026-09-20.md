# Demo Readiness Review — 2026-09-20

Requested: review the demo and say whether anything blocks it. Three blockers were found; all three
were invisible from the test suites, which were green throughout.

## 1. The API was not listening — caused by today's own work

`core` (:4000) was down, so the wizard would have had no API at all. The log said why:

    Nest can't resolve dependencies of the RbacGuard (Reflector, ?) ... the argument SessionService
    at index [1] is available in the ChecklistModule context.

`ChecklistModule` and `DocumentationModule` — both written today — imported `PatientModule` only. The
RBAC guard resolves `SessionService` at runtime, so a guarded module must declare `RbacModule` and
`AuthModule`; the working sibling `ConditionModule` shows exactly that. **Every service test passed,
typecheck was clean, and the application could not start.** Two boot tests were added, and are the
actual remedy: a service unit test never touches the dependency graph, so a module can be broken at
boot with a fully green suite. Fixed in `5b53d31`.

## 2. The graph engine had died on a platform socket error

`OSError [WinError 64] The specified network name is no longer available` / `Accept failed on a socket`
on `127.0.0.1:5004`. Not a code defect — a uvicorn/Windows accept failure. Restoring the stack brought
it back; it is worth knowing that this failure mode exists and that a restart clears it.

## 3. The reference data in the graph was stale — and stale data does not announce itself

`just verify-demo-data` failed on two checks: the `NphiesService` node count and the
`NPHIES_JUSTIFIES` edge count. The graph held **10086** services and **13** edges against the governed
files' **10081** and **8**. The five extras were the old root-real/suffix-invented codes that today's
correction replaced.

This is the most dangerous class of blocker in this review: a down service tells you it is down, while
stale reference data is silent and makes the demo look like it works. The verdicts would have been
computed against codes that no longer exist — every order falling through to RED — with nothing on
screen to say so.

Two causes, both fixed:
* the manifest had not been updated for the corrected files, so `graph-seed` refused to run (correctly:
  it is the governance gate). Updated to **v2026-09-20.1** with the current checksums, on the owner's
  explicit approval, recorded verbatim in the `approver` field.
* the ingest uses `MERGE` and never deletes, so corrected reference data leaves ghosts behind. The
  stale nodes and edges were removed explicitly and the seed re-run.

**Recorded, not fixed:** the ingest should replace reference data rather than merge into it, so a
correction cannot leave ghosts. Until it does, any future catalog change needs the same manual cleanup
— and the `verify-demo-data` counts are what catch it.

## Verified after the fixes

* 8/8 services listening; `core` health 200
* `verify-demo-data`: **56 passed, 0 failed**
* `verify_reference_release`: **11 files match manifest v2026-09-20.1**
* All suites green: web 267 · graph 156 · orchestrator 109 · qa 69 · nphies-engine 50 · narrative 41 ·
  transcription 39 · core (draft 32, checklist 4+2, documentation 3+2)
* The verdicts, live, on the official codes: `I10 + 11700-00-00` → **GREEN** · `M54.3 + 90901-03-60` →
  **YELLOW (pre-auth)** · `I10 + 90901-03-60` → **RED with M54.3 suggested** · `I10 + 11700-00-00` (the
  retired code) → **RED**, confirming the ghosts are gone
