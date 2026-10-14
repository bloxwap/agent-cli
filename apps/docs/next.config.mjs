import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
export default withMDX({
  output: 'export',
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '/agent-cli',
  images: { unoptimized: true },
  reactStrictMode: true,
  // Resolve dependencies from the npm workspace root.
  turbopack: { root: new URL('../..', import.meta.url).pathname },
});
