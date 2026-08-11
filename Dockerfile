FROM node:22-slim
WORKDIR /app

# Manifests first so the install layer caches across source-only changes.
COPY monorepo/package.json monorepo/yarn.lock ./
COPY monorepo/apps/backend/package.json apps/backend/
COPY monorepo/apps/web/package.json apps/web/
COPY monorepo/apps/admin/package.json apps/admin/
COPY monorepo/apps/landing/package.json apps/landing/
COPY monorepo/packages/shared/package.json packages/shared/
# Full install, devDeps included — the backend runs TS via tsx (a devDependency), no build step.
# ponytail: installs every workspace's deps (fat image); prune to backend+shared if size ever matters
RUN yarn install --frozen-lockfile --network-timeout 300000

COPY monorepo/ .

# NODE_ENV + secrets come from Railway variables; PORT is injected by the platform.
# Migrations run before the server so it can never boot against a stale schema.
CMD yarn workspace @fpay/backend db:deploy && yarn workspace @fpay/backend start
