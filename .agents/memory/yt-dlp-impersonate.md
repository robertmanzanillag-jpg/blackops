---
name: YouTube bot-block fix via --impersonate
description: How to bypass YouTube's TLS bot detection on Replit datacenter IPs using yt-dlp --impersonate and curl-cffi
---

# YouTube Bot-Block on Replit Production IPs

## The Rule
On Replit production (autoscale), YouTube detects datacenter IPs by TLS fingerprint (JA3/JA4). Even with cookies, downloads fail. The fix: `yt-dlp --impersonate chrome` with `curl-cffi` in PYTHONPATH.

## Why
YouTube's bot detection checks the TLS fingerprint of the connecting client. Replit IPs have non-browser fingerprints. `curl-cffi` makes yt-dlp use Chrome's exact TLS stack (JA3/JA4 hash, HTTP/2 settings, header order).

## How to Apply
1. `bin/yt-dlp` (v2026.06.09) is committed in the workspace root — use it as the explicit binary via `getWorkspaceYtDlpBin()`.
2. Install `curl-cffi` at runtime into `/tmp/robplanner-curl-cffi` using `getCurlCffiPackageDir()` (pip env without `--isolated`, with `PIP_CONFIG_FILE=/dev/null`).
3. Set `PYTHONPATH` to that dir when running `bin/yt-dlp` so it finds `curl-cffi`.
4. Pass `--impersonate chrome` (or `chrome-120`) as the FIRST variant in the command spec matrix — before js-runtimes and client spoofing.
5. Impersonation targets are configurable via `YT_DLP_IMPERSONATE` env var; defaults to `["chrome", "chrome-120"]`.

## Architecture
In `buildYtDlpCommandSpecs`: impersonation specs (binary + curl-cffi PYTHONPATH + `--impersonate`) run FIRST. Regular fallback specs follow. `uniqueCommandSpecs` deduplicates the final list.
