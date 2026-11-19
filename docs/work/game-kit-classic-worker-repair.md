---
id: game-kit-classic-worker-repair
title: Emit a self-contained classic service worker
status: done
approved: user, approval ledger entry game-kit-classic-worker-repair
design: build
related: []
---

## Scope

Emit one self-contained classic service-worker script even when the page shares helper modules with it, preserving registration and launch policy.

## Criteria

- As recorded in the approval ledger entry `game-kit-classic-worker-repair`.

## Decisions

- Recorded before work files existed; the ID is the approval ledger key.

## Outcome

Released in 0.47.1. The router worker in 0.59.0 is built the same way.
