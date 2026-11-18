/* End-to-end browser test: three phones play through every major feature.
 * Usage: npm run build && node tests/e2e/e2e.cjs [screenshotDir]
 * Needs Playwright + Chromium available (npx playwright install chromium).
 */
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 4300 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] || path.join(os.tmpdir(), '1poker-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
const steps = [];
const stalls = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}
async function step(name, fn) {
  const t = Date.now();
  process.stdout.write(`• ${name} … `);
  await fn();
  steps.push(name);
  console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

async function until(fn, ms = 30000, label = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error('timeout: ' + label);
    await sleep(150);
  }
}

const vis = async (page, sel) => (await page.locator(sel).count()) > 0 && (await page.locator(sel).first().isVisible().catch(() => false));
const feltGame = (page) => page.locator('.felt-game').innerText().catch(() => '');

/** Make one move if it is this player's turn. Strategy: passive (check/call), TP: see+chaal or show. */
async function autoMove(page, opts = {}) {
  if (opts.passive) return null;
  // discard step
  if (!opts.skipDiscard && (await vis(page, '.discard-hint'))) {
    const hint = await page.locator('.discard-hint').innerText();
    const n = Number(/Tap (\d)/.exec(hint)?.[1] || 0);
    const cards = page.locator('.hero-hand .card');
    for (let i = 0; i < n; i++) await cards.nth(i).click();
    await page.locator('.action-area .btn-gold').click();
    await until(async () => !(await vis(page, '.discard-hint')), 5000, 'discard accepted');
    return 'discard';
  }
  if (await vis(page, '.modal .btn-call')) {
    await page.locator('.modal .btn-call').click(); // accept side show
    return 'sideshow';
  }
  if (!(await vis(page, '.status-line b:text("Your turn")'))) return null;
  if (await vis(page, '.btn-act.btn-show')) {
    await page.locator('.btn-act.btn-show').click();
    return 'show';
  }
  if (await vis(page, '.btn-act.btn-see')) {
    // Teen Patti: look at cards first
    if ((await page.locator('.btn-act.btn-see').first().innerText()).includes('See')) {
      await page.locator('.btn-act.btn-see').first().click();
      await sleep(200);
    }
  }
  if (opts.raise && (await vis(page, '.action-area .btn-act.btn-raise:not([disabled])'))) {
    await page.locator('.action-area .btn-act.btn-raise').click();
    if (await vis(page, '.raise-panel')) {
      const preset = page.locator('.preset', { hasText: opts.raise });
      if (await preset.count()) await preset.first().click();
      if (opts.shot) await page.screenshot({ path: path.join(SHOTS, opts.shot) });
      await page.locator('.raise-panel .btn-act').last().click();
    }
    return 'raise';
  }
  for (const sel of ['.action-area .btn-act.btn-check', '.action-area .btn-act.btn-call', '.action-area .btn-act.btn-allin']) {
    if (await vis(page, sel)) {
      await page.locator(sel).first().click();
      return sel;
    }
  }
  return null;
}

/** Keep everyone playing until `done()` is true. */
async function playUntil(pages, done, ms = 60000, label = 'hand', opts = () => ({})) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error('timeout playing until ' + label);
    for (const p of pages) {
      const t = Date.now();
      await autoMove(p, opts(p)).catch((e) => stalls.push(`${p.name}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 600)}`));
      if (Date.now() - t > 5000) stalls.push(`${p.name}: slow move ${Date.now() - t}ms`);
    }
    await sleep(250);
  }
}

async function handOver(page) {
  // the previous hand's banner can still be fading out, so rely on the between-hands status
  return (await vis(page, '.win-banner')) && (await vis(page, '.status-line:has-text("Next hand in")'));
}

async function openHost(page) {
  await page.click('button[aria-label=Menu]');
  await page.click('text=Host controls');
  await page.waitForSelector('text=Save changes');
}

(async () => {
  const server = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => errors.push('server: ' + d));
  await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));

  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name, device = devices['iPhone 13']) => {
    const ctx = await browser.newContext({ ...device, permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
    page.name = name;
    return page;
  };
  const [host, amit, priya] = [await mk('Hriday'), await mk('Amit'), await mk('Priya')];
  const all = [host, amit, priya];
  let code = '';

  try {
    await step('home screen + profile', async () => {
      await host.goto(BASE);
      await host.waitForSelector('#pname');
      await host.screenshot({ path: path.join(SHOTS, '01-profile.png') });
      await host.fill('#pname', 'Hriday');
      await host.click("text=Let's play");
      await host.waitForSelector('text=Create a room');
      await host.screenshot({ path: path.join(SHOTS, '02-home.png') });
    });

    await step('create a custom room', async () => {
      await host.click('text=Create a room');
      await host.waitForSelector('text=Room type');
      await host.screenshot({ path: path.join(SHOTS, '03-create.png'), fullPage: true });
      await host.click('text=Create room & get code');
      await host.waitForURL(/\/r\/[A-Z0-9]{5}$/);
      code = host.url().split('/r/')[1];
      await host.waitForSelector('.lc-code');
      ok((await host.locator('.lc-code').innerText()) === code, 'lobby shows code');
      await host.screenshot({ path: path.join(SHOTS, '04-lobby.png') });
    });

    await step('friends join with the code and sit', async () => {
      for (const [p, n] of [[amit, 'Amit'], [priya, 'Priya']]) {
        await p.goto(BASE);
        await p.fill('#pname', n);
        await p.click("text=Let's play");
        await p.fill('input[aria-label="Room code"]', code.toLowerCase());
        await p.click('text=Join table');
        await p.waitForSelector('.empty-seat.can');
      }
      await amit.locator('.empty-seat.can').nth(2).click(); // pick a specific seat
      await priya.click('text=Sit anywhere');
      await until(async () => (await host.locator('.seat .plate').count()) === 3, 10000, 'three seated');
    });

    await step('start game, raise with the slider presets, others call', async () => {
      await host.click('button:has-text("Start game")');
      await host.waitForSelector('.hero-hand .card');
      let raised = false;
      await playUntil(all, () => handOver(host), 90000, 'first hand', (p) => (p === host && !raised ? ((raised = true), { raise: '3×', shot: '05-raise-panel.png' }) : {}));
      await host.screenshot({ path: path.join(SHOTS, '06-showdown-holdem.png') });
      ok((await host.locator('.win-banner').count()) === 1, 'winner banner');
    });

    await step('host switches to Irish Poker; discard two after the flop', async () => {
      await openHost(host);
      await host.locator('.game-tile', { hasText: 'Irish Poker' }).click();
      await host.click('text=Save changes');
      await until(async () => (await feltGame(host)).includes('IRISH'), 30000, 'irish hand');
      ok((await host.locator('.hero-hand .card').count()) === 4, 'four hole cards');
      let shot = false;
      await playUntil(all, async () => {
        if (!shot && (await vis(host, '.discard-hint'))) {
          await host.locator('.hero-hand .card').nth(0).click();
          await host.locator('.hero-hand .card').nth(1).click();
          await host.screenshot({ path: path.join(SHOTS, '07-irish-discard.png') });
          await host.locator('.action-area .btn-gold').click();
          await until(async () => !(await vis(host, '.discard-hint')), 5000, 'host discard accepted');
          shot = true;
        }
        return handOver(host);
      }, 120000, 'irish hand', (p) => (p === host && !shot ? { skipDiscard: true } : {}));
      ok(shot, 'saw the discard step');
      ok((await host.locator('.hero-hand .card').count()) === 2, 'two cards after discard');
    });

    await step('Omaha 5 Hi-Lo, double board', async () => {
      await openHost(host);
      await host.locator('.game-tile', { hasText: 'Omaha' }).click();
      await host.click('text=5 cards (PLO5)');
      await host.locator('.setting-row', { hasText: 'Hi-Lo split pot' }).locator('.toggle').click();
      await host.locator('.seg button', { hasText: 'Double' }).click();
      await host.click('text=Save changes');
      await until(async () => (await feltGame(host)).includes('OMAHA 5 HI-LO'), 30000, 'omaha hand');
      ok((await host.locator('.hero-hand .card').count()) === 5, 'five hole cards');
      await playUntil(all, () => handOver(host), 120000, 'omaha hand');
      ok((await host.locator('.board').count()) === 2, 'two boards');
      await host.screenshot({ path: path.join(SHOTS, '08-omaha-double-board.png') });
    });

    await step('Teen Patti: blind, see, chaal, show', async () => {
      await openHost(host);
      await host.locator('.game-tile', { hasText: 'Teen Patti' }).first().click();
      await host.click('text=Save changes');
      await until(async () => (await feltGame(host)).includes('TEEN PATTI'), 30000, 'teen patti hand');
      ok((await host.locator('.stake-info').count()) === 1, 'stake info');
      await host.screenshot({ path: path.join(SHOTS, '09-teenpatti-blind.png') });
      // one player packs so the hand reaches a two-player show
      let packed = false;
      await playUntil(all, async () => {
        if (!packed && (await vis(priya, '.status-line b:text("Your turn")')) && (await vis(priya, '.btn-act.btn-fold'))) {
          await priya.locator('.btn-act.btn-fold').click();
          packed = true;
        }
        return handOver(host);
      }, 120000, 'teen patti hand', (p) => (p === priya && !packed ? { passive: true } : {}));
      await host.screenshot({ path: path.join(SHOTS, '10-teenpatti-show.png') });
    });

    await step('chat: text, emoji, sound sticker, spoken phrase', async () => {
      await amit.click('button[aria-label=Chat]');
      await amit.fill('input[placeholder=Message]', 'nice hand bro 😂');
      await amit.keyboard.press('Enter');
      await until(async () => (await amit.locator('.bubble', { hasText: 'nice hand bro' }).count()) > 0, 5000, 'own message');
      await amit.click('.sheet button[aria-label=Close]');
      await until(async () => (await host.locator('.badge').count()) > 0, 5000, 'unread badge on host');
      await sleep(300);
      await amit.click('button[aria-label=Reactions]');
      await amit.locator('.quick-emojis button').first().click();
      await until(async () => (await host.locator('.seat-bubble').count()) > 0, 5000, 'emoji bubble over seat');
      await host.screenshot({ path: path.join(SHOTS, '11-emoji-bubble.png') });
      await sleep(400);
      await amit.click('button[aria-label=Reactions]');
      await amit.locator('.quick-row .chip-btn', { hasText: 'Air horn' }).click();
      await sleep(400);
      await amit.click('button[aria-label=Reactions]');
      await amit.locator('.quick-row .chip-btn', { hasText: 'All in!' }).click();
      await until(async () => (await host.locator('.sb-text', { hasText: 'All in!' }).count()) > 0, 5000, 'phrase bubble');
    });

    await step('stickers: upload an image sticker and send it', async () => {
      const png = path.join(SHOTS, 'sticker.png');
      await host.screenshot({ path: png, clip: { x: 0, y: 0, width: 120, height: 120 } });
      await priya.click('button[aria-label=Chat]');
      await priya.locator('.chat-tabs button', { hasText: 'Stickers' }).click();
      await priya.locator('input[type=file][multiple]').setInputFiles(png);
      await until(async () => (await priya.locator('.sticker-grid .sticker-cell img').count()) > 0, 10000, 'sticker saved');
      await priya.screenshot({ path: path.join(SHOTS, '12-stickers.png') });
      await priya.locator('.sticker-grid .sticker-cell:not(.add)').first().click();
      await until(async () => (await host.locator('.seat-bubble img.sb-sticker').count()) > 0, 8000, 'sticker bubble');
    });

    await step('sound sticker maker: record a sound onto an emoji', async () => {
      await priya.click('button[aria-label=Chat]');
      await priya.locator('.chat-tabs button', { hasText: 'Sounds' }).click();
      await priya.locator('.sticker-cell.add', { hasText: 'Create' }).click();
      await priya.click('text=🎙️ Record');
      await sleep(1200);
      await priya.locator('button', { hasText: 'Stop' }).click();
      await priya.waitForSelector('text=▶ Play sound');
      await priya.fill('input[placeholder*="FAAAH"]', 'FAAAH');
      await priya.screenshot({ path: path.join(SHOTS, '13-sound-maker.png') });
      await priya.click('text=Save sticker');
      await until(async () => (await priya.locator('.sticker-cell .slbl', { hasText: 'FAAAH' }).count()) > 0, 5000, 'sound sticker listed');
      await priya.locator('.sticker-cell', { hasText: 'FAAAH' }).click();
      await until(async () => (await amit.locator('.seat-bubble .sb-emoji').count()) > 0, 8000, 'sound sticker arrives');
    });

    await step('voice note and face snap (fake mic & camera)', async () => {
      await host.click('button[aria-label=Chat]');
      await host.click('button[aria-label="Record voice note"]');
      await sleep(1500);
      await host.click('button[aria-label="Send voice note"]');
      await until(async () => (await amit.locator('.sb-voice').count()) > 0, 10000, 'voice bubble');
      await host.click('button[aria-label="Face snap"]');
      await host.waitForSelector('button:has-text("Snap"):not([disabled])', { timeout: 10000 });
      await host.click('button:has-text("Snap")');
      await host.click('text=Send face');
      await until(async () => (await amit.locator('.sb-face').count()) > 0, 10000, 'face bubble');
      await amit.screenshot({ path: path.join(SHOTS, '14-face-snap.png') });
      await amit.click('button[aria-label=Chat]');
      await amit.waitForSelector('.voice-msg');
      await amit.screenshot({ path: path.join(SHOTS, '15-chat.png') });
      await amit.click('.sheet button[aria-label=Close]');
    });

    await step('ledger, settings and history sheets', async () => {
      await host.click('button[aria-label=Menu]');
      await host.click('text=Ledger & banks');
      await host.waitForSelector('.ledger-table');
      const rows = await host.locator('.ledger-table tbody tr').count();
      ok(rows === 3, 'three ledger rows');
      await host.screenshot({ path: path.join(SHOTS, '16-ledger.png') });
      await host.click('.sheet button[aria-label=Close]');
      await host.click('button[aria-label=Menu]');
      await host.click('text=Hand history');
      await host.waitForSelector('.hist-item');
      await host.click('.sheet button[aria-label=Close]');
    });

    await step('reload keeps your seat (reconnect)', async () => {
      const before = await amit.locator('.seat.hero .nm').innerText();
      await amit.reload();
      await amit.waitForSelector('.seat.hero', { timeout: 15000 });
      ok((await amit.locator('.seat.hero .nm').innerText()) === before, 'same seat after reload');
    });

    await step("dealer's choice: the dealer picks the next game", async () => {
      await openHost(host);
      await host.locator('.seg button', { hasText: "Dealer's pick" }).click();
      await host.click('text=Save changes');
      let chooser = null;
      await playUntil(all, async () => {
        for (const p of all) if (await vis(p, 'text=Your deal — pick the game')) chooser = p;
        return !!chooser;
      }, 90000, 'chooser modal');
      await chooser.screenshot({ path: path.join(SHOTS, '17-dealers-choice.png') });
      await chooser.locator('.sheet .game-tile', { hasText: 'Crazy Pineapple' }).click();
      await chooser.click('text=Deal it!');
      await until(async () => (await feltGame(host)).includes('CRAZY PINEAPPLE'), 15000, 'chosen game dealt');
      let dealt = 0;
      for (const p of all) if ((await p.locator('.hero-hand .card').count()) === 3) dealt++;
      ok(dealt >= 2, 'Crazy Pineapple deals three hole cards');
      // anyone who busted can take a new bank; it shows as bank #2
      for (const p of all) {
        if (await vis(p, 'button:has-text("Take bank #2")')) {
          await p.click('button:has-text("Take bank #2")');
          await until(async () => (await p.locator('.room-title .t2').innerText()).includes('bank #2'), 5000, 'bank #2 shown');
          await p.screenshot({ path: path.join(SHOTS, '19-bank-2.png') });
        }
      }
    });

    await step('desktop landscape layout', async () => {
      const desk = await mk('Desk', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await desk.goto(BASE);
      await desk.fill('#pname', 'Watcher');
      await desk.click("text=Let's play");
      await desk.goto(`${BASE}/r/${code}`);
      await desk.waitForSelector('.table-area.landscape');
      await sleep(1500);
      await desk.screenshot({ path: path.join(SHOTS, '18-desktop.png') });
    });
  } catch (e) {
    console.log('FAILED');
    console.error(e);
    for (const p of all) await p.screenshot({ path: path.join(SHOTS, `fail-${p.name}.png`) }).catch(() => {});
    errors.push('step failed: ' + e.message);
  }

  await browser.close();
  server.kill();
  console.log(`\n${steps.length} steps passed. Screenshots: ${SHOTS}`);
  if (stalls.length) console.log('STALLS:\n' + [...new Set(stalls)].slice(0, 8).join('\n'));
  if (errors.length) {
    console.log('ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
})();
