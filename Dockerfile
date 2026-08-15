# node >=24: apps/web's @solana-program/token@0.14 demands it, and this install covers every workspace.
FROM node:24-slim
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
# Full install, devDeps included — the backend runs TS via tsx (a devDependency), no build step.
# ponytail: installs every workspace's deps (fat image); prune to backend+shared if size ever matters
RUN yarn install --frozen-lockfile --network-timeout 300000

COPY monorepo/ .

# NODE_ENV + secrets come from Railway variables; PORT is injected by the platform.
# Migrations run before the server so it can never boot against a stale schema.
CMD yarn workspace @fpay/backend db:deploy && yarn workspace @fpay/backend start
