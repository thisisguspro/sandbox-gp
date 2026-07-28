// SANDBOX GP — authenticated screenshot harness.
// LESSON: dev_auto only self-drives the CAR. Without a real token injected the
// app sits on the sign-in screen — every "verified" shot was a login page.
import { chromium } from '../bridge-client/node_modules/playwright-core/index.mjs';
const BASE = 'http://localhost:8080';
const login = await fetch(`${BASE}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Shot' }) }).then(r => r.json());
if (!login?.token) { console.log('NO TOKEN — abort'); process.exit(1); }

export async function newShotPage(browser, query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0, 100)));
  await page.addInitScript((tok) => { sessionStorage.setItem('bridge_token', tok); window.__gpAuto = true; }, login.token);
  await page.goto(BASE + '?dev_auto=1' + query, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  const txt = await page.locator('body').innerText();
  if (/PLAY AS GUEST|Roll in/i.test(txt) && !/QUICK PLAY/i.test(txt)) console.log('WARNING: still on sign-in!');
  return page;
}
export { chromium, BASE };
