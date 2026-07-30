# Security Policy

## Supported version

Security fixes are applied to the latest version on the `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting feature:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Choose **Report a vulnerability**.

Include the affected behavior, reproduction steps, expected impact, and any
suggested mitigation. Avoid including real user data or credentials.

## Current security boundary

Mermaid Workbench currently runs only on loopback interfaces and stores one
local user's library in SQLite. The current server is not designed for direct
public-internet exposure.

A hosted release must add authentication, per-user authorization, and isolated
workspaces before the bind address is changed or the API is exposed publicly.
