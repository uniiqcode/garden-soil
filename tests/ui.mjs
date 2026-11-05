// 画面の動作確認: 外部API(天気・住所検索)を試験データに差し替えて開き、スクリーンショットを撮る
// 使い方: python3 -m http.server 8080 を別に起動してから node tests/ui.mjs [出力フォルダ]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // 環境に入っている Playwright を使う
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'tests/out';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:8080/';

function ymd(offset) {
  const t = new Date(Date.now() + 9 * 3600e3 + offset * 86400e3);
  return t.toISOString().slice(0, 10);
}
// 過去7日 + 16日。2日前と昨日が雨、今日は晴れ、5〜6日後にまた雨
function forecast() {
  const time = [], code = [], pr = [], prob = [], tmax = [], tmin = [];
  for (let i = -7; i < 16; i++) {
    time.push(ymd(i));
    const rain = i === -2 || i === -1 || i === 5 || i === 6;
    const cloudy = i === 3 || i === 9;
    code.push(rain ? 61 : cloudy ? 3 : i % 4 === 0 ? 2 : 1);
    pr.push(rain ? (i === -1 ? 12.5 : 6) : 0);
    prob.push(i < 0 ? null : rain ? 80 : cloudy ? 30 : 10);
    tmax.push(17 - i * 0.2); tmin.push(8 - i * 0.2);
  }
  return { utc_offset_seconds: 32400, daily: { time, weather_code: code, precipitation_sum: pr, precipitation_probability_max: prob, temperature_2m_max: tmax, temperature_2m_min: tmin } };
}

const browser = await chromium.launch();
const errors = [];
async function page(opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('requestfailed', (r) => !r.url().includes('fonts.g') && errors.push(`${r.url()} ${r.failure()?.errorText}`));
  await p.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: forecast(), headers: { 'access-control-allow-origin': '*' } }));
  await p.route('https://archive-api.open-meteo.com/**', (r) => r.fulfill({ json: { daily: { temperature_2m_mean: Array(1000).fill(16.1) } }, headers: { 'access-control-allow-origin': '*' } }));
  await p.route('https://msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [
    { geometry: { coordinates: [132.7657, 33.8392] }, properties: { title: '愛媛県松山市' } },
    { geometry: { coordinates: [140.1, 38.3] }, properties: { title: '山形県東村山郡' } },
  ], headers: { 'access-control-allow-origin': '*' } }));
  await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
  return p;
}

const p = await page({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
await p.goto(BASE);
await p.waitForSelector('#setup:not([hidden])');
await p.screenshot({ path: `${OUT}/1-first.png`, fullPage: true });

// 場所を探して選ぶ
await p.fill('#placeInput', '松山');
await p.click('#placeForm button');
await p.click('#placeResults button >> nth=0');
await p.waitForSelector('#next .date');
const nextDate = await p.textContent('#next .date');
const why = await p.textContent('#next .why');
console.log('次の作業日:', nextDate, '|', why.trim());
console.log('地域:', await p.textContent('#zoneMsg'));

// 植えたいもの: タマネギを3週間後に
await p.click('#settings summary');
await p.selectOption('#cropSelect', 'onion');
await p.fill('#plantDate', ymd(21));
await p.click('#planForm button');
await p.selectOption('#cropSelect', 'blueberry');
await p.fill('#plantDate', ymd(30));
await p.click('#planForm button');
await p.click('#settings summary');
await p.click('#strip button >> nth=1');
console.log('明日の判定:', await p.textContent('#dayDetail'));
console.log('段取り:', (await p.textContent('#plans')).replace(/\s+/g, ' ').slice(0, 400));
await p.screenshot({ path: `${OUT}/2-main.png`, fullPage: true });

// 再読み込みしても設定が残る
await p.reload();
await p.waitForSelector('#next .date');
console.log('再読み込み後の予定数:', await p.locator('#planList li').count());

// 粘土っぽい土にすると作業日が遅れる
await p.click('#settings summary');
await p.check('input[name=soil][value=clay]');
console.log('粘土の次の作業日:', await p.textContent('#next .date'));

// ダークモード・広い画面
const d = await page({ viewport: { width: 1100, height: 900 }, colorScheme: 'dark', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
await d.addInitScript(() => localStorage.setItem('tsuchibiyori:v1', JSON.stringify({ place: { name: '愛媛県松山市', lat: 33.84, lon: 132.77 }, zone: 'auto', soil: 'normal', plans: [{ cropId: 'tomato', date: '2027-04-25' }] })));
await d.goto(BASE);
await d.waitForSelector('#next .date');
await d.screenshot({ path: `${OUT}/3-dark-wide.png`, fullPage: true });

// 横にはみ出していないか
const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log('横はみ出し(px):', overflow);
console.log('エラー:', errors.length ? errors : 'なし');
await browser.close();
