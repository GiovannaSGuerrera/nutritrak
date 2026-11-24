# Supply Chain Risk Report — `api`

**Scanned:** `apps\api`  
**Manifests read:** `package.json`  
**Scanned at:** 2026-11-24T11:41:28+00:00  
**Direct dependencies:** 4 (npm 4)

## Summary

- **No known advisory affects any of the 4 direct dependencies** — but 4 of them were not checked at a project-resolved version (latest-release fallback or go.mod minimum; see Method and caveats).
- Transitive dependencies were **not examined**: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod).
- 3 of 4 dependencies carry at least one finding, 1 of which reaches production.
- Weakest coverage: **Known advisories**, established for 4 of 4; the Coverage section lists every criterion.

## Production dependencies

1 dependency is declared as runtime dependencies and ship in the built artifact. Advisory status is given for every one, clean or not.

| Dependency | Version | Advisories | Other findings |
|---|---|---|---|
| `pg` | 8.23.1 (latest, not the project's pin) | none known | Publisher concentration |

## Findings

### Reaches production

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `pg` | 8.23.1 (latest, not the project's pin) | 105,811,731/wk | single human publisher (brianc) of 1 listed |

### Build-time only

Declared as development dependencies. A compromise here reaches build and CI hosts rather than users of the shipped artifact.

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `@types/node` | 26.6.6 (latest, not the project's pin) | 671,294,455/wk | single human publisher (types) of 1 listed |
| `@types/pg` | 8.23.1 (latest, not the project's pin) | 104,362,812/wk | single human publisher (types) of 1 listed |

## Upstream repository and CI hygiene — OpenSSF Scorecard

These criteria describe each dependency's own repository, not the audited
project. Remediation, where any exists, is upstream.

No dependency was flagged on these criteria.

## Transitive advisories

Not examined: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod). Commit a lockfile to close this gap.

## Informational

Measured, not flagged.

- **CI token permissions**: median 0/10 across 4 scored dependencies; 3 score below 6. Not flagged — this measures whether CI workflows declare least-privilege tokens, which tracks project maturity rather than the likelihood of malicious code being published.
- **Changes reviewed by a second person**: median 8/10 across 4 scored dependencies; 0 score below 6. Not flagged — this measures the share of recent commits reviewed by a second person, which is low for most small single-maintainer projects and largely restates publisher concentration.
- **Publish provenance**: 0 of 4 publish with build provenance.
  Without: `@types/node`, `@types/pg`, `pg`, `typescript`
- **Security policy published**: 3 of 4 publish a security policy.
  Without: `pg`
- **Download volume**: established for 4 of 4; median 449,380,935/week. Lowest: `@types/pg` (104,362,812/wk), `pg` (105,811,731/wk), `typescript` (449,380,935/wk).

## Coverage

What was and was not measured, per criterion.

| Criterion | Tier | Assessed | Flagged | Not assessable |
|---|---|---|---|---|
| Known advisories | A | 4/4 | 0 | 0 |
| Deprecated or yanked | A | 4/4 | 0 | 0 |
| Repository archived | A | 4/4 | 0 | 0 |
| Maintenance activity | A | 4/4 | 0 | 0 |
| Publisher concentration | B | 4/4 | 3 | 0 |
| Install-time script execution | B | 4/4 | 0 | 0 |
| Dangerous CI workflow | scorecard | 4/4 | 0 | 0 |
| CI token permissions | scorecard | 4/4 | 0 | 0 |
| Checked-in binaries | scorecard | 4/4 | 0 | 0 |
| Changes reviewed by a second person | scorecard | 4/4 | 0 | 0 |
| Publish provenance | info | 4/4 | 0 | 0 |
| Security policy published | info | 4/4 | 0 | 0 |
| Download volume | info | 4/4 | 0 | 0 |

## Not assessable

Every criterion was assessable for every dependency.

## Method and caveats

- cache directory ownership was not verified: os.getuid is POSIX-only, so a cache at C:\Users\giuse\AppData\Local\Temp\supply-chain-risk-auditor-cache owned by another user would not be detected on this platform. Keep the cache under your own user profile, or pass --cache with a private path.
- gh is not authenticated. GitHub allows 60 requests/hour unauthenticated against 5000 authenticated, so repository signals may be unassessable.
- 4 dependencies are specified as a version range with no lockfile, so their advisories were matched against the current latest release rather than against what this project installs — commit a lockfile for an exact answer: @types/node, @types/pg, pg, typescript
- Repository-level criteria (archived, maintenance activity, security policy, and the Scorecard checks) describe the source repository rather than the package. 4 dependencies resolve to 3 distinct repositories, so one repository can appear as several findings. Shared: github.com/DefinitelyTyped/DefinitelyTyped
- Optional tooling detected: npm. Not installed, so not used: bundler-audit, cargo-audit, osv-scanner, pip-audit.
- Direct dependencies only. Advisories attach to the package that ships the affected code, so an umbrella package can look clean while its components are not — rails 5.0.0 reports 0 advisories where actionpack 5.0.0 reports 10. Transitive dependencies were not examined: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod).
- HTTP sources: 17 fetched, 7 served from cache (oldest 0.0h old), 0 refetched as stale, 0 unavailable offline, 0 errors.
