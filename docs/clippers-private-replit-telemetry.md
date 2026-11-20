# Clippers telemetry through a private Replit deployment

The dedicated `/api/blackroom-agent/clippers-orchestra` endpoint remains separate from the BlackRoom heartbeat and publication controls. The sender never falls back to `/remote`, follows a redirect, consumes commands, publishes media or changes a resident worker.

The private deployment has two independent authentication boundaries:

- Replit receives a **Production external access token** in `Authorization: Bearer ...`.
- The application receives its **existing BlackRoom device token** in `X-Clippers-Device-Token` and validates it through the existing device-token verifier. This header applies only to the dedicated telemetry route. If it is present but malformed, duplicated or incorrect, a valid application bearer cannot rescue it. If the custom header is absent, the dedicated route retains its original application-bearer compatibility. Legacy BlackRoom routes are unchanged.

The backend does not assume Replit forwards the platform bearer. A valid custom device header works when the edge removes `Authorization`; a platform bearer is never application proof. The sender requires distinct values for the two roles.

[Replit documents Production tokens for published deployments and custom domains, including persistence across republish](https://docs.replit.com/features/deployment-customization/external-access-tokens). No token is put in a URL. The sender accepts only the two already-reviewed Office origins and the fixed dedicated endpoint.

## Credential sources and failure states

The existing canonical owner-only LaunchAgent plist remains the device credential source. The platform token is read separately from a fixed generic-password Keychain entry:

- Service: `com.blackops.clippers-orchestra.replit-production`
- Account: `clippers-telemetry`

There is no environment, file, URL, CLI-value or public-deployment fallback for the platform token. Missing Keychain data returns `held / PLATFORM_ACCESS_TOKEN_REQUIRED` before reading the device plist, building a report or making a request. Inaccessible, unsupported or timed-out OS access returns `PLATFORM_ACCESS_TOKEN_UNAVAILABLE`; malformed values return `PLATFORM_ACCESS_TOKEN_INVALID`.

A fixed native Swift helper using Security.framework disables interaction in its own short-lived process and uses a Security query that disallows authentication UI. The sender requires the canonical owner-only executable at `script/clippers-platform-keychain`, with mode0700; a missing or unsafe helper is held before lookup. Before either Security operation, the native helper accepts stdout only as a FIFO or UNIX-domain socket and rejects terminals, regular files and network sockets. The default reader performs no item creation, unlock, ACL modification or provisioning. The separate explicit `--setup` mode is user-only. A distinct private-stdin mode can store an already-created token only after the operator specifically approves that storage; both modes add at most one new fixed item as described below. Its bounded stdout is a **private pipe in memory**, not terminal output, a log or a new secret file. The process is killed after three seconds. [Apple documents the interaction-disabled behavior](https://developer.apple.com/documentation/security/ksecuseauthenticationuifail): access that requires UI fails instead of prompting. The compatibility API is deprecated; an unsupported bridge fails closed.

User approval and provisioning happen separately. The user authorizes only this specific reviewed native executable when storing the item; there is no global application ACL, interpreter authorization or unlock fallback. This change does not create or read a real platform credential during development, nor authorize changing the deployment's private access. The service/account above are public identifiers, not credential values. Root must arrange the user handoff through the publishing UI and Keychain without putting values in chat, screenshots, command arguments or source files. No broad Keychain ACL fallback is allowed.

## Transport and evidence

The sender always uses private-required transport with both headers. It performs at most one telemetry POST per invocation. Redirects use `manual` handling: any 3xx is held as `PLATFORM_ACCESS_REDIRECT` with the numeric `httpStatus`, without following or reading the body or `Location`. Other errors expose only static reason codes and an available bounded HTTP status; no plaintext exceptions, headers, tokens, report body or response body are logged.

A response still needs the strict ACK-only schema before the local envelope is acknowledged. An HTTP status alone is not a receipt. No retry or alternate-origin request is automatic.

The pre-change failure was diagnosed by root with tokenless GETs to both approved origins and one read-only GET using the existing device bearer: HTTP307 HTML toward `replit.com`, before the app. This is positive evidence of the private shield boundary; it does not establish a schema or database failure. No additional POST was used for that diagnosis.

## Validation and activation boundary

Tests inject synthetic Keychain results. The macOS fixture compiles a separate `CLIPPERS_KEYCHAIN_TEST` binary: its production entry point is compiled out and both Security operations are injected fakes. It checks the actual Swift CFDictionary and CFData/UTF8 result path without querying any Keychain. These tests prove parsing, no-UI query construction, header separation, stripped Authorization, no fallback, redirects, error redaction and unchanged legacy bytes. **Actual Keychain item/ACL access remains unverified until user-approved provisioning and root's single smoke.**

Keep the installed sender inactive until root reviews CI, stages the small endpoint authentication patch and publishes it. Then root may authorize a guarded sender-and-native-helper upgrade, one actual send and, only after a safe ACK, loading the isolated 60-second LaunchAgent. Its existing paths, arguments, schedules and nonsecret plist need no change. Observe two natural ticks and owner-side fresh receipts before claiming persistent connectivity. Missing metrics or media rights remain held; transport health is not publication, creative improvement or a reward.

## Native build boundary

The target Mac already has Xcode's SDK and Swift compiler. Build the production helper from the exact reviewed source into a temporary public-code staging directory, record the resulting binary SHA256 and SDK/compiler versions, and **do not execute it** before user provisioning approval:

```sh
xcrun swiftc -O -framework Security -framework AppKit script/clippers-platform-keychain.swift -o TEMP_REVIEWED_DIRECTORY/clippers-platform-keychain
```

The only executable run during development is separately built with `-D CLIPPERS_KEYCHAIN_TEST`; it cannot call the production lookup entry point. Never install that test binary. Production installation must verify source commit, production binary digest and canonical destination, then set owner 0700. Record the exact native binary the user authorizes. A future source/binary change requires a new review and authorization for that executable, without broadening ACLs. No real credential or compiled binary is committed to the repository.

## Explicit user-only setup

After code/CI review, approved installation of the exact binary and the user's explicit consent, the user alone may run the nonsecret command:

```sh
~/.local/share/blackops/clippers-runtime/script/clippers-platform-keychain --setup
```

This opens a native `NSSecureTextField` with **Guardar** and **Cancelar**. It never reads the clipboard automatically. The user pastes the separately approved Replit Production token; neither an agent nor an automation should fill or inspect this field. The UI shows the fixed reader path and its SHA256; the user must compare it with the reviewed build receipt before pasting. The hash uses an owner 0700 bounded no-follow/nonblocking descriptor with before/after descriptor and path identity checks. It refuses an uninstalled, noncanonical, wrong-owner or non0700 executable, and rechecks the same identity before saving. The daemon does not pass `--setup` and cannot open this form.

Guardar creates a `SecAccess` containing exactly one trusted application: the reviewed reader process itself (the current-application identity, not a mutable path lookup). It then makes a single `SecItemAdd` for the fixed generic-password service/account and the entered value. There is no existing-item lookup, update, delete, overwrite, broad app/interpreter permission or automatic retry. An existing item returns a static notice and stays unchanged. Cancel and closing the window clear the secure field without any Keychain operation. All success/failure notices are static text; no token is written to stdout, stderr, arguments, environment or a file. Creating the Replit external-access token itself remains a separate user-approved action in Replit.

[Apple documents the trusted-application list used by SecAccessCreate](https://developer.apple.com/documentation/security/secaccesscreate(_:_:_:) ); this implementation supplies an explicit one-element list. It does not use a nil or wildcard ACL. The setup mode has only been compiled and its add-only core tested with injected synthetic access/query functions. It has **not** been opened, filled or used against Keychain during development; actual UI/ACL behavior awaits the approved user handoff. No broad ACL fallback is allowed if that smoke fails.


## Specifically approved storage over private stdin

If the operator explicitly authorizes storing the **existing** Production token and native paste is unavailable, the reviewed canonical helper also supports `--store-approved-from-stdin`. That approval must identify this token, fixed Keychain item, and exact reviewed helper. It is not authority to create, rotate, broaden, read, replace or delete a Replit credential. Creation of the token in Replit remains a separate user-approved step. Never ask for the value in chat.

The purpose-built mode accepts raw token bytes only on stdin, never in argv, environment, a URL, a regular file, a terminal or a network socket. Stdin must be an owner-controlled anonymous pipe, an owner-only named FIFO, or a UNIX-domain socket with a peer of the same effective user. For a named FIFO, the operator creates an owner 0700 parent and an owner 0600 FIFO. The bytes stay in kernel IPC memory; no regular secret file is created. Close the writer after sending the exact bytes, without adding a newline. EOF must arrive within the fixed ten-second monotonic input deadline. Reads are nonblocking and capped at 8192 bytes plus one overflow-detection byte. Invalid UTF8, incomplete input, whitespace, a Bearer prefix, unsafe descriptors, overflow and timeout never reach Keychain.

Before consuming stdin, the mode verifies the canonical installed reader and pins its SHA for the later identity recheck. It also disables Security interaction before the add; a locked or UI-requiring Keychain fails closed without prompting, unlocking or retrying. Manual setup retains its separately approved interactive behavior.

This mode reuses the same strict token grammar and `createPlatformCredential` function as manual setup: fixed service/account, canonical owner 0700 reader, pinned/rechecked binary identity, self-only one-application ACL and a single add-only `SecItemAdd`. It does not look up an existing entry. Duplicate items remain untouched. The default scheduled reader still disables interaction, checks private stdout and performs only its fixed lookup; it never invokes provisioning or opens the setup menu.

The only stdout payload of approved storage is JSON with one whitelisted status enum: `stored`, `already_exists`, `unsafe_input`, `input_timeout`, `empty`, `too_short`, `too_large`, `invalid_characters`, `invalid_encoding`, `invalid`, `unsafe_reader`, or `unavailable`. No input value, exception text or attributes are included. The mode does not automatically read or write either clipboard and never invokes UI automation. Explicit `--setup` additionally supplies a standard Edición/Pegar menu with Cmd+V and static validation notices; this menu is absent from normal execution.

Validation uses the separately compiled synthetic entry point, fake Security callbacks and synthetic local descriptors. The production AppKit/Security paths are compiled only, not executed. Developers do not read a real clipboard, Keychain item or token during this work. Root performs any actual storage only under the operator's specific, still-valid authorization and verifies a safe status before the subsequent, separately controlled connectivity smoke.

Apple documents the nonblocking [fcntl flags](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html) and bounded [poll timeout](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/poll.2.html). The input deadline is not extended by partial bytes, interrupted reads or retries.
