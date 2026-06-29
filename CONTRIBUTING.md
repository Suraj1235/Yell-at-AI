# Contributing

Thanks for helping give assistants better ears.

Before contributing substantial code, open an issue describing the change. The project uses a noncommercial source license with optional commercial licensing, so substantial contributions need the contributor license agreement in `CONTRIBUTOR-LICENSE-AGREEMENT.md`.

## Development

```sh
npm run check
```

Keep changes contract-first:

- update `schemas/vocalcontext.v1.schema.json` only for compatible additions
- use `vocalcontext/v2` for breaking changes
- add or update fixtures for behavior changes
- keep flags evidence-based, not diagnostic
- do not add network calls to the core engine

## Commit Style

Use concise conventional-style commits when possible:

```text
feat: add calibration baseline loader
fix: lower pause-density false positives
docs: clarify tier-a steering
```
