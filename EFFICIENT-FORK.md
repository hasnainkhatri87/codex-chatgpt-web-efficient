# Efficient fork: source preview

This is a working source modification of **codex-chatgpt-web 6.1.4**, based on upstream commit `b6ca2d3f91f8a2ba140b522fe3b3c50b4ebffa2d`. It retains the original application and MIT license. It is not an official OpenAI product, a signed installer, or a separately authenticated service.

## What changed

1. **Bounded adapter backlog.** The Responses event queue now has both the original 10,000-event ceiling and a 16 MiB estimated retained-payload ceiling. It clears consumed references, uses amortized constant-time FIFO reads, and handles `undefined` values correctly. Consumer cancellation releases unread references.
2. **Safe overload handling.** A callback boundary catches overflow even when an event originates from an adapter timer. It emits a bounded terminal error, signals upstream cancellation, and ignores later success. If an unread backlog cannot fit the terminal error, it is replaced by that error. No accepted ChatGPT prompt is automatically resent.
3. **Drain-aware helper output.** The browser-helper writer respects Node stream backpressure, resumes in order on `drain`, and limits pending output to 8 MiB of UTF-8 frames plus a 10,000-pending-frame ceiling. A stuck parent fails the helper instead of allowing indefinite buffering. Closing is abort/discard, not a flush; the existing parent rejects an interrupted turn.
4. **Low-resource browser preset.** The user launch preset allows five tabs with five-minute completed-tab retention. The generic low profile still defaults to two tabs; the preset explicitly overrides that limit to five, with strictly validated controls. Active turns and pending approvals are not shortened by the idle TTL. Original five-tab account-safety ceiling cannot be raised.
5. **Offline regression and benchmark tools.** Reproducible comparison sources are included, so the benchmark also works from the ZIP without Git history.

Existing features preserved include the Electron launcher, model/effort verification, native Responses bridge, conversation ownership, manual mode, cancellation, and approval handling. Existing Chromium throttling, tab reuse, idle blank page, and five-tab cap are upstream features, not new additions. No authentication or approval permissions were expanded.

## Run from source

Use a trusted workstation. Install the official **Bun 1.4.0** runtime and use the normal upstream launcher requirements. This project was built with that exact runtime. From the extracted directory:

```sh
bun install --frozen-lockfile
bun run app:efficient
```

On PowerShell:

```powershell
bun install --frozen-lockfile
bun run app:efficient
```

On Windows, you can also run `Start-Efficient-Windows.cmd` after installing dependencies. This source launcher is not a built `.exe`.

`app:efficient` sets `CODEX_CHATGPT_WEB_RESOURCE_PROFILE=low` and `CODEX_CHATGPT_WEB_MAX_TABS=5` for its child process only. This keeps the low profile's five-minute idle cleanup while allowing up to five simultaneous tabs. It does not alter system-wide environment settings. An explicitly supplied valid `CODEX_CHATGPT_WEB_IDLE_TAB_SECONDS` is preserved.

The upstream `app` command prepares its launcher dependencies and browser/runtime. These commands do not constitute a prebuilt installer. Follow the normal launcher sign-in/setup prompts yourself; do not share credentials or browser-profile files. No live account or Codex installation was configured during development of this fork.

### Resource controls

Set these environment variables before starting the launcher:

| Variable | Balanced default | Low preset | Allowed override |
|---|---:|---:|---:|
| `CODEX_CHATGPT_WEB_RESOURCE_PROFILE` | `balanced` | `low` | `balanced` or `low` |
| `CODEX_CHATGPT_WEB_MAX_TABS` | 5 | 2 | integer 1–5 |
| `CODEX_CHATGPT_WEB_IDLE_TAB_SECONDS` | 1800 | 300 | integer 30–1800 |

Equivalent explicit five-tab command: `CODEX_CHATGPT_WEB_RESOURCE_PROFILE=low CODEX_CHATGPT_WEB_MAX_TABS=5 bun run app`.

The user preset permits five tabs; a sixth active tab is rejected explicitly, rather than queued or silently routed elsewhere. Five active ChatGPT tabs can use substantially more RAM and CPU than the generic two-tab low preset. The retained-tab cleanup and bounded queues remain enabled. The generic `RESOURCE_PROFILE=low` without `MAX_TABS=5` still has a two-tab cap. These controls do not shrink the ChatGPT page itself. An idle retained conversation may expire sooner; an operation requiring that exact retained conversation can fail and require a fresh task/chat. Lower retention can increase context retransmission and setup latency. The five-second existing lease sweep means reclamation normally occurs within one sweep after TTL expiry, excluding system suspension. Active turn watchdogs and approval behavior are unchanged.

The 16 MiB event and 8 MiB pipe budgets are **payload accounting**, not total process-RAM caps. Object overhead, the browser, tokenizers, input context, and downstream response construction consume additional memory. Very large non-streaming responses and stalled consumers can now receive an explicit error. Prefer streaming when appropriate. There is no promised percentage reduction in live ChatGPT RAM or CPU.

## Verify and benchmark

Offline resource tests and benchmarks require Node 24 or later (TypeScript stripping):

```sh
npm run test:resources
npm run bench:resources
```

Root checks with the normal dependencies installed:

```sh
bun run typecheck
bun test tests/process-line-writer.test.ts tests/bridge-platform.test.ts tests/bridge-stall-timeout.test.ts tests/browser-cancellation.test.ts
bun test ./tests
```

The standard upstream full test and packaging workflows remain in `package.json`. A full release still needs a normal desktop/CI environment, the launcher dependencies, platform packaging, and user-authorized account-bound smoke tests.

See [measured results and limitations](docs/resource-results/REPORT.md) and raw JSON. This is a source preview, not a fully validated release.

## Manual GitHub Windows build

The fork's **Build efficient Windows x64 preview** Actions workflow runs only when explicitly dispatched. It installs locked dependencies, runs resource regressions and upstream verification, packages an unsigned x64 installer, smoke-tests it, and uploads a seven-day build artifact with SHA-256 checksums. It does not publish a GitHub Release. The upstream automatic multi-platform CI and tag-release workflows are preserved as inactive templates under `.github/upstream-workflows`.

A private repository may consume your GitHub Actions allowance; no paid upgrade or spending limit is configured. A successful workflow proves build/test results, not live ChatGPT-account compatibility or Windows security signing. Treat Windows warnings about an unsigned binary seriously; do not bypass them automatically.

## Five-tab launch verification

`npm run test:resources` tests explicit five-tab precedence over the low profile, keeps the five-minute idle TTL, rejects a sixth active tab without touching pending approvals, and verifies the source launch wrapper forwards the preset without modifying the parent environment. No live five-tab RAM/CPU measurement or Windows execution was performed.

## Repository build trigger

This repository also supports a Windows x64 artifact build on main when the commit message explicitly includes `[build windows]`. Other pushes do not run the build job. Manual workflow dispatch remains available. Builds are unsigned previews; no releases are published.
