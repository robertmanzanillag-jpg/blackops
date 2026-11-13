# Clippers marketplace intake

`script/clippers-marketplace-intake.mjs` converts local marketplace snapshots into the campaign catalog consumed by the Clippers CEO. It never logs in, scrapes authenticated pages, calls a paid API, or publishes. Live acquisition is a separate fail-closed stage, `clippers:marketplace-refresh`, which invokes only explicitly authorized local adapters and then hands their validated snapshots to intake.

The separation is deliberate: adapters own authenticated session access, while intake remains the authority for freshness, rights, destination-account compatibility, expiry, and campaign deduplication. A provider failure cannot relax any of those gates.

Place JSON snapshots in `clippers_workspace/research/marketplace-snapshots/`. Each snapshot has this shape:

```json
{
  "marketplace": "content_rewards",
  "observedAt": "2026-08-05T11:00:00Z",
  "campaigns": [
    {
      "id": "campaign-id",
      "title": "Campaign title",
      "creator": "Creator",
      "active": true,
      "joined": true,
      "expiresAt": "2026-08-12T12:00:00Z",
      "payoutCpm": 2,
      "minViewsPerPost": 1000,
      "sourceUrl": "https://authorized.example/source",
      "compatibleAccounts": ["streamersclipusa"],
      "rightsEvidencePath": "evidence-drop/marketplaces/campaign-id.md",
      "evidenceVerified": true,
      "rightsExpiresAt": "2026-08-12T12:00:00Z",
      "requiredHashtags": ["#paidpartner"]
    }
  ]
}
```

The evidence file must be a regular file inside `clippers_workspace`, name the campaign, marketplace, authorized source URL, and describe permission/license/publishing rights. A boolean in the snapshot is never sufficient by itself. `rightsExpiresAt` defaults to the campaign expiry when the marketplace brief uses one deadline for both; an explicit rights deadline is preserved and enforced when supplied.

Run:

```sh
npm run clippers:marketplace-intake
```

Outputs:

- `research/paid-streamer-campaigns.json`: only fresh, active, joined, rights-verified, unexpired campaigns compatible with the configured account.
- `reports/marketplace-supply-report.json`: machine-readable accepted/rejected inventory with blockers.
- `reports/marketplace-supply-report.md`: operator-readable supply report.

The default snapshot age limit is 48 hours. Override it with `CLIPPERS_MARKETPLACE_SNAPSHOT_MAX_AGE_HOURS`. Set the destination with `CLIPPERS_STREAMER_ACCOUNT_HANDLE`; it defaults to `streamersclipusa`.
