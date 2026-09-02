# eikon_demo_app_theta

React + TypeScript (Next.js, App Router) front-end for EIKON — the migration target
replacing the Streamlit app `eikon_demo_app_beta.py`.

See **`../EIKON_FRONTEND_MIGRATION_PLAN.md`** for the full conversion plan,
endpoint inventory, state-mapping, and phased roadmap.

## Status

All tabs from the Streamlit app are ported (Eikon AI, Search, Context,
Similarity, Portfolio, Object Detection, Drone Corridor, Memory, History, Docs).

**Remote Assessment** (new, not in the Streamlit app) runs object detection
across every tile in a dropdown area or a map-drawn polygon and renders a
per-cell coverage heat map, with an object selector built from whatever classes
the backend returns. See `../CLAUDE_CONTEXT.md` § "Remote Assessment Tab" for
the backend contract and file map.

## Stack

- Next.js 14 (App Router) + TypeScript
- TanStack Query — data fetching, caching, polling (fixes the Streamlit
  rerun/caching instability)
- deck.gl + react-map-gl (MapLibre) — maps (ports the `pydeck` layers)
- Tailwind CSS — styling
- Zustand — local/global UI state where Context isn't enough

## Getting started

> Node ≥ 18 required. (Not installed in the original authoring environment —
> these files were written by hand.)

```bash
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_EIKON_API_BASE_URL
npm run dev                         # http://localhost:3000
```

Auth is currently **stubbed** in `src/hooks/useAuth.tsx` (any non-empty
email/password logs in) until the real auth HTTP endpoint is confirmed — it
runs through the Python SDK in the Streamlit app. See plan §10 action item 1.

## Layout

```
src/
  app/            # routes (one folder per tab) + layout/providers
  lib/            # config (endpoints), apiClient, types
  hooks/          # useAuth (+ future useSearchJob, useChat, useCredits…)
  components/     # layout (AppShell, TabNav), ui, map
  features/       # per-tab feature components (added per phase)
```

## Next steps (Phase 1)

1. Confirm the auth endpoint and wire `login()` to the backend.
2. Build the `/search` vertical slice: submit → poll status → result cards → map.
3. Add `useCredits` hook + credit chip in the header.
