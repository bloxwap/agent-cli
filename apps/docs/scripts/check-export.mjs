import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../out/', import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bloxwap.github.io';
const failures = [];
const exists = async (path) => { try { return (await stat(path)).isFile(); } catch { return false; } };
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? walk(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}
for (const required of [
  'index.html', '404.html', 'docs/index.html', 'search.json', 'icon.svg',
  'llms.txt', 'robots.txt', '404.md',
]) {
  if (!await exists(join(root, required))) failures.push(`Missing ${required}`);
}

// Agent-readiness contract: every machine-readable file the site advertises must exist
// and behave the way llms.txt and the 404 page claim it does.
const robots = await readFile(join(root, 'robots.txt'), 'utf8');
if (!/^sitemap:\s*https:\/\/\S+\/sitemap\.xml\s*$/im.test(robots)) failures.push('robots.txt: missing absolute Sitemap directive');
const notFoundMarkdown = await readFile(join(root, '404.md'), 'utf8');
if (notFoundMarkdown.length < 20 || !/llms\.txt|sitemap|docs/.test(notFoundMarkdown)) {
  failures.push('404.md must explain the error (20+ chars) and link to the docs, sitemap, or llms.txt');
}
const files = (await walk(root)).filter((file) => extname(file) === '.html');
let checked = 0;
let socialCards = 0;
for (const file of files) {
  const html = await readFile(file, 'utf8');
  const name = relative(root, file).split(sep).join('/');
  // Social crawlers read exported HTML, so verify each public page's actual tags
  // and PNG instead of relying on Next's metadata types alone.
  if (name === 'index.html' || (name.startsWith('docs/') && name.endsWith('/index.html'))) {
    const meta = new Map([...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replaceAll('&amp;', '&')]));
      return [attrs.property ?? attrs.name, attrs.content];
    }));
    const route = name === 'index.html' ? '/' : `/${name.slice(0, -'index.html'.length)}`;
    const imagePath = route === '/' ? '/og/home.png' : route === '/docs/' ? '/og/docs/index.png' : `/og${route.slice(0, -1)}.png`;
    const absolute = (path) => new URL(`${basePath}${path}`, siteUrl).href;
    for (const [key, expected] of Object.entries({
      'og:type': 'website', 'og:site_name': '@bloxwap/agent-cli', 'og:url': absolute(route),
      'og:image': absolute(imagePath), 'og:image:type': 'image/png',
      'og:image:width': '1200', 'og:image:height': '630',
      'twitter:card': 'summary_large_image', 'twitter:image': absolute(imagePath),
    })) {
      if (meta.get(key) !== expected) failures.push(`${name}: expected ${key} = ${expected}, got ${meta.get(key)}`);
    }
    for (const field of ['title', 'description', 'image:alt']) {
      if (!meta.get(`og:${field}`) || meta.get(`og:${field}`) !== meta.get(`twitter:${field}`)) {
        failures.push(`${name}: missing or inconsistent social ${field}`);
      }
    }
    try {
      const png = await readFile(join(root, imagePath));
      if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
        failures.push(`${name}: ${imagePath} must be a 1200×630 PNG`);
      }
    } catch { failures.push(`${name}: missing social card ${imagePath}`); }
    socialCards++;
  }
  if (name === '404.html') {
    // The 404 must explain the error in the HTML body and point agents at the indexes.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!/does not exist/i.test(text)) failures.push('404.html: body must explain that the page does not exist');
    for (const target of [`${basePath}/llms.txt`, `${basePath}/sitemap.xml`, `${basePath}/404.md`]) {
      if (!html.includes(`href="${target}"`)) failures.push(`404.html: missing link to ${target}`);
    }
    if (!html.includes('type="text/markdown"')) failures.push('404.html: missing rel="alternate" text/markdown link');
  }
  for (const match of html.matchAll(/<(?:a|link|script|img|iframe)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;
    const pathname = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!pathname) continue;
    let target;
    if (pathname.startsWith('/')) {
      if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
        failures.push(`${file.slice(root.length)} links outside basePath: ${href}`); continue;
      }
      target = resolve(root, `.${pathname.slice(basePath.length) || '/'}`);
    } else target = resolve(dirname(file), pathname);
    if (!await exists(target) && !await exists(join(target, 'index.html')) && !await exists(`${target}.html`)) {
      failures.push(`${file.slice(root.length)} has broken link/asset: ${href}`);
    }
    checked++;
  }
}
if (failures.length) throw new Error([...new Set(failures)].join('\n'));
await writeFile(join(root, '.nojekyll'), '');
await writeFile(join(root, '_docs-config.json'), JSON.stringify({ basePath }));
console.log(`Static export verified: ${files.length} HTML pages, ${checked} local links/assets, ${socialCards} social cards, basePath "${basePath || '/'}".`);
