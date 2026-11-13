# Clippers TikTok Go-Live

Status: ready except TikTok secrets, public deploy verification, demo video, and final TikTok review submission.

## What Is Already Prepared

- TikTok app: `sportclipsr`.
- TikTok products: Login Kit and Content Posting API.
- TikTok scopes: `user.info.basic`, `video.upload`, `video.publish`.
- TikTok redirect URI: `https://robplanner.replit.app/api/clippers/oauth/tiktok/callback`.
- App icon: `client/public/sportclipsr-tiktok-icon.png` is 1024 x 1024 and has been uploaded in TikTok.
- Current TikTok verification file: `client/public/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt`.
- Previous TikTok verification file remains served for compatibility: `client/public/tiktokzjohuZmzXSsUwXRmI6fqM3JDKo7jsLUN.txt`.
- Public policy routes:
  - `https://robplanner.replit.app/clippers/legal/privacy`
  - `https://robplanner.replit.app/clippers/legal/terms`
- Public demo route:
  - `https://robplanner.replit.app/clippers/review-demo`
- Local `PUBLIC_BASE_URL` saved in `CEO_ASSISTANT_ENV`:
  - `PUBLIC_BASE_URL=https://robplanner.replit.app`

## The Only Secrets To Paste

Paste these in Clippers > Credential & Account Setup > Credential batch, or into the deployment secret manager.

```env
PUBLIC_BASE_URL=https://robplanner.replit.app
TIKTOK_CLIENT_KEY=PASTE_TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET=PASTE_TIKTOK_CLIENT_SECRET
```

`CLIPPERS_TOKEN_ENCRYPTION_KEY` is already generated locally in ignored file `CEO_ASSISTANT_ENV`. Copy that same value only into the deployment secret manager. Do not paste it in chat, Markdown docs, evidence notes, screenshots, or TikTok review comments.

## Deploy Checks

After deploy, run:

```bash
npm run clippers:tiktok-preflight -- https://robplanner.replit.app
```

All checks must pass before clicking Verify in TikTok.

Required public URLs:

- `https://robplanner.replit.app/tiktokxXFfBZAFcOIGUKNMLUhs8E9M66NBKXCP.txt`
- `https://robplanner.replit.app/clippers/legal/privacy`
- `https://robplanner.replit.app/clippers/legal/terms`
- `https://robplanner.replit.app/clippers/review-demo`
- `https://robplanner.replit.app/api/clippers/oauth/tiktok/callback`

## TikTok Portal Final Steps

1. Open TikTok Developers > `sportclipsr`.
2. Click URL properties.
3. Verify `https://robplanner.replit.app/` using the current uploaded verification file.
4. Confirm Terms, Privacy, and Web URL no longer show "This URL is not verified."
5. Upload the demo video required by TikTok.
6. Save.
7. Submit for review only after the domain checks and demo video are complete.

## Demo Video Shot List

Record a short screen capture showing:

1. `https://robplanner.replit.app/clippers` command center.
2. TikTok credential readiness without exposing secret values.
3. OAuth callback/redirect URI shown as `https://robplanner.replit.app/api/clippers/oauth/tiktok/callback`.
4. Rights gate blocking unauthorized third-party footage.
5. Approval-required publishing workflow.
6. Review demo page: `https://robplanner.replit.app/clippers/review-demo`.

Keep secrets, tokens, client secret, recovery codes, and personal account security screens out of the video.

## Current TikTok Blockers

- Domain verification is pending until `robplanner.replit.app` serves the verification file publicly.
- Demo video is required.
- Final review submission requires a human click after confirming everything above.
