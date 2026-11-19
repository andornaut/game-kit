---
id: game-kit-precache-wire-053-publication
title: Encode the precache manifest compactly
status: superseded
approved: user, approval ledger entry game-kit-precache-wire-053-publication
design: pwa
related: [gk-0008]
---

## Scope

Publish a strict compact wire codec for the manifest embedded in the service worker, with an unchanged semantic fingerprint.

## Criteria

- As recorded in the approval ledger entry `game-kit-precache-wire-053-publication`.

## Decisions

- Recorded before work files existed; the ID is the approval ledger key.

## Outcome

Released in 0.53. In 0.59.0 the worker embeds no manifest; builds publish a pointer and per-build manifests (gk-0008).
