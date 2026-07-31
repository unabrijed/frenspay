// Plain-CSS side-effect imports (globals.css). next/types only declares *.module.css, and the
// generated .next/types doesn't exist before the first build — this keeps `tsc --noEmit` green.
declare module '*.css';
