// TypeScript 6 checks side-effect imports, and neither Next nor Tailwind ships a `*.css`
// declaration. apps/web and apps/admin only typecheck today because `@fpay/shared` transitively
// drags in Expo's global.d.ts, which happens to declare it. Landing has no such dependency.
declare module '*.css';
