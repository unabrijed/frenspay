# Two stages: the runner ships a minified bundle of the backend and nothing else — no src/, no web,
# no admin, no lp, no landing. Smaller image, faster boot, faster healthcheck.
#
# Railway builds this file from a `railway up` upload; the image is never pushed anywhere, so today
# the split is an optimisation. It was written as a privacy boundary, and it becomes one again the
# moment this image is pushed to a public registry — which is what the pull-based model needs, since
# Railway gates private-registry pulls behind Pro. If that day comes, the rule returns with it:
# NOTHING that reads as source may enter the runner stage. The bundle already leaks more than it
# looks like it does (route paths, fee math, the literal "frens@frenspay.xyz"), and
# dist/migrations/*.sql is the schema in plain SQL.

# node >=24: apps/web's @solana-program/token@0.14 demands it, and this install covers every workspace.
FROM node:24-slim AS builder
WORKDIR /app

# Manifests first so the install layer caches across source-only changes.
#
# EVERY workspace's manifest must be here, not just the ones the backend imports. Workspace deps are
# declared "*" and are deliberately absent from yarn.lock — yarn resolves them from the workspace
# tree, so a manifest missing at this layer makes yarn fall through to the npm registry and the
# install dies on a package that was never published. That is exactly what happened when
# packages/ui appeared: web and lp declare @fpay/ui, its manifest was not copied, and the build
# broke even though the backend never touches it. Add a line here whenever a workspace is added.
COPY monorepo/package.json monorepo/yarn.lock ./
COPY monorepo/apps/backend/package.json apps/backend/
COPY monorepo/apps/web/package.json apps/web/
COPY monorepo/apps/admin/package.json apps/admin/
COPY monorepo/apps/landing/package.json apps/landing/
COPY monorepo/apps/lp/package.json apps/lp/
COPY monorepo/packages/shared/package.json packages/shared/
COPY monorepo/packages/ui/package.json packages/ui/
# devDeps included — esbuild lives there and the build below needs it.
RUN yarn install --frozen-lockfile --network-timeout 300000

COPY monorepo/ .

# Two flat bundles, .mjs, no sourcemap (a sourcemap would put the source back in a public image).
RUN yarn workspace @fpay/backend build

FROM node:24-slim AS runner
WORKDIR /app

# ponytail: this is the whole workspace's node_modules (Next, wagmi, the lot) — yarn 1.22 has no
# `workspaces focus`, and `--production` still drags Next in because it is a *dependency* of web.
# They are public packages, so it costs image size, not privacy. Trim by hand-listing the backend's
# runtime deps in a minimal runner package.json only if pull time ever hurts.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./dist

# Both bundles are flat in dist/, so both resolve these at runtime off import.meta.url:
#   src/db/migrations.ts               -> <dir of the bundle>/migrations   (server AND migrate read it)
#   src/services/bridge/cctp/solana.ts -> <dir of the bundle>/idl/<vendored CCTP idl>.json
# Move either bundle a directory deeper and these paths break silently. Keep them side by side.
# (The escrow program's IDL was copied here too until 2026-08-31; the program is shelved and its
# client deleted. A COPY whose source has left the tree fails the build AFTER the push — which is why
# the pre-push hook now asserts every source below exists.)
COPY --from=builder /app/apps/backend/src/db/migrations ./dist/migrations
COPY --from=builder /app/apps/backend/src/services/bridge/cctp/idl ./dist/idl

# NODE_ENV + secrets come from Railway variables; PORT is injected by the platform.
# Migrations run before the server so it can never boot against a stale schema.
CMD node dist/migrate.mjs deploy && node dist/server.mjs
