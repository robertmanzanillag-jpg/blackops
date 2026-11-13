# Clippers YouTube delivery worker

`clippers-youtube-delivery-worker.mjs` is the single sequential delivery entrypoint. It first runs the offline upload packager against an explicit owner-only `0600` config. It invokes the networked publish worker only when packaging returns `completed` and names the reviewed queue it produced. A workspace lock prevents overlapping delivery runs.

The worker writes `reports/youtube-delivery-worker-latest.json` atomically with mode `0600`. The report contains stage, blocker codes, counts, and only exact confirmed `youtube.com/watch?v=...` URLs. Planned, rendered, packaged, blocked, and uncertain items are never counted as published. Secrets and OAuth values are never written to the report.

## Runtime configuration

Use the owner authorization schema in `docs/clippers-youtube-upload-packager.md` for the delivery config. Keep it at mode `0600`.

The LaunchAgent calls `run-clippers-youtube-delivery-worker.sh`. That wrapper reads a separate owner-only selected environment file and exports only:

- `CLIPPERS_YOUTUBE_{ES,EN,SLEEP}_CHANNEL_ID`
- `CLIPPERS_YOUTUBE_{ES,EN,SLEEP}_{CLIENT_ID,CLIENT_SECRET,REFRESH_TOKEN}`
- `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED`

The plist contains only paths, schedule controls, and non-secret runtime roots. Neither the delivery JavaScript nor its children read `.env` files. Before starting Node, the wrapper replaces the inherited environment with a minimal system environment plus the exact allowlist above, and it never echoes selected values.

Run manually only after reviewing the same config and selected environment:

```sh
CLIPPERS_RUNTIME_ROOT=/absolute/runtime \
CLIPPERS_YOUTUBE_DELIVERY_CONFIG=/absolute/config.json \
CLIPPERS_YOUTUBE_SELECTED_ENV=/absolute/youtube-selected.env \
zsh script/run-clippers-youtube-delivery-worker.sh
```

Rollback by unloading `com.blackops.clippers-youtube-delivery-worker`; do not delete MP4s, reviewed queues, ledgers, or reconciliation evidence.
