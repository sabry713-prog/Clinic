# 05 — Coding Standards

These are the standards every contributor — human or AI — follows. Claude Code is held to the same bar as any engineer.

## General principles

1. **Clarity over cleverness.** This is a clinical product. The next reader is more important than the current author.
2. **Explicit over implicit.** No magic. No reflection-heavy DI tricks. No hidden globals.
3. **Small modules.** A file that does one thing is easier to review and to retire.
4. **Pure functions where possible.** Side effects at the boundaries.
5. **Type everything.** TypeScript strict mode. Python with type hints + mypy strict.
6. **Errors are values, not surprises.** Use Result / Either patterns for known failure modes. Reserve exceptions for truly unexpected conditions.
7. **No PHI in code or comments.** Examples in code use synthetic data only.
8. **No interpretive language in code comments.** "Probably a sepsis case" in a comment is a bug. Restate the technical decision.

## TypeScript

- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- ESLint with `@typescript-eslint/strict-type-checked` + `@typescript-eslint/stylistic-type-checked`
- Prettier (formatter); 100-char line limit; semicolons; double quotes
- Prefer `import type` for type-only imports
- Prefer `readonly` for immutable data structures
- Avoid `any`. Use `unknown` and narrow.
- Use **branded types** for IDs (`type PatientId = string & { __brand: "PatientId" }`)
- Avoid default exports except for React component files

### NestJS conventions

- One module per bounded context (`patient`, `qa`, `narrative`, `audit`, etc.)
- DTOs are class-validator classes; controller validates input
- Service classes contain business logic; controllers stay thin
- No business logic in entities/Prisma models
- Repository pattern only where it adds value (don't wrap Prisma for the sake of it)

### React conventions

- Functional components only
- React Query for server state; Zustand for ephemeral client state
- Component file structure: `Foo/index.tsx`, `Foo/Foo.tsx`, `Foo/Foo.test.tsx`
- Tailwind utility classes; no inline styles
- Accessibility: every interactive element keyboard-reachable; label every input; landmark roles
- RTL: never hardcode `left`/`right`; use logical properties (`ms-`, `me-`, `start`, `end`) and CSS logical properties
- i18n: every user-facing string passes through `t("...")`; no hardcoded English in JSX

## Python

- Python 3.12. `ruff` for linting + formatting. `mypy --strict` for type checks.
- Line length 100. Double quotes (ruff format).
- `from __future__ import annotations` at top of every file
- Type hints required on every function signature
- Avoid dynamic typing; use `Protocol` for structural typing
- Pydantic models for API and gRPC boundaries
- Dataclasses for internal value objects (no business logic)
- Errors are explicit: `Result[T, E]` patterns or raise narrow custom exceptions
- No global state. Inject dependencies (constructor or function parameters).

### FastAPI conventions

- Routers organized by domain (one router per file)
- Pydantic models for every request and response; no untyped dicts crossing the boundary
- Dependencies (auth, db session, model client) via `Depends(...)`
- Async by default; sync only for CPU-bound code paths

## Naming

- Variables: `snake_case` (Python), `camelCase` (TS)
- Constants: `UPPER_SNAKE_CASE`
- Classes / types: `PascalCase`
- Files: `kebab-case.ts` / `snake_case.py`
- API paths: `/api/v1/lowercase-with-hyphens`
- DB tables: `snake_case`, singular (`patient`, not `patients`)
- DB columns: `snake_case`
- Git branches: `slice-N/short-description`

## Comments and documentation

- Public APIs (functions, classes, modules) have docstrings/JSDoc
- Comments explain **why**, not **what**
- Decision rationale lives in ADRs (`docs/adr/####-title.md`), not in scattered comments
- Every prompt template change includes a version bump and a one-line changelog entry
- Every classifier rule includes its positive and negative examples in the same file

## Logging

- Structured JSON. Fields: `ts`, `level`, `service`, `request_id`, `trace_id`, `event`, plus event-specific fields
- No PHI fields. Use IDs and codes.
- Log levels: `error` (intervention needed), `warn` (degraded), `info` (significant), `debug` (dev only)
- Never log the full content of a generated answer or a free-text question to operational logs. Those live in the audit log only, with appropriate access controls.

## Error handling

- API errors return the standard shape from `docs/api/01-conventions.md`
- Internal errors include a `trace_id` so support can find them
- Never expose stack traces to clients
- Never expose database errors to clients (catch and translate)

## Testing discipline

- Every PR includes tests for the changed behavior
- Coverage cannot regress
- A test must fail before it passes (write the test red, then make it green)
- Flaky tests are bugs; either fix or remove

## Review gates (human in the loop)

Files in these directories **require human sign-off** before merging — see also `CLAUDE.md` section 6:

- `docs/prompts/**` — CTO + Clinical Advisor
- `docs/classifier/**` — CTO + Clinical Advisor
- `packages/blocklist/**` — CTO + Clinical Advisor
- `packages/classifier/**` — CTO + Clinical Advisor
- Auth, RBAC, audit modules — CTO
- FHIR identity reconciliation — CTO

CI enforces a CODEOWNERS-driven required-reviewer policy on these paths.

## Pull request hygiene

- One concern per PR
- Title in conventional commits style: `feat(qa): add classifier rule for trend interpretation`
- Description includes:
  - What changed
  - Why
  - How tested (which tests; what was the manual verification)
  - Any docs updated
  - Any review gates applicable
- Screenshots for UI changes
- Bench output for performance-sensitive changes

## Working with Claude Code

When delegating a task to Claude Code:

1. **Reference the doc files explicitly** in your prompt (e.g., "per docs/api/05-qa.md")
2. **State the exit condition** ("stop when AC-5 passes")
3. **Limit scope per turn**: one slice, or one well-defined module within a slice
4. **Always review the diff** before merging — every line
5. **Run tests yourself** — don't trust an "all green" claim without verifying
6. **For safety-critical files** (prompts, classifier, blocklist): treat AI suggestions as drafts; rewrite by hand if the change is subtle

Pattern that works:
> "Read docs/api/05-qa.md and docs/classifier/01-design.md. Implement the Q&A endpoint following the conventions in docs/api/01-conventions.md. Add unit tests for: (a) ALLOWED path with stub model, (b) REFUSED path with no model call, (c) blocklist fallback path. Show me the changes for review before applying."

Pattern that does NOT work:
> "Build the Q&A feature."

## Forbidden patterns (code review hard stops)

- Logging PHI to operational logs
- Sending PHI to a model endpoint that lacks the contractual guarantees in `docs/architecture/05-security.md`
- Removing the blocklist filter from any generative path "for performance"
- Lowering the classifier confidence threshold
- Adding any feature listed in `CLAUDE.md` section 2 (out-of-scope list)
- Caching auth/RBAC decisions across user sessions
- Skipping audit log writes for any clinical-data access
- Hardcoding API keys, even in tests
- Disabling RLS policies
