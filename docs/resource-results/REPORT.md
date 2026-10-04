# Resource-efficiency validation

## Environment and provenance

- Upstream: `miuuyy/codex-chatgpt-web`, v6.1.4, commit `b6ca2d3f91f8a2ba140b522fe3b3c50b4ebffa2d`.
- Linux x64, Node v24.19.0; Bun 1.4.0 from the official `@oven/bun-linux-x64` registry package.
- Dependency installation used `--ignore-scripts`. No upstream installer, account login, persistent connector grant, or Codex setup was run.
- The full original source is included; no thin replacement application was substituted.

## Verified

- 14 new resource/workflow regression tests plus 119 existing browser-host/suspension tests: **133 passed**. Electron is replaced by an empty module only for these unit tests; they do not exercise a real renderer.
- 7 existing Bun tests for Windows/Darwin Responses streaming, stall handling, helper pipe failure, and browser cancellation: **7 passed**.
- Root TypeScript `tsc --noEmit`: passed.
- Bun CLI bundle: 75 modules compiled. Browser-helper Node/CJS bundle: 34 modules compiled.
- Independent code review found timer-originated overflow and tiny-frame queue issues during development; both were fixed and regression-tested.

## Not verified

The full Bun suite did not establish a clean pass in this environment. Broker tests require Unix-domain sockets, and an independent Node socket probe returns `EPERM: operation not permitted`. Initial test setup also used a temporary Bun executable rejected by upstream durable-runtime checks; subsequent checks used a non-temporary runtime. These attempts are not counted as successful tests. Full-suite success, Electron startup, platform installers, live ChatGPT response correctness, and real browser RAM/CPU require verification on a supported workstation. No account-bound test was run.

## Microbenchmark results

`benchmark.json` contains all 18 isolated runs: three trials each for three workloads and two versions. Baseline source snapshots are copied verbatim from the pinned upstream commit. Run `node scripts/resource/benchmark.mjs` to reproduce from either a checkout or the ZIP. Both versions use the same Node process model and workload. Timing is synthetic, not end-to-end throughput.

Medians from this run:

| Workload | Upstream elapsed | Efficient elapsed | Upstream CPU | Efficient CPU | Upstream peak RSS | Efficient peak RSS |
|---|---:|---:|---:|---:|---:|---:|
| 1M FIFO scalar events | 188.97 ms | 126.11 ms | 214.17 ms | 147.78 ms | 71,888 KiB | 76,132 KiB |
| 1M 128-character delta events; new version includes production byte estimator | 267.97 ms | 218.91 ms | 316.84 ms | 286.08 ms | 128,932 KiB | 135,384 KiB |
| 10k writes to a completely stalled pipe | 141.36 ms | 12.27 ms | 213.02 ms | 16.72 ms | 257,288 KiB | 77,964 KiB |

The normal FIFO results show lower CPU/wall time here but **slightly higher peak RSS**, not a blanket RAM improvement. Garbage collection and allocation timing make heap deltas noisy. These results do not predict Bun/Electron/live-site behavior.

The pipe comparison intentionally exercises overload: upstream accepts all 10,000 writes and accumulates 163,898,890 bytes in the Writable. The changed version accepts 511 writes before reporting one explicit budget failure; only 16,387 bytes enter the blocked Writable, while pending frames remain within its configured budget until failure clears them. This is bounded failure under backpressure, **not a faster equivalent completion of 10,000 writes**. Successful ordered delivery after `drain` is covered separately by tests.

The low browser preset is policy-tested at two tabs/five minutes. No process-RAM savings from that preset have been measured. No active response polling, model verification, approval logic, transport selection, or account limits were weakened to obtain these numbers.

## GitHub build preparation

A manual Windows x64 artifact-only workflow was added after the local source preview. Automatic upstream push/tag workflows are inactive templates; version and packaging-contract checks were updated to their preserved paths. Repository contents permission is read-only, checkout does not persist credentials, there is no release publish step, and uploaded build artifacts expire after seven days. A GitHub workflow run is still required to validate Windows packaging.

## Requested five-tab preset update

The new `app:efficient` source launcher explicitly applies `CODEX_CHATGPT_WEB_MAX_TABS=5` with `CODEX_CHATGPT_WEB_RESOURCE_PROFILE=low` only in the child process. The low profile's five-minute idle cleanup remains; byte/frame limits, approval handling, and the hard ceiling of five tabs are unchanged. The generic low profile still defaults to two without this explicit override.

After the update, all **16 offline resource/workflow tests passed**, including both new five-tab tests. They check environment precedence, no parent-environment mutation, idle-TTL preservation, and rejection of a sixth active owner. Previously recorded TypeScript/Bun/browser-host results above refer to the preceding source revision; no fresh full build or live Windows/account test is claimed for this update. Five active pages can consume more RAM and CPU than two; no five-tab performance savings are promised.
