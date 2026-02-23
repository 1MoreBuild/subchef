# subchef

CLI for subtitle discovery and download with stable machine-readable output (`--json`) for OpenClaw agents.

## Install

```bash
npm i -g subchef
sub help
```

## Quick start (SubHD-first)

```bash
sub providers
sub search --query "The Matrix" --lang zh,en --limit 5
sub fetch --query "The Matrix" --lang zh --output ./subs --dry-run
sub download --id subhd:xD0xeo --output ./subs --dry-run
```

SubHD is the default provider when `--provider` is omitted.
Use `--provider assrt` to force the deterministic ASSRT fallback mock.

## Agent mode (recommended)

Always use `--json` so every response matches the envelope contract:

- success: `{ "ok": true, "data": ..., "meta": ... }`
- error: `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`

Examples:

```bash
sub providers --json
sub doctor --provider subhd --json
sub search --query "Interstellar" --lang zh,en --limit 5 --json
sub fetch --query "Breaking Bad" --season 1 --episode 1 --lang zh --output ./subs --dry-run --json
sub fetch --query "The Matrix" --provider assrt --output ./subs --dry-run --json
```

## Commands

```bash
sub providers [--json]
sub doctor [--provider <id>] [--json]
sub search --query <text> [--lang <code>] [--year <yyyy>] [--season <n>] [--episode <n>] [--provider <id>] [--limit <n>] [--json]
sub fetch --query <text> --output <path|directory> [--lang <code>] [--year <yyyy>] [--season <n>] [--episode <n>] [--provider <id>] [--limit <n>] [--dry-run] [--json]
sub download --id <subtitle-id> --output <path|directory> [--provider <id>] [--dry-run] [--json]
```

`fetch` is a convenience command: search + deterministic ranking + top candidate download.

## Providers

- `subhd` (real adapter; default/high priority)
- `assrt` (mock fallback provider for deterministic/offline flows)

### SubHD provider notes

- Search is parsed from SubHD HTML pages (fixture-tested; no live scraping in tests).
- Download uses SubHD gate flow (`/down/:id` + `/api/sub/down`).
- Upstream network layer has timeout + retries + exponential backoff.
- Anti-bot/rate-limit responses are normalized into `E_UPSTREAM_*` errors:
  - `E_UPSTREAM_TIMEOUT`
  - `E_UPSTREAM_NETWORK`
  - `E_UPSTREAM_BAD_RESPONSE` with `details.classification` (`anti-bot`, `rate-limit`, or `bad-response`)

## Testing

```bash
pnpm test
pnpm check
```
