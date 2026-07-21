# Render Production Deployment — Puppeteer/Chrome Runtime Fix

Records the final, verified Render production configuration for the backend service and the
incident that led to it: production Payslip PDF generation returning HTTP 500 with
`Could not find Chrome (ver. 150.0.7871.24)`. Written after the fix was verified with a real,
manually-generated production PDF.

## Final working Render configuration

**The Render service currently uses dashboard-configured commands, not `render.yaml`.** The
service's Root Directory is empty in the dashboard, so both commands below execute from the
repository root — not from `backend/`, unlike `render.yaml`'s committed `rootDir: backend`
Blueprint config. See "Dashboard versus render.yaml warning" below.

**Build Command:**

```
npm ci --include=dev && npm run build:shared && npm run prisma:generate && npm run build:backend && cd backend && npx puppeteer browsers install chrome
```

| Step                                                  | Purpose                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --include=dev`                                | Deterministic, workspace-aware install from `package-lock.json`, from the real repository root. `--include=dev` is required — dropping it excludes `typescript` and other build-only tooling, which breaks the backend `tsc` build (see Troubleshooting step 8).                                                                         |
| `npm run build:shared`                                | Compiles `@payroll/shared` (`tsc -p tsconfig.json`). Must run before the backend build — `backend`'s own `tsc` resolves `@payroll/shared` imports through its compiled `dist/` via the workspace symlink.                                                                                                                                |
| `npm run prisma:generate`                             | Regenerates the Prisma Client from `backend/prisma/schema.prisma`. Needed explicitly because `@prisma/client`'s own `postinstall` (which already ran as part of `npm ci`) cannot reliably locate the schema from its hoisted install location in this workspace and otherwise produces a placeholder client with no real models.         |
| `npm run build:backend`                               | Compiles the backend (`tsc -p tsconfig.build.json`) into `backend/dist/`.                                                                                                                                                                                                                                                                |
| `cd backend && npx puppeteer browsers install chrome` | Downloads the exact Chrome build (`150.0.7871.24`) the installed `puppeteer` package expects into the project-local cache directory `backend/.puppeteerrc.cjs` points at. Must run with `backend/` as its own working directory for that config file to be discovered (Puppeteer's config search walks upward from `cwd`, not downward). |

**Start Command:**

```
npx prisma migrate deploy --schema backend/prisma/schema.prisma && cd backend && npx puppeteer browsers install chrome && cd .. && npm run start --workspace backend
```

| Step                                                              | Purpose                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prisma migrate deploy --schema backend/prisma/schema.prisma` | Applies any pending database migrations before the backend starts serving requests. Run from the repository root with an explicit `--schema` path, since there is no root-level `prisma:migrate:deploy` script (see Troubleshooting steps 10–12). |
| `cd backend && npx puppeteer browsers install chrome`             | Re-installs Chrome into `backend/.cache/puppeteer` at the start of every runtime instance, immediately before the backend process launches. This is the step that actually resolved the incident — see "Root cause" below.                        |
| `cd .. && npm run start --workspace backend`                      | Starts the compiled backend (`node dist/server.js`) via its own workspace script, run from the repository root since there is no root-level `start:backend` script (see Troubleshooting steps 10–12).                                             |

## Incident summary

Production Payslip PDF generation returned HTTP 500. Runtime logs reported:

```
Could not find Chrome (ver. 150.0.7871.24)
```

Puppeteer was configured (via `backend/.puppeteerrc.cjs`) to use cache directory:

```
/opt/render/project/src/backend/.cache/puppeteer
```

The application and Puppeteer configuration correctly resolved that cache location — this was
verified directly against the error message itself, which echoes `config.cacheDirectory` from
Puppeteer's own configuration resolution. Chrome was simply not present there in the running
service instance at request time.

## Root cause

Two contributing causes, both confirmed:

1. **The live Render service was controlled by commands saved in the Render dashboard, not by
   `render.yaml`.** The repository's `render.yaml` (a Blueprint file) had already been updated to
   run `npx puppeteer browsers install chrome` during the build, but the dashboard held its own,
   separately-configured Build and Start commands that did not include this step. Editing
   `render.yaml` alone therefore had no effect on the live service — the Chrome installation step
   was not being executed by the commands actually in force.

2. **After the dashboard Build Command was corrected to include the Chrome install step, the build
   log confirmed Chrome was installed successfully during the build:**

   ```
   chrome@150.0.7871.24 /opt/render/project/src/backend/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome
   ```

   Despite this, the running service still could not find Chrome at that same cache path at
   request time. **The evidence available (the build log's success line, and the identical runtime
   error against the identical path) establishes only that the build-installed browser was not
   available to Puppeteer at runtime — it does not establish, and this document does not claim,
   any specific undocumented Render filesystem mechanism as the reason why.** Installing Chrome
   again at the start of the Start Command — immediately before the backend process launches —
   resolved the issue in practice: the browser is now provably present when `puppeteer.launch()`
   runs, regardless of what happens to a build-time copy between the build and the running
   instance.

## Troubleshooting timeline

1. Production login and general backend functionality worked.
2. Payslip PDF requests returned HTTP 500.
3. Runtime logs reported that Chrome 150.0.7871.24 could not be found.
4. Puppeteer package usage, configuration discovery, browser version, and cache path were
   investigated (application code, `backend/.puppeteerrc.cjs`, the `puppeteer`/`puppeteer-core`
   dependency relationship).
5. Runtime correctly discovered `.puppeteerrc.cjs` and looked in `backend/.cache/puppeteer` — this
   was confirmed directly from the error message's own echoed cache path.
6. Render dashboard settings were found not to match `render.yaml`.
7. The dashboard Build Command was corrected to include the Chrome install step.
8. The first corrected build failed: `npm ci` (without `--include=dev`) omitted required
   development dependencies, and an unintended TypeScript version rejected
   `moduleResolution=node10` in the backend's `tsconfig`.
9. Restoring `npm ci --include=dev` fixed the TypeScript build.
10. Incorrect, assumed root-level scripts `prisma:migrate:deploy` and `start:backend` caused
    startup failures — neither exists in root `package.json`.
11. The root `package.json` was inspected directly and confirmed neither script existed.
12. Prisma migrations were correctly invoked instead with
    `npx prisma migrate deploy --schema backend/prisma/schema.prisma`.
13. The backend was correctly started instead through its own workspace with
    `npm run start --workspace backend`.
14. Chrome was still unavailable at runtime even though its build-time installation was confirmed
    in the build log.
15. Adding `npx puppeteer browsers install chrome` to the Start Command (before the backend
    process launches) resolved the issue.
16. A production Payslip PDF was successfully generated and downloaded.

## What was ruled out

The evidence gathered during this investigation rules out the following as the primary cause of
the HTTP 500:

- PDF template/service business logic (`backend/src/lib/pdf/templates/`,
  `backend/src/modules/payslips/`) — the failure occurs before any template rendering is reached,
  at browser resolution.
- Direct application imports of `puppeteer-core` — confirmed by repository-wide search: the
  application only ever imports `puppeteer`; `puppeteer-core` appears solely as `puppeteer`'s own
  internal dependency.
- A Puppeteer/`puppeteer-core` version mismatch — traced the exact call path from `puppeteer`'s
  entry point through to the `puppeteer-core` class it wraps, and confirmed both the install step
  and the runtime launch resolve the identical pinned Chrome version through the identical
  configuration mechanism.
- Failure to discover `.puppeteerrc.cjs` — the runtime error's own echoed cache path proves the
  config file was found and correctly resolved.
- An incorrectly configured cache path — the resolved path matched the intended, project-local
  location in every observation.
- Prisma migration failure — migrations were confirmed applying successfully once invoked with the
  correct explicit `--schema` path.
- CORS or CSRF as the cause of this specific PDF failure — production login and other backend
  functionality worked normally throughout, and the error is a server-side Puppeteer exception, not
  a rejected cross-origin or CSRF-protected request.

**Filesystem permissions were not specifically tested and are not ruled out as a contributing
factor** — no repository evidence (logs, tests, or code) confirms or excludes a permissions-related
explanation for why a build-time copy of Chrome was unavailable at runtime; the fix adopted here
(install at Start Command time) sidesteps the question rather than resolving it, which is why it is
recorded as open in "Operational notes" below rather than closed.

## Operational notes

- **Keep `--include=dev` in the Render Build Command.** TypeScript and other build tooling used by
  `npm run build:shared` / `npm run build:backend` are development dependencies; omitting
  `--include=dev` breaks the build (Troubleshooting step 8).
- **The current Start Command downloads Chrome on every new runtime start.** This can make cold
  starts slower and requires outbound network access from the running instance at startup, not
  just at build time.
- **Do not remove the runtime Chrome installation step** until an alternative has been tested on a
  fresh Render deployment and verified by generating a real production PDF — not merely inferred
  from a build log or local testing.
- **Render free-tier instances may spin down when idle.** A cold start on that tier can include
  both service wake-up time and the Chrome installation time above, compounding perceived latency
  on the first request after a period of inactivity.
- **After any deployment configuration change, verify, in order:**
  1. migrations complete,
  2. the backend becomes healthy (`/health`),
  3. production login works,
  4. one individual Payslip PDF opens,
  5. one individual Payslip PDF downloads,
  6. batch Payslip generation is tested **separately** — it is not covered by an individual-PDF
     check and must not be assumed to work from one alone.

## Dashboard versus render.yaml warning

**The live Render service is currently controlled by commands saved directly in the Render
dashboard — not by the committed `render.yaml`.** This is why editing `render.yaml` alone, earlier
in this incident, did not change the active service's behavior: the dashboard's own saved Build and
Start commands took precedence and simply did not match the file. The Build and Start commands
documented above are the ones **currently active in the dashboard** for the live service, verified
by a real, successful production PDF generation — they are not necessarily identical to whatever is
currently committed in `render.yaml`.

Any future migration to full Blueprint (`render.yaml`)-managed deployment must be a deliberate,
explicit decision — not an incidental side effect of some other change — and must first update
`render.yaml` to exactly match the verified commands recorded in this document before switching the
service over, then re-verify all six checks in "Operational notes" against the Blueprint-managed
deploy before relying on it.

## Security note

This document intentionally omits: database credentials, cookies, session identifiers, CSRF
tokens, user IP addresses, Render service IDs, and any other sensitive values that appeared in
production logs consulted during this investigation. Only the specific error message, cache path,
and build-log line directly relevant to diagnosing the Chrome-provisioning failure are reproduced
above.
