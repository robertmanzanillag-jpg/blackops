# Clippers YouTube API compliance audit runbook

This runbook prepares evidence for a YouTube API Services compliance audit. It does not assert or imply Google or YouTube approval. Keep public and scheduled publishing fail-closed until written approval is received and recorded through the existing audited-project gate.

## Current API client description

Clippers is an internal, owner-only uploader. There is no public signup and no uploader delegated to unrelated end users. Robert defines and approves batch-specific manifest metadata, target channel, audience designation, privacy setting, and optional future publication time before the worker executes. Those choices remain editable in local configuration and manifests before delivery and in YouTube Studio afterward. The client uses the official YouTube Data API to:

1. obtain OAuth consent for `youtube.upload` and `youtube.readonly`;
2. call `channels.list?mine=true` to verify the exact expected owner-controlled channel ID;
3. call `videos.insert` through the documented resumable-upload protocol; and
4. store the exact response needed for deduplication and outcome reconciliation.

The client does not request a YouTube password, download YouTube audiovisual content, provide a YouTube player, offer public search, create replacement metrics, or sell YouTube API Data.

## Public URLs to verify

Replace `<production-origin>` with the exact HTTPS production origin entered in Google Cloud and the audit form.

- Home/reviewer surface: `<production-origin>/clippers/review-demo`
- Privacy Policy: `<production-origin>/clippers/legal/privacy`
- Terms of Service: `<production-origin>/clippers/legal/terms`

For each URL, capture a dated screenshot and an HTTP 200 response. Confirm that the pages are accessible without login, do not redirect to a local address, and remain reachable from a private browser window.

## Policy evidence checklist

- [ ] Privacy Policy says the client uses YouTube API Services.
- [ ] Privacy Policy identifies the YouTube data accessed, collected, stored, used, and shared.
- [ ] Privacy Policy links the Google Privacy Policy.
- [ ] Privacy Policy links both Google Account third-party connections and Google security permissions for revocation.
- [ ] Privacy Policy explains deletion requested directly through Clippers within 7 calendar days, and deletion after Google revocation or unverifiable authorization within 30 calendar days.
- [ ] Privacy Policy states that deleting data from Clippers does not delete related data held by YouTube and directs the owner to YouTube/Google controls.
- [ ] Privacy Policy provides a monitored contact address for access and deletion requests.
- [ ] Confirm `CLIPPERS_PRIVACY_CONTACT_EMAIL` is set in the deployment environment to a monitored, owner-authorized public privacy contact, and that it is shown on the Privacy Policy page.
- [ ] Preserve dated evidence that the sole owner/operator reviewed and agreed to the Privacy Policy and Terms before YouTube features were enabled; OAuth consent alone is not this acceptance record.
- [ ] Terms link the YouTube Terms of Service and state that use is bound by them.
- [ ] Terms link the YouTube API Services Terms, Developer Policies, Required Minimum Functionality, and Community Guidelines.
- [ ] Terms prohibit unauthorized API Data use, scraping/downloads, credential collection, circumvention, quota sharding, undocumented APIs, impersonation, and unauthorized derived metrics.
- [ ] Reviewer page explains that this is an internal owner-only uploader, names the exact scopes and operations, shows the owner-approved batch manifest with title (up to 100 characters), description, exact channel, visibility/schedule, and links YouTube Studio for later edits and full YouTube features.
- [ ] Reviewer page states that it does not claim Google/YouTube approval.

## Operational evidence checklist

- [ ] Google Cloud project number and project ID match the project named in every credential and submission field.
- [ ] OAuth consent screen name, homepage, Privacy Policy, and Terms URLs exactly match the public pages above.
- [ ] OAuth scopes are limited to `youtube.upload` and `youtube.readonly`.
- [ ] Each channel grant is verified with `channels.list?mine=true`; preserve only redacted evidence showing the expected and returned channel IDs match.
- [ ] Submit a short screen recording showing OAuth consent, exact channel verification, operator review of title/description/audience/privacy, a private test upload, the resulting private video in YouTube Studio, revocation instructions, and the three public pages.
- [ ] Redact client secrets, refresh/access tokens, resumable session URLs, cookies, recovery codes, and unrelated account data from every screenshot and recording.
- [ ] Preserve the uploader tests and reports showing rights, QA, hash, deduplication, channel-match, and uncertain-outcome gates.
- [ ] Confirm the support mailbox shown in the Privacy Policy is monitored before submission.
- [ ] Store a dated owner acceptance artifact for the Privacy Policy and Terms before enabling YouTube features; do not store tokens or secrets in that artifact.
- [ ] Confirm the API project is not used to shard quota and list every production/dev project requested by the form.
- [ ] Do not set `CLIPPERS_YOUTUBE_API_PROJECT_AUDIT_VERIFIED=true` until written audit approval identifies this exact project.

## Suggested audit-form summary

> Clippers is an internal, owner-only uploader for YouTube channels controlled by the project owner. It has no public signup and no unrelated end users. Before the worker executes, the owner defines and approves the batch-specific manifest containing the local media file, title, description, audience designation, target channel, privacy setting, and optional schedule. These choices remain editable before delivery and in YouTube Studio afterward. The client requests `youtube.upload` and `youtube.readonly`, verifies the exact authenticated channel with `channels.list?mine=true`, and uploads through the official resumable `videos.insert` endpoint. It stores only authorization metadata and API response data needed to prevent duplicates and reconcile the result. It does not download YouTube content, expose a player, collect passwords, sell API Data, or provide derived YouTube metrics.

Adapt the summary only when the deployed behavior differs; never describe planned behavior as already deployed.

## Official references

- YouTube API Services Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Compliance guidance: https://developers.google.com/youtube/terms/developer-policies-guide
- YouTube API Services Terms of Service: https://developers.google.com/youtube/terms/api-services-terms-of-service
- Required Minimum Functionality: https://developers.google.com/youtube/terms/required-minimum-functionality
- Audit and quota extension form: https://support.google.com/youtube/contact/yt_api_form
- Google Privacy Policy: https://policies.google.com/privacy
- Google Account third-party connections: https://myaccount.google.com/permissions

## Rollback

Revert this PR to restore the prior public page copy. Do not change OAuth credentials, delete stored media/evidence, or enable the audited-project gate as part of rollback.
