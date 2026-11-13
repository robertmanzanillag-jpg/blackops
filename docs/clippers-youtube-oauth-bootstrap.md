# Clippers YouTube OAuth bootstrap

`script/clippers-youtube-oauth-bootstrap.mjs` creates the lane-specific OAuth configuration consumed by the existing YouTube delivery wrapper. It authorizes the three exact channels one at a time through Google's installed-app loopback flow. It does not upload, publish, purchase anything, or call a paid media/AI API.

## Security and release gates

- The downloaded OAuth JSON must be an `installed` (Desktop app) client using Google's official authorization and token endpoints. Google's official legacy authorization URL (`https://accounts.google.com/o/oauth2/auth`) is accepted when present in a downloaded Desktop JSON, but browser authorization is always normalized to the current v2 endpoint (`https://accounts.google.com/o/oauth2/v2/auth`). All other authorization URLs and every non-official token URL are rejected.
- The credential JSON must be a regular, non-symlink file owned by the current user with mode `0600`.
- Each authorization uses a new random state and PKCE S256 verifier, requests exactly `youtube.upload` for delivery plus `youtube.readonly` to verify `channels.list?mine=true`, and explicitly requests offline consent. The token exchange must confirm both scopes or the bootstrap fails closed.
- After each grant, `channels.list?mine=true` must return exactly its expected channel ID. A mismatch stops the run.
- The selected environment is written only after all three lanes pass. The write is atomic and owner-only `0600`; a failed lane leaves no partial file.
- Client secrets, access tokens, refresh tokens, authorization codes, PKCE values, and authorization URLs are never printed or returned.
- The generated file always sets `CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=false`. OAuth therefore does not authorize public publishing. Existing per-item rights, QA, dedupe, privacy and publication gates remain in force.
- API/spend cost is recorded as USD 0. This bootstrap never enables billing, ads, boosts, paid APIs, or paid generation.

## Safe validation without network

First secure the Google-downloaded Desktop client JSON, then validate it without opening a browser, calling Google, or writing an output:

```sh
chmod 600 /absolute/private/path/client_secret_download.json
node script/clippers-youtube-oauth-bootstrap.mjs \
  --credentials /absolute/private/path/client_secret_download.json \
  --output /absolute/private/path/clippers-youtube-selected.env \
  --dry-run
```

The default expected channels are pinned to:

- Spanish motivation: `UC31lPi3c0ritooHLqvmNMEg`
- English motivation: `UCKsOxLz4eyw47DMhb4aSaBA`
- Sleep: `UCS-xy72lGNTh51p2aICHxcw`

## Interactive bootstrap

Run only from a private local terminal after reviewing the dry-run result:

```sh
node script/clippers-youtube-oauth-bootstrap.mjs \
  --credentials /absolute/private/path/client_secret_download.json \
  --output /absolute/private/path/clippers-youtube-selected.env
```

Three browser grants open sequentially. Select the named channel shown in the terminal for each lane. If Google returns another channel, the exact-ID check blocks the run and the selected environment is not created.

Keep both credential files outside the repository, backups, chat, logs, and shared folders. Never paste their contents into an issue or PR. Pass the generated selected env to `CLIPPERS_YOUTUBE_SELECTED_ENV` as documented in `docs/clippers-youtube-delivery-worker.md`. Private uploads can then be tested through the existing uploader gates; public publishing remains disabled until separately authorized and configured.

## Rollback

Unload the YouTube delivery LaunchAgent or remove its reference to the selected environment. Do not delete uploaded media, local MP4s, queues, ledgers, QA records, or rights evidence. Revoking the three Google grants invalidates their refresh tokens if credential rollback is required.
