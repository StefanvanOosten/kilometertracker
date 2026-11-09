// Tekent de app-iconen met Chrome of Edge: `npm run icons`.
// Ook `node tools/make-icons.mjs --svg` om alleen icons/icon.svg te schrijven.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const POORT = 9346;

const CX = 256;
const CY = 282;
const punt = (graden, r) => {
  const a = (graden * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)].map((v) => v.toFixed(1));
};

function streepjes() {
  const lijnen = [];
  for (let g = 210; g >= -30; g -= 20) {
    const groot = (210 - g) % 60 === 0;
    const [x1, y1] = punt(g, groot ? 104 : 112);
    const [x2, y2] = punt(g, 124);
    lijnen.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${groot ? 9 : 6}"/>`);
  }
  return lijnen.join('');
}

/** `schaal` houdt de tekening binnen de veilige zone; `hoek` is de afronding van de achtergrond. */
function icoon(grootte, { schaal, hoek }) {
  const verschuif = 256 * (1 - schaal);
  const [bx, by] = punt(210, 150);
  const [ex, ey] = punt(-30, 150);
  const [nx, ny] = punt(48, 128);
  const cijfers = ['0', '4', '2', '7'];
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:block" width="${grootte}" height="${grootte}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="achter" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0891b2"/>
      <stop offset=".5" stop-color="#0f766e"/>
      <stop offset="1" stop-color="#1e1b4b"/>
    </linearGradient>
    <radialGradient id="gloed" cx=".85" cy=".1" r=".7">
      <stop offset="0" stop-color="#34d399" stop-opacity=".55"/>
      <stop offset="1" stop-color="#34d399" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="licht" cx=".2" cy=".15" r=".6">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="boog" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#34d399"/>
      <stop offset=".55" stop-color="#facc15"/>
      <stop offset="1" stop-color="#fb923c"/>
    </linearGradient>
    <linearGradient id="vak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset=".5" stop-color="#1f2a40"/>
      <stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
    <filter id="schaduw" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#020617" flood-opacity=".45"/>
    </filter>
    <clipPath id="vorm"><rect width="512" height="512" rx="${hoek}"/></clipPath>
  </defs>
  <g clip-path="url(#vorm)">
    <rect width="512" height="512" fill="url(#achter)"/>
    <rect width="512" height="512" fill="url(#gloed)"/>
    <rect width="512" height="512" fill="url(#licht)"/>
    <g transform="translate(${verschuif} ${verschuif}) scale(${schaal})">
      <g filter="url(#schaduw)">
        <path d="M${bx} ${by}A150 150 0 1 1 ${ex} ${ey}" fill="none" stroke="rgb(255 255 255 / .16)" stroke-width="34" stroke-linecap="round"/>
        <path d="M${bx} ${by}A150 150 0 1 1 ${ex} ${ey}" fill="none" stroke="url(#boog)" stroke-width="34" stroke-linecap="round"
          pathLength="100" stroke-dasharray="72 100"/>
        <g stroke="#e0f2fe" stroke-linecap="round" opacity=".9">${streepjes()}</g>
        <line x1="${CX}" y1="${CY}" x2="${nx}" y2="${ny}" stroke="#fff" stroke-width="16" stroke-linecap="round"/>
        <circle cx="${CX}" cy="${CY}" r="26" fill="#fff"/>
        <circle cx="${CX}" cy="${CY}" r="11" fill="#0f766e"/>
        <g transform="translate(150 336)">
          <rect x="-10" y="-10" width="232" height="86" rx="22" fill="#020617" opacity=".55"/>
          ${cijfers.map((c, i) => `
          <rect x="${i * 54}" y="0" width="46" height="66" rx="10" fill="${i === 3 ? '#f8fafc' : 'url(#vak)'}"/>
          <text x="${i * 54 + 23}" y="49" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="800" font-size="44"
            fill="${i === 3 ? '#0b1220' : '#f8fafc'}">${c}</text>`).join('')}
        </g>
      </g>
    </g>
  </g>
</svg>`;
}

const ICONEN = [
  ['icons/icon-192.png', 192, { schaal: 0.9, hoek: 112 }],
  ['icons/icon-512.png', 512, { schaal: 0.9, hoek: 112 }],
  // Android snijdt deze zelf bij, dus zonder hoeken en met ruimte rondom.
  ['icons/icon-maskable-512.png', 512, { schaal: 0.74, hoek: 0 }],
];

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon.svg', icoon(512, { schaal: 0.9, hoek: 112 }));
if (process.argv.includes('--svg')) process.exit(0);

const browser = BROWSERS.find(existsSync);
if (!browser) throw new Error('Chrome of Edge niet gevonden');

const proces = spawn(browser, ['--headless=new', `--remote-debugging-port=${POORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'km-icoon-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

try {
  let doelen;
  for (let i = 0; i < 50 && !doelen; i += 1) {
    await new Promise((r) => { setTimeout(r, 200); });
    doelen = await fetch(`http://127.0.0.1:${POORT}/json`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const open = new Map();
  ws.onmessage = (m) => {
    const b = JSON.parse(m.data);
    if (b.id) { open.get(b.id)(b.result); open.delete(b.id); }
  };
  const cdp = (method, params = {}) => new Promise((r) => { id += 1; open.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

  await cdp('Page.enable');
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

  for (const [pad, grootte, opties] of ICONEN) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: grootte, height: grootte, deviceScaleFactor: 1, mobile: false });
    const html = `<!doctype html><html style="margin:0;overflow:hidden;background:transparent"><body style="margin:0;background:transparent">${icoon(grootte, opties)}</body></html>`;
    await cdp('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
    await new Promise((r) => { setTimeout(r, 400); });
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(pad, Buffer.from(data, 'base64'));
    console.log(pad);
  }
} finally {
  proces.kill();
}
process.exit(0);
