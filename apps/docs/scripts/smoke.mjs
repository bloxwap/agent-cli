// Browser smoke test for the static export: install/copy, keyboard, search, base path and 390 px mobile navigation.
// Run after `npm run docs:build`. Set SCREENSHOTS=<dir> to save desktop and mobile captures (SCREENSHOT_PREFIX names them).
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const docs = fileURLToPath(new URL('..', import.meta.url));
const { basePath } = JSON.parse(await readFile(join(docs, 'out/_docs-config.json'), 'utf8'));
const port = Number(process.env.PORT ?? 3913);
const origin = `http://127.0.0.1:${port}`;
const url = (path) => `${origin}${basePath}${path}`;
const shots = process.env.SCREENSHOTS;
const prefix = process.env.SCREENSHOT_PREFIX ?? 'after';

const server = spawn(process.execPath, [join(docs, 'scripts/preview.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { if (String(chunk).includes('Static docs preview')) resolve(); });
  server.on('exit', (code) => reject(new Error(`Preview exited with ${code}`)));
});

const browser = await chromium.launch();
const results = [];
async function check(name, run) {
  try { await run(); results.push(`ok  ${name}`); }
  catch (error) { results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`); process.exitCode = 1; }
}
async function capture(page, name) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.waitForTimeout(1200); // let the landing entrance animation finish
  await page.screenshot({ path: join(shots, `${prefix}-${name}.png`), fullPage: name.startsWith('home') });
}
async function noHorizontalScroll(page) {
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth + 1, null, { timeout: 5000 });
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await check('home renders with the base path and no runtime errors', async () => {
    const response = await page.goto(url('/'));
    assert.equal(response?.status(), 200);
    await page.getByRole('heading', { level: 1 }).waitFor();
    for (const href of await page.locator('link[rel=stylesheet]').evaluateAll((links) => links.map((l) => l.getAttribute('href')))) {
      assert.ok(href?.startsWith(`${basePath}/`), `stylesheet outside base path: ${href}`);
    }
    await capture(page, 'home-desktop');
    assert.deepEqual(errors, []);
  });

  await check('HIG controls and code render loaded Bloxwap faces through --hig-font-* (no host font bridge)', async () => {
    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() => {
      const loaded = new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, '')));
      return [
        ['Get started', document.querySelector('.hero-actions .hig-button')],
        ['install tab', document.querySelector('.package-install [role=tab]')],
        ['code window', document.querySelector('.code-window pre')],
      ].map(([name, el]) => {
        const family = el ? getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/["']/g, '') : '';
        return { name, family, loaded: loaded.has(family), check: el ? document.fonts.check(`600 16px "${family}"`) : false };
      });
    });
    for (const { name, family, loaded, check } of faces) {
      assert.ok(/bloxwap/i.test(family) && loaded && check, `${name} renders ${family || 'nothing'} (loaded ${loaded}, check ${check})`);
    }
    const [sans, , mono] = faces.map((face) => face.family);
    assert.notEqual(sans, mono, 'code uses Bloxwap Mono, controls use Bloxwap Sans');
  });

  await check('install tabs: arrow/Home/End keys move selection and focus', async () => {
    const tabs = page.getByRole('tablist', { name: 'Package manager' });
    const npm = tabs.getByRole('tab', { name: 'npm' });
    const bun = tabs.getByRole('tab', { name: 'bun' });
    await npm.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await bun.getAttribute('aria-selected'), 'true');
    assert.ok(await bun.evaluate((el) => el === document.activeElement));
    await page.keyboard.press('Home');
    assert.equal(await npm.getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await bun.getAttribute('aria-selected'), 'true');
    assert.match(await page.getByRole('tabpanel').filter({ visible: true }).innerText(), /bunx @bloxwap\/agent-cli --help/);
    await page.keyboard.press('Home');
  });

  await check('install command copies to the clipboard and announces the result', async () => {
    await page.getByRole('tabpanel').filter({ visible: true }).getByRole('button', { name: /copy install command/i }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some((s) => /copied/i.test(s.textContent ?? '')));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm install -g @bloxwap/agent-cli');
  });

  await check('hero code window copies the workflow', async () => {
    await page.getByRole('button', { name: 'Copy workflow commands' }).click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('agent-cli schema order'));
  });

  await check('keyboard: Tab reaches the primary actions with a visible focus ring', async () => {
    await page.goto(url('/'));
    let outline = '';
    for (let i = 0; i < 40 && !/Get started/.test(outline); i++) {
      await page.keyboard.press('Tab');
      outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return '';
        const style = getComputedStyle(el);
        return `${el.textContent?.trim()}|${style.outlineStyle}|${style.outlineWidth}`;
      });
    }
    assert.match(outline, /^Get started\|solid\|2px$/, `focused element: ${outline}`);
  });

  await check('search: Ctrl+K opens, finds pages, shows a no-results state and closes with Escape', async () => {
    await page.goto(url('/docs/'));
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await page.keyboard.type('runner');
    await dialog.getByRole('option').first().waitFor();
    await capture(page, 'search-desktop');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('zzqxv nothing matches');
    await dialog.getByText(/no (matching pages|results)/i).first().waitFor();
    await capture(page, 'search-empty-desktop');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  });

  await check('docs page renders', async () => {
    await page.goto(url('/docs/quickstart/'));
    await page.getByRole('heading', { level: 1, name: 'Quickstart' }).waitFor();
    await capture(page, 'quickstart-desktop');
    await page.goto(url('/docs/errors/'));
    await page.locator('#nd-page table').first().waitFor();
    await capture(page, 'errors-desktop');
  });

  await check('404 explains the error and recovers inside the base path', async () => {
    const response = await page.goto(url('/docs/missing-page/'));
    assert.equal(response?.status(), 404);
    const link = page.getByRole('link', { name: 'Open documentation' });
    assert.equal(await link.getAttribute('href'), `${basePath}/docs/`);
    await capture(page, 'not-found-desktop');
    await link.click();
    await page.waitForURL(new RegExp(`${basePath}/docs/?$`));
  });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await mobile.newPage();
  await check('390 px home has no horizontal scroll', async () => {
    await phone.goto(url('/'));
    await noHorizontalScroll(phone);
    await capture(phone, 'home-mobile');
  });
  await check('390 px touch: compact HIG copy controls keep a 48 px target', async () => {
    await phone.goto(url('/'));
    for (const name of ['Copy workflow commands', /copy install command/i]) {
      const box = await phone.getByRole('button', { name }).filter({ visible: true }).first().boundingBox();
      assert.ok(box && box.height >= 48 && box.width >= 48, `${name}: ${box?.width}x${box?.height}`);
    }
  });
  await check('390 px sidebar navigation reaches a deep link', async () => {
    await phone.goto(url('/docs/'));
    await noHorizontalScroll(phone);
    await phone.getByRole('button', { name: /open sidebar|toggle sidebar/i }).first().click();
    const link = phone.getByRole('link', { name: 'Runner and JSON-RPC', exact: true }).filter({ visible: true }).first();
    await link.waitFor();
    await capture(phone, 'mobile-nav');
    await link.click();
    await phone.waitForURL(new RegExp(`${basePath}/docs/runner/?$`));
    await phone.getByRole('heading', { level: 1 }).waitFor();
    await noHorizontalScroll(phone);
  });
  await mobile.close();

  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const still = await reduced.newPage();
  await check('reduced motion: HIG motion roles drop to 0 ms', async () => {
    await still.goto(url('/'));
    const motion = await still.evaluate(() => ({
      role: getComputedStyle(document.documentElement).getPropertyValue('--hig-motion-duration-fast').trim(),
      link: getComputedStyle(document.querySelector('.guide-links a')).transitionDuration,
    }));
    assert.match(motion.role, /^0m?s$/, `--hig-motion-duration-fast is ${motion.role}`); // the CSS minifier writes 0ms as 0s
    assert.match(motion.link, /^0s(, 0s)*$/);
  });
  await reduced.close();
} finally {
  await browser.close();
  server.kill();
}
console.log(results.join('\n'));
