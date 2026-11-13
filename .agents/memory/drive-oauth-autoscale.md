---
name: Drive OAuth + Autoscale session issue
description: Google Drive OAuth tokens stored in MemoryStore are lost between autoscale container instances
---
In autoscale deployment, each request may hit a different container. Express sessions use MemoryStore (logged warning in prod). Drive OAuth token saved in session is lost if approval request hits a different container than the one that did the OAuth callback.

**Why:** The `radio_edit.youtube_to_drive` action executor fails in ~1.5s (too fast for yt-dlp) because Drive folder lookup/creation throws before download starts. The error surfaces as `blackRoomLinkError` in the SSE stream (client-visible) not as a server console.error — invisible in deployment logs.

**How to apply:** Execution errors from pending action approval go via `directPendingExecution.error` → SSE `blackRoomLinkError` (line 1071 assistant.ts), not to stderr. To debug: check frontend console, not deployment logs.
