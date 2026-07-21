# Deployment Strategy

**Owner module(s):** All modules (cross-cutting deployment/infrastructure)

**Contains:** Railway vs. Render comparison, deployment topology, backup strategy in production

**Sections:** — (narrative document, not part of the §-numbered schema/workflow set) · Database
index: `database/README.md`

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
  cycles, backup packages, `docs/architecture/workflows/payroll-lifecycle.md`) treats payroll data as
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
  established in `docs/architecture/system-conventions.md` and
  `docs/architecture/workflows/payroll-lifecycle.md`.
- **File storage** — local filesystem in development; a cloud object storage provider in production,
  selected behind the `StorageProvider` abstraction (`docs/architecture/system-conventions.md` §2) —
  this choice is independent of the Render/Railway decision and does not block it.
- **Staging environment** — a separate Render environment (its own web service, static site, and
  database) seeded from anonymized/synthetic data, deployed from a staging branch; production deploys
  only from a protected main branch after staging verification.
- **CI** — GitHub Actions running type-check, lint, and the Jest/Playwright test suites on every pull
  request, gating merges and deploys.
- **Monitoring** — Sentry wired into both the backend and frontend services from initial deployment,
  per `docs/architecture/tech-stack.md`.

## Backend Build Command (Render)

```
cd .. && npm ci && npm run build:shared && npm run prisma:generate && npm run build:backend && cd backend && npx puppeteer browsers install chrome
```

`render.yaml`'s backend service sets `rootDir: backend`, so this command starts with `backend/` as
its process `cwd` — it opens with `cd ..` to reach the actual workspace root before doing anything
workspace-wide, then `cd backend` again at the end for the one step (the Puppeteer install) that
specifically needs `backend/` as its own cwd, not just an ancestor of it.

**This replaced an earlier version that looked reasonable but silently failed from a clean
checkout, in three separate ways — none of them related to Puppeteer.** All three were found by
actually running the old command end to end from a fresh, `node_modules`-free checkout (a plain
`rsync` of the working tree, no shortcuts), exactly as Render would:

1. **`npm install --workspaces=false` cannot resolve `@payroll/shared`.** The old command's first
   step installed `backend/package.json`'s dependencies as if `backend` were a standalone project,
   ignoring the workspace. `@payroll/shared` (declared as `"*"`) is a private, unpublished
   workspace-only package — with workspace linking disabled, npm falls back to the public registry
   and 404s: `GET https://registry.npmjs.org/@payroll%2fshared` — `Not Found`. Reproduced on a
   completely clean checkout, not just a stale local state.
2. **`npm run build --prefix .. --workspace shared` doesn't compose the way it looks like it
   should.** Tested in isolation, from `backend/` (`--prefix ..` is supposed to retarget npm to the
   repo root): `npm error No workspaces found: --workspace=shared`. `--prefix` and `--workspace`
   don't combine the way this line assumed; a real `cd ..` does what the flag combination was
   trying to achieve.
3. **Prisma's client types were never explicitly (re)generated for the real schema.**
   `@prisma/client`'s own `postinstall` script (already allowlisted in `allowScripts`, and it does
   run) tries to auto-run `prisma generate`, but — for the same reason as the Puppeteer
   `postinstall` issue below — it can't reliably locate `backend/prisma/schema.prisma` from its
   hoisted install location in a workspace, and silently falls back to generating a placeholder
   client with no real models. The old command never generated the real one explicitly, so `tsc`
   failed compiling `backend` with dozens of `Namespace '...Prisma' has no exported member 'X'`
   errors the moment it hit any file importing a real Prisma type.

None of these were ever hit in earlier smoke-testing, most likely because a real, working
`node_modules`/`.prisma/client` from a prior local install was already present and never fully torn
down — the failure mode only appears from a genuinely clean state, which is exactly the state every
fresh Render deploy starts from.

**Why the new command is correct, step by step:**

1. `npm ci` — a real, workspace-aware, deterministic install from `package-lock.json`, run from the
   actual repo root (reached via `cd ..`, not a flag). Resolves `@payroll/shared` (and `@payroll/
   backend`, `@payroll/frontend`) via the workspace symlinks in `node_modules/@payroll/*` — verified
   directly after a clean run — never touching the registry for them. `npm ci` also always deletes
   any pre-existing `node_modules` first, so this can't accidentally pass by relying on stale local
   state the way the old command's failures went undetected.
2. `npm run build:shared` — root's own pre-existing script (`npm run build --workspace shared`).
   `@payroll/shared`'s `package.json` points `main`/`types` at `./dist/*`, which only exists after
   this runs — `backend`'s own `tsc` resolves `@payroll/shared` imports through that same `dist/`,
   so this must run first.
3. `npm run prisma:generate` — root's own pre-existing script
   (`npm run prisma:generate --workspace backend`), which runs `prisma generate` with `backend/` as
   its cwd (an `npm run --workspace` script execution, not a lifecycle script — resolves
   `./prisma/schema.prisma` correctly by default). Confirmed fixing this specific step alone turns
   a failing `tsc` build into a clean one.
4. `npm run build:backend` — root's own pre-existing script (`npm run build --workspace backend`),
   now correct because both of its build-time dependencies (steps 2 and 3) are.
5. `cd backend && npx puppeteer browsers install chrome` — the Puppeteer fix, unchanged from what
   was reviewed and approved; see "PDF Generation (Puppeteer/Chrome)" below for why it needs
   `backend/` as its own cwd, not merely `--prefix`-adjacent to it.

**Verified exactly the way Render would run it:** a full clean checkout (`rsync`, no `node_modules`,
no `dist/`, no `.cache/`), `cwd=backend/` throughout, running the literal command above end to end —
`npm ci` succeeds and resolves the workspace packages via symlink (no registry hit), `build:shared`
and `prisma:generate` and `build:backend` all succeed, `backend/dist/server.js` is produced, and
`npx puppeteer browsers install chrome` downloads Chrome `150.0.7871.24` into
`backend/.cache/puppeteer/`, matching `backend/.puppeteerrc.cjs`.

`startCommand: npm run start` and `rootDir: backend` are unchanged — `dist/server.js` (from step 4)
resolves correctly from `backend/` regardless of what cwd the *build* command used along the way,
since each `npm run --workspace X` step above runs with its own cwd temporarily set to that
workspace's directory internally, independent of the outer shell's cwd at the time.

## PDF Generation (Puppeteer/Chrome)

Payslip (and future document) PDF generation (`backend/src/lib/pdf/`) launches a real headless
Chrome via Puppeteer. Puppeteer downloads its own pinned Chrome build (not the system browser) into
a local cache directory — by default `~/.cache/puppeteer`, outside the project tree entirely.

**Why that default broke on Render:** Render's native (non-Docker) Node runtime is ephemeral —
every deploy re-runs the build command from a clean environment, and nothing on disk survives from
one deploy to the next (there is no persistent disk attached to this service). Within a *single*
deploy, though, the build command's own output becomes the running instance's filesystem (this is
necessarily true for any Node service — `node_modules` and `dist/` themselves only exist at
runtime because that build output carries forward). The bug was that Puppeteer's default cache
(`~/.cache/puppeteer`) sits outside the service's project directory (`rootDir: backend`), and nothing
in that build actually reached it: Puppeteer's Chrome download from a plain `npm install` had two
independent problems (below), so the browser genuinely wasn't there — not that it was written
somewhere transient, but that the download step relied on was silently a no-op.

**The fix relies on one build step, not on `npm install`'s own postinstall download:**

`render.yaml`'s backend `buildCommand` (see "Backend Build Command (Render)" above) ends with
`cd backend && npx puppeteer browsers install chrome`, run explicitly rather than left to `npm
ci`'s own postinstall download. This is the step that actually provisions the browser for that
deploy — it is not a backup for the postinstall download, which turns out not to be usable here
for two reasons found during implementation:

1. **`npm install`'s `postinstall` script can't see this project's cache-directory config.**
   `backend/.puppeteerrc.cjs` sets `cacheDirectory` to a path inside `backend/`, discovered by
   Puppeteer searching *upward* from its own process `cwd`. A directly-invoked command (the
   `npx puppeteer browsers install chrome` build step, or the compiled server's
   `puppeteer.launch()` at runtime) runs with `backend/` as that cwd and finds it correctly —
   confirmed by inspecting the resolved `cacheDirectory` and `puppeteer.executablePath()` in both
   cases. A `postinstall` lifecycle script does not: npm always runs it with `cwd` set to the
   installed package's own directory, never the invoking shell's cwd — confirmed empirically (even
   a literal `cd backend && npm install` still downloads to `~/.cache/puppeteer`), because this
   workspace hoists `puppeteer` to the repo root's `node_modules`, outside `backend/`'s own
   directory tree and therefore never reached by the upward search. Whatever `postinstall`
   downloads lands in the OS-default cache and is never read by anything — wasted, but harmless.
2. **`puppeteer` was missing from this repo's `allowScripts` allowlist.** Root `package.json`'s
   `allowScripts` map (an npm 11+ feature restricting which packages' install scripts may run —
   this repo already used it for `prisma`, `argon2`, `esbuild`, and `fsevents`) did not list
   `puppeteer`, so npm silently skipped its `postinstall` entirely (confirmed via `npm rebuild
   puppeteer` and `--foreground-scripts`, both showing the skip). `puppeteer@25.3.0` has since been
   added to that allowlist for consistency with the rest of the repo's convention, but this does
   not change which build step actually matters — see point 1.

Because of point 1, `.puppeteerrc.cjs`'s `cacheDirectory` and the explicit `npx puppeteer browsers
install chrome` step are what actually determine where Chrome ends up for a given deploy, and
`puppeteer.launch()` at runtime (same `rootDir`, same cwd) resolves the identical path — both
verified directly (`puppeteer.executablePath()` resolves to `.../backend/.cache/puppeteer/...` in
both the build-step and runtime-equivalent contexts). No manual Render dashboard environment
variable is required for any of this — the cache path travels with the repo via
`backend/.puppeteerrc.cjs`, resolved via `__dirname` (no machine-specific or Render-specific
absolute path is ever written down).

`backend/.cache/` is git-ignored — this is a Git-only concern (what gets committed), unrelated to
what exists on Render's build/runtime filesystem, which is populated fresh by the build command on
every deploy regardless of `.gitignore`.

**Open production-verification risk, not yet provable outside a real Render deploy:** Chrome
depends on a set of shared Linux libraries (`libnss3`, `libatk-1.0`, `libx11`, etc.) that a minimal
Linux base image will not always have preinstalled. Whether Render's native Node build/runtime
image already includes what Chrome needs has not been confirmed here — this repo has no Render
account access, and local verification was only possible on macOS. `--install-deps` (which would
`apt-get install` these as root) is deliberately not used, since Render's build does not run with
root/sudo privileges and the flag would simply fail. If the next production deploy fails with a
*different* error than `Could not find Chrome` — e.g. `error while loading shared libraries:
libnss3.so: cannot open shared object file` — that is this exact risk materializing, and the next
step is confirming with Render (support or their own base-image documentation) whether those
libraries are present on the plan's build image, not adding `--install-deps` reflexively.

## Backup Strategy in Production

In addition to Render's managed Postgres backups (daily + PITR), the application-level backup
packages described in `docs/architecture/workflows/payroll-lifecycle.md` §5 (generated automatically
when a cycle is archived) provide a second, independent, human-inspectable safety net — CSV/metadata
exports
distinct from a full database snapshot, useful for disaster recovery, audits, and giving the client
an offline copy without requiring a database restore.
