# Shared OpenAI credit grant (Office + factory)

One durable ledger funds both consumers (`office`, `factory`). It holds a single
verified grant with an expiry: there is no monthly reset, refill or top-up. A new
billing period (for example the ChatGPT Pro API credit renewal) gets a **new
scope**, never an edited grant.

`script/shared-credit-grant.ts` is the operator tool. It never loads `.env` files,
never prints connection strings or keys, and fails with static codes only.

```bash
# Read-only balance of an existing ledger
node --import tsx script/shared-credit-grant.ts status --scope=<scope>

# Read-only: print the worker config for the EXISTING grant
node --import tsx script/shared-credit-grant.ts config --scope=<scope> \
  --model=gpt-6.1-sol --input-usd-per-million=2 --output-usd-per-million=10 \
  --pricing-valid-until=<ISO>

# New billing period: dry run first, then --apply (refuses if the scope exists)
node --import tsx script/shared-credit-grant.ts new --scope=<scope> --id=<grant-id> \
  --usd=<verified balance> --expires=<cycle end ISO> --evidence=<billing-ui-note> \
  --model=gpt-6.1-sol --input-usd-per-million=2 --output-usd-per-million=10 \
  --pricing-valid-until=<ISO> [--apply]
```

Run it with `DATABASE_URL` set to the production database (for example
`DATABASE_URL="$PROD_DB_URL" node --import tsx ...`). The line starting with
`CONFIG_JSON=` is the value for the GitHub secret `OPENAI_SHARED_CREDIT_CONFIG_JSON`
used by both `office-worker-cloud.yml` and `software-factory-cloud.yml`. It contains
no credentials, but treat it as private configuration.

`--usd` must be the balance verified in the OpenAI billing page **after** all
earlier charges; the tool does not read provider billing. Pricing must be the
current per-token price of the configured model: the worker refuses calls when the
model differs or the pricing has expired. A ledger with an `unknown` reservation
blocks all new admissions until it is reconciled; `status` reports `uncertain`.
