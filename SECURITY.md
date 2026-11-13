# Security Policy

## Reporting a vulnerability

Please report security issues **privately** through GitHub's private vulnerability reporting:

1. Open the **Security** tab of this repository.
2. Click **Report a vulnerability** and describe the issue, the affected files or endpoints, and the steps to reproduce.

Do **not** open a public issue, pull request or discussion for a vulnerability, and do not include
secrets, tokens or personal data in a report. You will receive an acknowledgement as soon as the
report is triaged; fixes are made through a reviewed pull request and the release gate before any
deployment.

## Scope

- The application source in this repository (server, client, shared code and scripts).
- The GitHub Actions workflows in `.github/workflows/`.

Out of scope: third-party services the app integrates with (report those to the vendor), and
findings that require access to the owner's accounts or devices.

## Handling of secrets

No credentials are stored in this repository. Runtime secrets live in the hosting provider's secret
store and in GitHub Actions secrets, and are only available to scheduled or manually dispatched jobs
of this repository, never to pull requests or forks. If you believe a secret was exposed, report it
privately as described above so it can be rotated.
