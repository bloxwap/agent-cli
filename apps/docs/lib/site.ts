export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/agent-cli';
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bloxwap.github.io';
export const repository = 'https://github.com/bloxwap/agent-cli';

/** For fetches and plain asset URLs. Next Link already applies basePath. */
export function assetUrl(path: string): string { return `${basePath}${path}`; }
