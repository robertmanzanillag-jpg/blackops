# Clippers marketplace refresh

`npm run clippers:marketplace-refresh` asks explicitly authorized, zero-cost local adapters for fresh marketplace snapshots. It never logs in by itself, invents campaigns, pays for an API, or runs a command through a shell.

## Configuration

The default config file is `clippers-marketplace-refresh.json` under `CLIPPERS_CONFIG_ROOT` (or the process working directory). Override it with `CLIPPERS_MARKETPLACE_REFRESH_CONFIG`; relative overrides are resolved from `CLIPPERS_CONFIG_ROOT`, never from the runtime checkout.

```json
{
  "schemaVersion": 1,
  "providers": [
    {
      "provider": "vyro",
      "enabled": true,
      "authorized": true,
      "adapters": [
        {
          "command": "/absolute/path/to/a/trusted-adapter",
          "args": ["--json"],
          "timeoutMs": 30000,
          "envAllowlist": ["CLIPPERS_MARKETPLACE_VYRO_SESSION_FILE"]
        }
      ]
    }
  ]
}
```

Supported provider names are `vyro`, `whop`, `content_rewards`/`Content Rewards`, and `clipping`/`clipping.net`. The executable must be an absolute, regular, non-symlink path. Arguments are passed directly to the executable with `shell: false`. Only a minimal process environment plus explicitly allowlisted variables named `CLIPPERS_MARKETPLACE_<PROVIDER>_*` reaches the adapter; paid-AI, billing, card, and payment variables are always rejected.

Adapters are tried in order. An adapter must write exactly one JSON document to stdout:

```json
{
  "marketplace": "vyro",
  "observedAt": "2026-08-12T12:00:00.000Z",
  "campaigns": []
}
```

Every returned campaign must already contain the active/joined state, expiry, rights expiry and attestation, HTTPS source URL, local rights-evidence path, compatible account, CPM, and minimum-view terms expected by the marketplace intake. The refresher rejects incomplete output; it never supplies missing values.

Validated snapshots are written atomically to `CLIPPERS_WORKSPACE_ROOT/research/marketplace-snapshots/<provider>.json`. The detailed, secret-free run report is `CLIPPERS_WORKSPACE_ROOT/reports/marketplace-refresh-report.json`.

Environment variables:

- `CLIPPERS_CONFIG_ROOT`
- `CLIPPERS_WORKSPACE_ROOT`
- `CLIPPERS_MARKETPLACE_REFRESH_CONFIG`
- `CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS` (default `30000`)

Exit codes:

- `0`: at least one provider wrote a fresh, validated snapshot.
- `2`: no provider refreshed, including missing configuration, authorization, adapter, or session.
- `1`: fatal runtime or filesystem failure.

Adapter stdout and stderr are never included in the report. This avoids copying session tokens or other credentials into durable logs.
