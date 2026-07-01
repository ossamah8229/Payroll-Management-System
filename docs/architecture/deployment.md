# Deployment Strategy

## Comparison: Railway vs Render

| Criterion | Railway | Render |
|---|---|---|
| **Reliability** | Faster iteration loop, well-suited to rapid prototyping; has a history of more publicized incidents/outages for production-grade workloads | More consistent uptime track record for production services |
| **PostgreSQL support** | Managed Postgres via a plugin; straightforward to provision | Native managed PostgreSQL, including a point-in-time-recovery (PITR) tier |
| **Automatic backups** | Available, but historically less mature and less configurable (retention/PITR options more limited) | Automated daily backups on paid tiers, with PITR available on higher tiers — directly matches the "cannot lose payroll data" requirement |
| **SSL** | Automatic, zero-config | Automatic, zero-config |
| **Ease of deployment** | Very fast to get a service live; simple git-push deploys | Similarly simple git-push deploys; slightly more structure around environments/blueprints |
| **Ease of maintenance** | Usage-based pricing — can fluctuate month to month, harder to budget precisely | Flat, predictable pricing per service tier; native staging/production environment separation |

## Recommendation: Render

**Render** is the recommended platform. The deciding factors, weighted against this project's actual
requirements:

- **Backup maturity matters more here than elsewhere.** This system's own architecture (Archived
  cycles, backup packages, `docs/architecture/data-and-storage.md`) treats payroll data as
  effectively irreplaceable. Render's more mature automated-backup and point-in-time-recovery story
  on managed Postgres is a direct match for that requirement; Railway's is comparatively less
  configurable.
- **Predictable pricing suits a client who explicitly said budget isn't the constraint but "cannot
  have any crashes."** Render's flat per-tier pricing is easier for a non-technical client to
  understand and budget against than Railway's usage-based model, which can spike unexpectedly under
  load (e.g. the monthly payroll-processing window, which is exactly when cost predictability matters
  most).
- **Native staging/production separation** aligns with the requirement (from the original technical
  direction) to test changes before they touch real payroll data — Render supports this as a
  first-class concept rather than something to assemble manually.
- **Railway remains a reasonable fallback** if development velocity becomes the dominant concern
  later, or if the team develops a strong Railway-specific operational preference — the application
  is a standard containerized Node + PostgreSQL service either way, so switching platforms later is
  an infrastructure change, not an application rewrite.

## Deployment Topology

- **Backend** — Render Web Service running the Express API.
- **Frontend** — Render Static Site serving the built Vite/React bundle (CDN-backed, automatic SSL).
- **Database** — Render managed PostgreSQL, PITR-enabled tier given the financial-data criticality
  established in `docs/architecture/data-and-storage.md`.
- **File storage** — local filesystem in development; a cloud object storage provider in production,
  selected behind the `StorageProvider` abstraction (`docs/architecture/data-and-storage.md` §2) —
  this choice is independent of the Render/Railway decision and does not block it.
- **Staging environment** — a separate Render environment (its own web service, static site, and
  database) seeded from anonymized/synthetic data, deployed from a staging branch; production deploys
  only from a protected main branch after staging verification.
- **CI** — GitHub Actions running type-check, lint, and the Jest/Playwright test suites on every pull
  request, gating merges and deploys.
- **Monitoring** — Sentry wired into both the backend and frontend services from initial deployment,
  per `docs/architecture/tech-stack.md`.

## Backup Strategy in Production

In addition to Render's managed Postgres backups (daily + PITR), the application-level backup
packages described in `docs/architecture/data-and-storage.md` (generated automatically when a cycle
is archived) provide a second, independent, human-inspectable safety net — CSV/metadata exports
distinct from a full database snapshot, useful for disaster recovery, audits, and giving the client
an offline copy without requiring a database restore.
