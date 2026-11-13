---
name: Nix pip install fix
description: How to fix pip --target installs on Replit Nix where --isolated causes "Can not combine --user and --target"
---

# Nix pip --isolated Bug

## The Rule
Never use `--isolated` when calling `python3 -m pip install --target <dir>` on Replit Nix. Instead set `PIP_CONFIG_FILE=/dev/null` in the env.

## Why
On Replit Nix, the Python wrapper script (`site.py`) intercepts pip before `--isolated` can suppress it. This causes pip to see both `--user` (injected by the wrapper) and `--target` simultaneously, raising: `ERROR: Can not combine '--user' and '--target'`. Setting `PIP_CONFIG_FILE=/dev/null` prevents the wrapper from injecting user-site settings.

## How to Apply
In any function that calls pip in Node.js/TypeScript:
```typescript
env: {
  ...process.env,
  PIP_USER: "false",
  PYTHONNOUSERSITE: "1",
  PIP_CONFIG_FILE: "/dev/null",
}
```
And the pip args array: `["install", "--target", dir, "package"]` — no `--isolated`.

This applies in runtime server code AND in build scripts (script/build.ts).
