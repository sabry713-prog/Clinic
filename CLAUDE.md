# Veritas-Medica Project Rules

## Core Principles
1. ZERO FACTUAL HALLUCINATIONS: Do NOT use LLMs to guess or generate clinical facts, drug dosages, or NPHIES billing codes. Factual queries MUST be executed deterministically against Neo4j via Cypher queries.
2. LLM SCOPE: DeepSeek API is strictly used for natural language formatting, ambient transcription (SOAP note structuring), and turning graph query results into clean prose.
3. UI SPECIFICATION: Follow the Sully AI 3-pane layout:
   - Left: Ambient Scribe & Live SOAP Note Editor
   - Center: Patient Master Timeline & Order Entry with NPHIES Status Badges (🟢 Green / 🟡 Yellow / 🔴 Red)
   - Right: Collapsible "AI Team" Drawer (Scribe, Consultant, Pharmacist, NPHIES Agents)

## Tech Stack
- Frontend: Next.js (React), Tailwind CSS, Lucide Icons, WebSockets
- Backend: Python (FastAPI) or Node.js
- Databases: PostgreSQL (Existing Patient Data), Neo4j (PSKG & NPHIES Graph)
- APIs: DeepSeek API (`api.deepseek.com`), NPHIES FHIR Sandbox API
