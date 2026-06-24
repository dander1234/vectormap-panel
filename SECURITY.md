# Security policy

## Reporting a vulnerability

If you believe you've found a security issue in this plugin, please report it
privately rather than opening a public issue:

- Use GitHub's **[Report a vulnerability](https://github.com/dander1234/vectormap-panel/security/advisories/new)**
  (Security → Advisories), or
- email the maintainer.

Please include the plugin version, your Grafana version, and steps to reproduce.

## Supported versions

Security fixes are applied to the latest release. There is no long-term support
branch for older versions.

## A note on `npm audit` results

Running `npm audit` on this repository currently reports advisories (mostly in
DOMPurify, OpenTelemetry, js-cookie, js-yaml, and uuid). **These are not present
in the shipped plugin.** Two reasons:

1. **The Grafana SDK is externalized, not bundled.** The webpack build marks
   `@grafana/ui`, `@grafana/runtime`, `@grafana/data`, `react`, `react-dom`,
   `@emotion/*`, `rxjs`, and other host modules as **externals** (see
   [`.config/bundler/externals.ts`](.config/bundler/externals.ts)). They are
   provided by the host Grafana at runtime, so their transitive dependencies
   (where almost all of these advisories live) are **never included in the
   plugin zip** — the versions that actually run are whatever the host Grafana
   ships. The only third-party runtime dependency bundled into the plugin is
   `maplibre-gl`.
2. **The rest are dev-only tooling** (e.g. `jest`), used for building and testing
   and never shipped.

Because of this, `npm audit fix --force` is **not** an appropriate remedy here —
it would downgrade the pinned `@grafana/*` packages (e.g. `@grafana/data` to an
11.x release) to satisfy advisory ranges, breaking compatibility with the target
Grafana version for no real security gain. These advisories clear naturally when
the plugin is updated to a newer Grafana SDK, which brings the patched transitive
dependencies with it.

Dependabot **alerts** and **security updates** are enabled on the repository, so
genuinely actionable dependency fixes are surfaced and proposed automatically.
