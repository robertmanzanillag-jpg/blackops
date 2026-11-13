---
name: PR15 server-only deploy
description: How to build and deploy server-only changes without hanging Vite build
---
The full `npm run build` hangs in Vite for this project. Server-only builds use `node script/build-server.js` (ESM, esbuild only, preserves dist/public). deployConfig must set build: null OR build: ["node","script/build-server.js"] — NOT ["npm","run","build"]. Confirmed: .replit now shows the correct build command after deployConfig call.

**Why:** Vite hangs during autoscale build phase, causing Publish to fail and rollback to old container.

**How to apply:** For any server-only change, run `node script/build-server.js` locally, then deployConfig with the server-only build. PR #15 routing fix (buildDirectRadioYoutubeCommand line 1081 before developerAutopilotHandoff line 1132) confirmed live in production at June 22 9:57 AM UTC.
