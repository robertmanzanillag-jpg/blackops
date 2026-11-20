# Daily public creator discovery

`script/clippers-portfolio-discovery.mjs` collects public YouTube Atom metadata. It makes no model, paid data, login, media download, account, publishing, or rights-approval calls. It writes only its separate local discovery directory and cannot create an approved publishing asset.

## Run and integrate

```sh
node script/clippers-portfolio-discovery.mjs --state-dir /absolute/private/workspace/portfolio-discovery
```

The default rotates two sets of four verified channels by UTC day: TheGrefg, Vegetta777, elrubiusOMG and Lacy; then Alanzoka, Gotaga, Papaplatte and k4sen. This covers ES/EN/PT-BR/FR/DE/JA within 48 hours while limiting each invocation to four requests. `--creators thegrefg,lacy` selects one to four unique catalogue entries; arbitrary URLs/channel IDs are not CLI inputs. Failed/throttled feeds are recorded rather than retried or replaced with cached success.

The caller can import `runPortfolioDiscovery({ stateDir, now })` from its existing daily watchdog. Schedule/install ownership remains with the integrating operator. This change does not alter launchd, legacy news/YouTube jobs, account routing, or the daily learning/publishing input.

Each UTC-day/creator-set receipt is created exclusively with mode `0600`, behind a local lock, and is reused without another request on the same cycle. A second day produces an additional observation; old receipts remain intact. A crash can leave `.discovery.lock`; investigate the process before removing that lock. Symlink roots/files and non-private receipt files are refused. Directory paths must be absolute and canonical, including macOS `/private/var` rather than its `/var` alias when using temporary directories.

## Identity and network boundary

The eight channel IDs were read from the official public handle pages' `link rel="canonical"` on 2026-11-18, not from similarly named channels or nested recommendations:

| Creator | Official identity evidence | Channel ID |
| --- | --- | --- |
| TheGrefg | <https://www.youtube.com/@TheGrefg> | `UCCEmjNPpJYhGDgaEqeeA4HA` |
| Vegetta777 | <https://www.youtube.com/@vegetta777> | `UCam8T03EOFBsNdR0thrFHdQ` |
| Rubius | <https://www.youtube.com/@elrubiusOMG> | `UCXazgXDIYyWH-yXLAkcrFxw` |
| Lacy | <https://www.youtube.com/@LacyHimself> | `UCeoZXkaJDtdTHafgoZeDcAA` |
| Alanzoka | <https://www.youtube.com/@alanzoka> | `UCIwspRtKNszHhIhl36gREjQ` |
| Gotaga | <https://www.youtube.com/@Gotaga> | `UCCFqUJYKT97UerMmb6DM0bw` |
| Papaplatte | <https://www.youtube.com/@Papaplatte> | `UCDmbhGe7-wC1a55l5ZYAZJw` |
| k4sen | <https://www.youtube.com/@zzxk4sen> | `UChUjERVG8eKEAJSCef-tTmg` |

Only HTTPS `www.youtube.com/feeds/videos.xml?channel_id=UC…` is fetched, using GET without credentials and with redirects rejected. The whole response is limited to 256 KiB, at most 25 entries, and a 10-second request deadline. Non-XML, DTD/entity declarations, unknown entities, CDATA, duplicate videos and mismatched header/entry channel identities are refused. YouTube's shortened header channel ID is checked with its exact canonical author URI; entry IDs must carry the full channel ID.

## Evidence limits

Receipts retain exact channel/video IDs, canonical video/feed URLs, original `publishedAt`, `observedAt`, feed hash and actual feed-provided view counts. Missing/non-numeric counts remain `null`. Future publication dates are rejected. Recent uploads receive a 24/72-hour freshness priority; older uploads remain labelled stale. A GTA title match is only a research hint and cannot establish facts or publication rights.

Every observation has `permission: "unknown"`, `mayPublish: false` and zero eligible assets. Existing public campaigns, creator popularity, absence of a prohibition and a successful metadata fetch cannot approve an asset. Clipping permissions must still be checked separately for the exact asset/account/network; in particular the discovered Lacy campaign does not cover Facebook or Japanese captions.

Velocity requires two direct observations of the same video, matching original publication time, at least one hour apart, with non-decreasing actual views. Comparisons require at least five distinct baseline videos in the same channel, network, language, format and observation-age window (within one hour). RSS does not establish a video's language or short/long format, so these remain unknown and the collector cannot declare an outlier from creator-level language alone. There are no statistical significance, causal improvement or automatic promotion claims.

## Validation and rollback

```sh
node --test tests/clippers-portfolio-discovery.test.mjs
```

Tests cover the network/identity boundary, XML declarations, future/stale/duplicate uploads, missing metrics, velocity spacing, comparable baselines, idempotent/private receipts and symlink storage rejection. A bounded live fetch of TheGrefg returned 15 upload observations; an initial header-prefix mismatch was corrected with a regression fixture. No media was downloaded and no rights were approved. Independent QA remains a merge gate; Claude review is pending available credits.

Rollback removes the watchdog import/call when integrated, then reverts this PR. Receipts can remain as read-only research history; they are not authorizations or publishing queue entries.
