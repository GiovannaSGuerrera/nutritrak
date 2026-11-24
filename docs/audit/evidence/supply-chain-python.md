# Supply Chain Risk Report — `api-python`

**Scanned:** `apps\api-python`  
**Manifests read:** `requirements.txt`  
**Scanned at:** 2026-11-24T03:07:06+00:00  
**Direct dependencies:** 9 (PyPI 9)

## Summary

- **1 of 9 dependencies have known advisories.** See the findings below.
- Transitive dependencies were **not examined**: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod).
- 1 of 9 dependencies carry at least one finding, 1 of which reaches production.
- Weakest coverage: **Install-time script execution**, established for 0 of 9; the Coverage section lists every criterion.

## Production dependencies

9 dependencies are declared as runtime dependencies and ship in the built artifact. Advisory status is given for every one, clean or not.

| Dependency | Version | Advisories | Other findings |
|---|---|---|---|
| `alembic` | 1.15.2 | none known | — |
| `argon2-cffi` | 23.1.0 | none known | — |
| `fastapi` | 0.115.12 | none known | — |
| `httpx` | 0.28.1 | none known | — |
| `psycopg` | 3.2.6 | none known | — |
| `pydantic` | 2.11.3 | none known | — |
| `pytest` | 8.3.5 | **2 advisories affect the pinned 8.3.5** | — |
| `sqlalchemy` | 2.0.40 | none known | — |
| `uvicorn` | 0.34.2 | none known | — |

## Findings

### Reaches production

| Dependency | Version | Weekly downloads | Findings |
|---|---|---|---|
| `pytest` | 8.3.5 | — | 2 advisories affect the pinned 8.3.5 |

## Upstream repository and CI hygiene — OpenSSF Scorecard

These criteria describe each dependency's own repository, not the audited
project. Remediation, where any exists, is upstream.

No dependency was flagged on these criteria.

## Transitive advisories

Not examined: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod). Commit a lockfile to close this gap.

## Informational

Measured, not flagged.

- **CI token permissions**: median 0/10 across 7 scored dependencies; 4 score below 6. Not flagged — this measures whether CI workflows declare least-privilege tokens, which tracks project maturity rather than the likelihood of malicious code being published.
- **Changes reviewed by a second person**: median 1/10 across 7 scored dependencies; 5 score below 6. Not flagged — this measures the share of recent commits reviewed by a second person, which is low for most small single-maintainer projects and largely restates publisher concentration.
- **Publish provenance**: not determinable for any dependency in this project.
- **Security policy published**: 7 of 9 publish a security policy.
  Without: `httpx`, `psycopg`
- **Download volume**: not determinable for any dependency in this project.

## Coverage

What was and was not measured, per criterion.

| Criterion | Tier | Assessed | Flagged | Not assessable |
|---|---|---|---|---|
| Known advisories | A | 9/9 | 1 | 0 |
| Deprecated or yanked | A | 9/9 | 0 | 0 |
| Repository archived | A | 9/9 | 0 | 0 |
| Maintenance activity | A | 9/9 | 0 | 0 |
| Publisher concentration | B | 0/9 | 0 | 9 |
| Install-time script execution | B | 0/9 | 0 | 9 |
| Dangerous CI workflow | scorecard | 7/9 | 0 | 2 |
| CI token permissions | scorecard | 7/9 | 0 | 2 |
| Checked-in binaries | scorecard | 7/9 | 0 | 2 |
| Changes reviewed by a second person | scorecard | 7/9 | 0 | 2 |
| Publish provenance | info | 0/9 | 0 | 9 |
| Security policy published | info | 9/9 | 0 | 0 |
| Download volume | info | 0/9 | 0 | 9 |

## Not assessable

**Checked-in binaries**

- 2 dependencies — OpenSSF Scorecard has no report for this repository: `fastapi`, `uvicorn`

**Changes reviewed by a second person**

- 2 dependencies — OpenSSF Scorecard has no report for this repository: `fastapi`, `uvicorn`

**Dangerous CI workflow**

- 2 dependencies — OpenSSF Scorecard has no report for this repository: `fastapi`, `uvicorn`

**Download volume**

- 9 dependencies — PyPI's download counters are disabled and return -1: `alembic`, `argon2-cffi`, `fastapi`, `httpx`, `psycopg`, `pydantic` and 3 more

**Install-time script execution**

- 9 dependencies — install-time execution depends on whether a wheel or an sdist is installed, which this collector does not determine: `alembic`, `argon2-cffi`, `fastapi`, `httpx`, `psycopg`, `pydantic` and 3 more

**Publish provenance**

- 9 dependencies — PyPI publish attestations are not read by this collector: `alembic`, `argon2-cffi`, `fastapi`, `httpx`, `psycopg`, `pydantic` and 3 more

**Publisher concentration**

- 9 dependencies — PyPI publishes no upload ACL, so who can publish this package is not observable: `alembic`, `argon2-cffi`, `fastapi`, `httpx`, `psycopg`, `pydantic` and 3 more

**CI token permissions**

- 2 dependencies — OpenSSF Scorecard has no report for this repository: `fastapi`, `uvicorn`

## Method and caveats

- cache directory ownership was not verified: os.getuid is POSIX-only, so a cache at C:\Users\giuse\AppData\Local\Temp\supply-chain-risk-auditor-cache owned by another user would not be detected on this platform. Keep the cache under your own user profile, or pass --cache with a private path.
- gh is not authenticated. GitHub allows 60 requests/hour unauthenticated against 5000 authenticated, so repository signals may be unassessable.
- Optional tooling detected: npm. Not installed, so not used: bundler-audit, cargo-audit, osv-scanner, pip-audit.
- Direct dependencies only. Advisories attach to the package that ships the affected code, so an umbrella package can look clean while its components are not — rails 5.0.0 reports 0 advisories where actionpack 5.0.0 reports 10. Transitive dependencies were not examined: no lockfile resolves the transitive tree (package-lock.json, uv.lock, or a go 1.17+ go.mod).
- HTTP sources: 33 fetched, 9 served from cache (oldest 0.0h old), 0 refetched as stale, 0 unavailable offline, 0 errors.
