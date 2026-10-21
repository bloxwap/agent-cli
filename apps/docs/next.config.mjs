import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
export default withMDX({
  // The build script checks types with tsrs (or tsc fallback) before Next bundles.
  // Skip Next's duplicate TypeScript pass.
  typescript: { ignoreBuildErrors: true },
  output: 'export',
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Resolve dependencies from the npm workspace root.
  turbopack: { root: new URL('../..', import.meta.url).pathname },
});
