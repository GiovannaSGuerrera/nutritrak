# Supply Chain Risk Report — `NutriCare`

**Scanned:** `.`  
**Commit:** `987d6926f9f3`  
**Manifests read:** `package.json`  
**Scanned at:** 2026-11-24T03:06:50+00:00  
**Direct dependencies:** 1 (npm 1)

## Summary

- **No known advisory affects any of the 1 direct dependencies** — but 1 was not checked at a project-resolved version (latest-release fallback or go.mod minimum; see Method and caveats).
- Transitive dependencies were **not examined**: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod).
- 0 of 1 dependencies carry at least one finding, 0 of which reach production.
- Weakest coverage: **Known advisories**, established for 1 of 1; the Coverage section lists every criterion.

## Production dependencies

Every direct dependency is declared as a development dependency, so none
of them ships in the built artifact.

## Findings

No dependency was flagged on these criteria.

## Upstream repository and CI hygiene — OpenSSF Scorecard

These criteria describe each dependency's own repository, not the audited
project. Remediation, where any exists, is upstream.

No dependency was flagged on these criteria.

## Transitive advisories

Not examined: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod). Commit a lockfile to close this gap.

## Informational

Measured, not flagged.

- **CI token permissions**: median 0/10 across 1 scored dependencies; 1 score below 6. Not flagged — this measures whether CI workflows declare least-privilege tokens, which tracks project maturity rather than the likelihood of malicious code being published.
- **Changes reviewed by a second person**: median 4/10 across 1 scored dependencies; 1 score below 6. Not flagged — this measures the share of recent commits reviewed by a second person, which is low for most small single-maintainer projects and largely restates publisher concentration.
- **Publish provenance**: 0 of 1 publish with build provenance.
  Without: `prettier`
- **Security policy published**: 1 of 1 publish a security policy.
- **Download volume**: established for 1 of 1; median 196,787,084/week. Lowest: `prettier` (196,787,084/wk).

## Coverage

What was and was not measured, per criterion.

| Criterion | Tier | Assessed | Flagged | Not assessable |
|---|---|---|---|---|
| Known advisories | A | 1/1 | 0 | 0 |
| Deprecated or yanked | A | 1/1 | 0 | 0 |
| Repository archived | A | 1/1 | 0 | 0 |
| Maintenance activity | A | 1/1 | 0 | 0 |
| Publisher concentration | B | 1/1 | 0 | 0 |
| Install-time script execution | B | 1/1 | 0 | 0 |
| Dangerous CI workflow | scorecard | 1/1 | 0 | 0 |
| CI token permissions | scorecard | 1/1 | 0 | 0 |
| Checked-in binaries | scorecard | 1/1 | 0 | 0 |
| Changes reviewed by a second person | scorecard | 1/1 | 0 | 0 |
| Publish provenance | info | 1/1 | 0 | 0 |
| Security policy published | info | 1/1 | 0 | 0 |
| Download volume | info | 1/1 | 0 | 0 |

## Not assessable

Every criterion was assessable for every dependency.

## Method and caveats

- cache directory ownership was not verified: os.getuid is POSIX-only, so a cache at C:\Users\giuse\AppData\Local\Temp\supply-chain-risk-auditor-cache owned by another user would not be detected on this platform. Keep the cache under your own user profile, or pass --cache with a private path.
- gh is not authenticated. GitHub allows 60 requests/hour unauthenticated against 5000 authenticated, so repository signals may be unassessable.
- pnpm-lock.yaml is present but not read: direct-dependency versions fall back to manifest pins or the latest release, and its transitive tree was not examined.
- 1 dependencies are specified as a version range with no lockfile, so their advisories were matched against the current latest release rather than against what this project installs — commit a lockfile for an exact answer: prettier
- Optional tooling detected: npm. Not installed, so not used: bundler-audit, cargo-audit, osv-scanner, pip-audit.
- Direct dependencies only. Advisories attach to the package that ships the affected code, so an umbrella package can look clean while its components are not — rails 5.0.0 reports 0 advisories where actionpack 5.0.0 reports 10. Transitive dependencies were not examined: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod).
- HTTP sources: 6 fetched, 1 served from cache (oldest 0.0h old), 0 refetched as stale, 0 unavailable offline, 0 errors.
