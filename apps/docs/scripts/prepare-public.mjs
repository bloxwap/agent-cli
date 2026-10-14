import { writeFileSync, readFileSync } from 'node:fs';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bloxwap.github.io';
const absolute = (path) => new URL(`${basePath}${path}`, siteUrl).href;
const pages = JSON.parse(readFileSync(new URL('../content/docs/meta.json', import.meta.url), 'utf8')).pages;
writeFileSync(new URL('../public/robots.txt', import.meta.url), `User-agent: *\nAllow: /\nSitemap: ${absolute('/sitemap.xml')}\n`);
writeFileSync(new URL('../public/llms.txt', import.meta.url), '# Bloxwap Agent CLI\n\nHyperliquid trading with Privy custody and Relay funding. Master keys stay external.\n\n' +
  pages.map((page) => `- [${page === 'index' ? 'Overview and installation' : page}](${absolute(page === 'index' ? '/docs/' : `/docs/${page}/`)})`).join('\n') +
  `\n\n- [Sitemap](${absolute('/sitemap.xml')})\n- [Static search index](${absolute('/search.json')})\n- [Source and packaged SKILL.md](https://github.com/bloxwap/agent-cli/tree/main/packages/agent-cli)\n`);
