// Metro config for use inside the Yarn-workspaces monorepo.
// Watches the workspace root so Metro can resolve hoisted deps and the
// @pay/shared workspace package. Per the Expo "Work with monorepos" guide.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the workspace root (hoisted deps)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Privy: a few deps ship "exports" maps that are incompatible with RN's bundler
// (package exports are on by default in SDK 53+). Disable/redirect them per the Privy
// React Native install guide (https://docs.privy.io/basics/react-native/installation).
const resolveRequestWithPackageExports = (context, moduleName, platform) => {
  // `isows` (a viem dependency) — package exports are incompatible.
  if (moduleName === 'isows') {
    const ctx = { ...context, unstable_enablePackageExports: false };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }
  // `zustand@4` — package exports are incompatible.
  if (moduleName.startsWith('zustand')) {
    const ctx = { ...context, unstable_enablePackageExports: false };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }
  // `jose` — use the browser build.
  if (moduleName === 'jose') {
    const ctx = { ...context, unstable_conditionNames: ['browser'] };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
config.resolver.resolveRequest = resolveRequestWithPackageExports;

module.exports = config;
