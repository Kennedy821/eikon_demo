# eikon_demo_app_theta

React + TypeScript (Next.js, App Router) front-end for EIKON — the migration target
replacing the Streamlit app `eikon_demo_app_beta.py`.

See **`../EIKON_FRONTEND_MIGRATION_PLAN.md`** for the full conversion plan,
endpoint inventory, state-mapping, and phased roadmap.

## Status

**Phase 0 — Foundation (scaffolded).** Config, providers, typed endpoint
inventory, API client, domain types, app shell + tab nav, login, and per-tab
placeholder pages are in place. Tabs are stubbed and wired into the nav.

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
