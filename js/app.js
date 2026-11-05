// 土日和: 画面の組み立て
import {
  ZONES, SOILS, zoneFromMeanTemp, weatherInfo, toDays, judgeDays, nextWorkDay, sunnyStreakStart,
  addDays, diffDays, monthOf, localToday, planSteps, scheduleSteps, seasonalTasks,
} from './logic.js?v=1';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'tsuchibiyori:v1';
const WX_KANJI = { sun: '晴', cloud: '曇', rain: '雨', snow: '雪', fog: '霧', none: '—' };
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

let DATA = { tasks: [], crops: [], plans: {} };
let state = loadState();
let weather = null; // { days(judged), today }

// ---------- 保存 ----------
function loadState() {
  const def = { place: null, zone: 'auto', climate: null, soil: 'normal', plans: [] };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return s ? { ...def, ...s } : def;
  } catch {
    return def;
  }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 保存できない環境でも動かす */ }
}

// ---------- 小道具 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function dow(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function fmt(ymd, withDow = true) {
  const s = `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
  return withDow ? `${s}(${DOW[dow(ymd)]})` : s;
}
function short(ymd) {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${DOW[dow(ymd)]})`;
}
function rel(ymd, today) {
  const n = diffDays(ymd, today);
  return n === 0 ? '今日' : n === 1 ? '明日' : n === 2 ? 'あさって' : `${n}日後`;
}
function zoneNow() {
  if (state.zone !== 'auto') return state.zone;
  return state.climate?.zone ?? 'mid';
}
function todayYmd() {
  return weather?.today ?? localToday(-new Date().getTimezoneOffset() * 60);
}
function taskById(id) {
  return DATA.tasks.find((t) => t.id === id);
}
function cropById(id) {
  return DATA.crops.find((c) => c.id === id);
}
function round2(x) {
  return Math.round(x * 100) / 100; // 約1km。細かすぎる位置は外に出さない
}

// ---------- 外部API ----------
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function searchPlace(q) {
  // 国土地理院 住所検索
  const res = await getJSON(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`);
  return res.slice(0, 8).map((f) => ({
    name: f.properties.title,
    lat: round2(f.geometry.coordinates[1]),
    lon: round2(f.geometry.coordinates[0]),
  }));
}
async function fetchForecast(p) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: p.lat, longitude: p.lon, timezone: 'auto', past_days: 7, forecast_days: 16,
    daily: 'weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min',
  });
  return getJSON(u);
}
async function fetchMeanTemp(p) {
  const y = new Date().getFullYear();
  const u = new URL('https://archive-api.open-meteo.com/v1/archive');
  u.search = new URLSearchParams({
    latitude: p.lat, longitude: p.lon, timezone: 'auto',
    start_date: `${y - 3}-01-01`, end_date: `${y - 1}-12-31`, daily: 'temperature_2m_mean',
  });
  const r = await getJSON(u);
  const v = (r.daily?.temperature_2m_mean ?? []).filter((x) => x != null);
  if (!v.length) throw new Error('no data');
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

// ---------- 画面: 設定 ----------
function renderSettings() {
  $('soilRadios').innerHTML = Object.entries(SOILS).map(([k, s]) =>
    `<label><input type="radio" name="soil" value="${k}" ${state.soil === k ? 'checked' : ''}>${esc(s.label)}</label>`).join('');
  $('zoneSelect').value = state.zone;
  const c = state.climate;
  $('zoneMsg').textContent = c
    ? `この場所の年平均気温はおよそ ${c.meanTemp}℃(過去3年)で、${ZONES[c.zone]}にあたります。`
    : state.place ? '気候を調べています…' : '';
  // 作物の選択肢
  const groups = ['野菜', '果樹'].map((k) => `<optgroup label="${k}">${
    DATA.crops.filter((c2) => c2.kind === k).map((c2) => `<option value="${c2.id}">${esc(c2.name)}</option>`).join('')
  }</optgroup>`).join('');
  if (!$('cropSelect').options.length) $('cropSelect').innerHTML = groups;
  updateCropHint();
  $('planList').innerHTML = state.plans.map((p, i) => {
    const c2 = cropById(p.cropId);
    return `<li><span>${esc(c2?.name ?? p.cropId)} — ${fmt(p.date)} に植える予定</span><button type="button" data-del="${i}" aria-label="${esc(c2?.name)}の予定を消す">消す</button></li>`;
  }).join('');
  const parts = [];
  if (state.place) parts.push(state.place.name);
  parts.push(ZONES[zoneNow()]);
  parts.push(`土: ${SOILS[state.soil].label.replace(/\(.*\)/, '')}`);
  if (state.plans.length) parts.push(`植えたいもの ${state.plans.length}件`);
  $('settingsSummary').textContent = state.place ? parts.join(' / ') : '';
  $('placeLine').hidden = !state.place;
  $('placeLine').textContent = state.place ? `${state.place.name}(${ZONES[zoneNow()]})` : '';
}

function updateCropHint() {
  const c = cropById($('cropSelect').value);
  if (!c) return;
  const zone = zoneNow();
  const months = c.plant[zone] ?? [];
  $('cropHint').textContent = months.length
    ? `${ZONES[zone]}で${c.kind === '果樹' ? '植え付け' : '植え付け・種まき'}に向く月: ${months.map((m) => `${m}月`).join('・')}${c.note ? `。${c.note}` : ''}`
    : `${ZONES[zone]}では地植えに向きません。${c.note ?? ''}`;
  // 予定日の初期値: 向いている月のうち、今日から3週間以上先で最も近い月の15日
  const today = todayYmd();
  const min = addDays(today, 21);
  let best = null;
  for (let k = 0; k < 14 && !best; k++) {
    const y = Number(today.slice(0, 4)) + Math.floor((Number(today.slice(5, 7)) - 1 + k) / 12);
    const m = ((Number(today.slice(5, 7)) - 1 + k) % 12) + 1;
    const cand = `${y}-${String(m).padStart(2, '0')}-15`;
    if (months.includes(m) && cand >= min) best = cand;
  }
  $('plantDate').value = best ?? min;
}

// ---------- 画面: 本体 ----------
function linksHtml(task) {
  if (!task?.links?.length) return '';
  return `<ul class="links">${task.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">
    <span class="src ${l.kind === 'video' ? 'video' : ''}">${esc(l.site)}</span><span class="lt">${esc(l.title)}</span></a></li>`).join('')}</ul>`;
}
function todoItem(task, extra = {}) {
  return `<li${extra.anchor ? ` id="task-${task.id}"` : ''}><p class="tname">${esc(extra.name ?? task.name)}${extra.crop ? `<span class="crop">${esc(extra.crop)}</span>` : ''}</p>
    ${extra.sub ? `<p class="sum">${esc(extra.sub)}</p>` : ''}
    <p class="sum">${esc(task.summary)}</p>${linksHtml(task)}</li>`;
}

function allSteps() {
  if (!weather) return [];
  return state.plans.flatMap((p, i) => {
    const crop = cropById(p.cropId);
    if (!crop) return [];
    const steps = planSteps(crop, p.date, DATA.plans[crop.plan] ?? []);
    return scheduleSteps(steps, weather.days, weather.today).map((s) => ({ ...s, planIndex: i, crop }));
  });
}

function renderNext() {
  const el = $('next');
  el.hidden = false;
  const { days, today } = weather;
  const next = nextWorkDay(days);
  if (!next) {
    el.innerHTML = `<h2>次の作業日</h2><p class="none">この先2週間は、土の作業に向く日が見つかりません。雨が続く予報です。</p>`;
    return;
  }
  const w = weatherInfo(next.code);
  const zone = zoneNow();
  const month = monthOf(next.date);
  const steps = allSteps().filter((s) => s.day === next.date && s.task);
  const items = steps.map((s) => todoItem(taskById(s.task), {
    name: s.name, crop: s.cropName,
    sub: s.status === 'late' ? `本当は${fmt(s.end, false)}までに済ませたい作業です。` : `${s.cropName}を${fmt(s.plantDate, false)}に植える準備です。`,
  }));
  const used = new Set(steps.map((s) => s.task));
  const streak = sunnyStreakStart(days);
  const season = seasonalTasks(DATA.tasks, zone, month).filter((t) => {
    if (used.has(t.id)) return false;
    if (t.weather === 'streak' && streak?.date !== next.date) return false;
    // 植え付けの段取りがあるときは、石灰・堆肥などは段取りの日に任せる
    return !(state.plans.length && ['lime', 'compost', 'bed', 'ph'].includes(t.id));
  });
  // 季節の作業は名前だけ並べ、説明とリンクは下の「○月の土づくり」に任せる
  const seasonHtml = season.length
    ? `<p class="also">${items.length ? 'ほかに、' : ''}この季節の作業: ${season.map((t) => `<a href="#task-${t.id}">${esc(t.name)}</a>`).join('・')}</p>` : '';
  el.innerHTML = `<h2>次の作業日</h2>
    <div class="when"><span class="wx ${w.kind}" aria-hidden="true">${WX_KANJI[w.kind]}</span>
      <span class="date">${fmt(next.date)}</span><span class="rel">${rel(next.date, today)}・${w.label}</span></div>
    <p class="why">${esc(next.reason)}。${next.tmax != null ? `最高 ${Math.round(next.tmax)}℃ / 最低 ${Math.round(next.tmin)}℃` : ''}</p>
    ${items.length ? `<h3>この日にすること</h3><ul class="todo">${items.join('')}</ul>` : ''}
    ${seasonHtml}
    ${!items.length && !season.length ? '<p class="muted">今の時期に急ぐ土の作業はありません。</p>' : ''}
    ${!state.plans.length ? '<p class="muted">「設定」の「植えたいもの」を加えると、植え付けまでの段取りをこの日に割り当てます。</p>' : ''}`;
}

function renderStrip() {
  $('days').hidden = false;
  const { days, today } = weather;
  const list = days.filter((d) => !d.past).slice(0, 14);
  $('strip').innerHTML = list.map((d) => {
    const w = weatherInfo(d.code);
    const dw = dow(d.date);
    const amt = d.prob != null ? `${d.prob}%` : `${Math.round(d.precip)}mm`;
    const mk = d.grade === 'best' ? '◎' : d.grade === 'ok' ? '○' : '—';
    return `<li><button type="button" class="${d.grade}" data-date="${d.date}" aria-pressed="false"
      aria-label="${fmt(d.date)} ${w.label} ${d.workable ? '作業できる' : '作業に向かない'}">
      <span class="d">${d.date === today ? '今日' : `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`}</span>
      <span class="dow ${dw === 0 ? 'sun' : dw === 6 ? 'sat' : ''}">${DOW[dw]}</span>
      <span class="wx ${w.kind}" aria-hidden="true">${WX_KANJI[w.kind]}</span>
      <span class="rain-amt">${amt}</span>
      <span class="m mark ${d.grade}" aria-hidden="true">${mk}</span></button></li>`;
  }).join('');
  $('dayDetail').textContent = '日付を押すと、その日の判定の理由が出ます。';
}

function showDay(date) {
  const d = weather.days.find((x) => x.date === date);
  if (!d) return;
  for (const b of $('strip').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.date === date));
  const w = weatherInfo(d.code);
  const rain = d.prob != null ? `降水確率 ${d.prob}%` : `降水量 ${d.precip}mm`;
  $('dayDetail').textContent = `${fmt(d.date)} ${w.label}・${rain} — ${d.reason}`;
}

function renderPlans() {
  const el = $('plans');
  const steps = allSteps();
  if (!state.plans.length) {
    el.hidden = false;
    el.innerHTML = `<h2>植え付けまでの段取り</h2><p class="muted">「設定」の「植えたいもの」で作物と植え付け予定日を選ぶと、石灰・堆肥・畝立ての日を天気に合わせて割り当てます。</p>`;
    return;
  }
  el.hidden = false;
  const label = (s) => {
    switch (s.status) {
      case 'planned': return [short(s.day), `${short(s.start)}〜${short(s.end)}の間で天気の良い日`];
      case 'late': return [s.day ? short(s.day) : '早めに', `予定(〜${short(s.end)})より遅れています`];
      case 'nowork': return ['日を探し中', `${short(s.start)}〜${short(s.end)}の間に、条件に合う作業日がまだありません`];
      case 'future': return [`${short(s.start)}〜`, `${short(s.end)}まで。予報が出たら日を決めます`];
      case 'fixed': return [short(s.start), '予定日'];
      case 'done': return [short(s.start), '予定日を過ぎました'];
      default: return ['', ''];
    }
  };
  el.innerHTML = `<h2>植え付けまでの段取り</h2>${state.plans.map((p, i) => {
    const c = cropById(p.cropId);
    const ss = steps.filter((s) => s.planIndex === i);
    return `<div class="plan"><h3>${esc(c?.name)} — ${fmt(p.date)} に植える</h3>${c?.note ? `<p class="note">${esc(c.note)}</p>` : ''}
      <ol class="steps">${ss.map((s) => { const [a, b] = label(s); return `<li class="${s.status}"><span class="sd">${a}</span><span>${esc(s.name)}<span class="sub">${b}</span></span></li>`; }).join('')}</ol></div>`;
  }).join('')}`;
}

function renderSeason() {
  const el = $('season');
  const zone = zoneNow();
  const m = monthOf(todayYmd());
  const list = seasonalTasks(DATA.tasks, zone, m);
  el.hidden = false;
  el.innerHTML = `<h2>${m}月の土づくり(${ZONES[zone]})</h2>${list.length
    ? `<ul class="todo">${list.map((t) => todoItem(t, { anchor: true })).join('')}</ul>`
    : '<p class="muted">この月に決まった土の作業はありません。</p>'}`;
}

function renderAll() {
  renderSettings();
  $('setup').hidden = !!state.place;
  if (!state.place) {
    for (const id of ['next', 'days', 'plans']) $(id).hidden = true;
    renderSeason();
    $('settings').open = true;
    return;
  }
  renderSeason();
  if (weather) {
    renderNext();
    renderStrip();
    renderPlans();
  }
}

// ---------- 読み込み ----------
async function loadWeather() {
  if (!state.place) return;
  $('next').hidden = false;
  $('next').innerHTML = '<h2>次の作業日</h2><p class="muted">天気予報を読み込んでいます…</p>';
  try {
    const f = await fetchForecast(state.place);
    const today = localToday(f.utc_offset_seconds ?? 32400);
    weather = { today, days: judgeDays(toDays(f.daily, today), state.soil), raw: f };
  } catch (e) {
    weather = null;
    $('next').innerHTML = `<h2>次の作業日</h2><p class="none">天気予報を読み込めませんでした(${esc(e.message)})。電波の良い所でもう一度開いてください。</p>`;
  }
  renderAll();
}

async function loadClimate() {
  const p = state.place;
  if (!p || (state.climate && state.climate.lat === p.lat && state.climate.lon === p.lon)) return;
  try {
    const t = await fetchMeanTemp(p);
    state.climate = { lat: p.lat, lon: p.lon, meanTemp: t, zone: zoneFromMeanTemp(t) };
    saveState();
  } catch {
    $('zoneMsg').textContent = '気候を調べられませんでした。地域区分を手で選んでください。';
    return;
  }
  renderAll();
}

function setPlace(p) {
  state.place = p;
  saveState();
  $('placeResults').innerHTML = '';
  $('placeMsg').textContent = `「${p.name}」にしました。`;
  $('settings').open = false;
  renderAll();
  loadClimate();
  loadWeather();
}

function bind() {
  $('placeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('placeInput').value.trim();
    if (!q) return;
    $('placeMsg').textContent = '探しています…';
    $('placeResults').innerHTML = '';
    try {
      const rs = await searchPlace(q);
      if (!rs.length) { $('placeMsg').textContent = '見つかりませんでした。市区町村名で試してください。'; return; }
      $('placeMsg').textContent = rs.length > 1 ? '当てはまる場所を選んでください。' : '';
      if (rs.length === 1) return setPlace(rs[0]);
      $('placeResults').innerHTML = rs.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join('');
      $('placeResults').onclick = (ev) => {
        const b = ev.target.closest('button[data-i]');
        if (b) setPlace(rs[Number(b.dataset.i)]);
      };
    } catch (err) {
      $('placeMsg').textContent = `検索できませんでした(${err.message})。`;
    }
  });
  $('geoBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { $('placeMsg').textContent = 'この端末では現在地を使えません。'; return; }
    $('placeMsg').textContent = '現在地を調べています…';
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ name: '現在地', lat: round2(pos.coords.latitude), lon: round2(pos.coords.longitude) }),
      () => { $('placeMsg').textContent = '現在地を使えませんでした。住所で探してください。'; },
      { timeout: 10000, maximumAge: 600000 },
    );
  });
  $('zoneSelect').addEventListener('change', (e) => { state.zone = e.target.value; saveState(); renderAll(); });
  $('soilRadios').addEventListener('change', (e) => {
    if (e.target.name !== 'soil') return;
    state.soil = e.target.value;
    saveState();
    if (weather) weather.days = judgeDays(weather.days, state.soil);
    renderAll();
  });
  $('cropSelect').addEventListener('change', updateCropHint);
  $('planForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const cropId = $('cropSelect').value;
    const date = $('plantDate').value;
    if (!cropId || !date) return;
    state.plans.push({ cropId, date });
    state.plans.sort((a, b) => a.date.localeCompare(b.date));
    saveState();
    renderAll();
  });
  $('planList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-del]');
    if (!b) return;
    state.plans.splice(Number(b.dataset.del), 1);
    saveState();
    renderAll();
  });
  $('strip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-date]');
    if (b) showDay(b.dataset.date);
  });
}

async function main() {
  const [t, c] = await Promise.all([getJSON('data/tasks.json?v=1'), getJSON('data/crops.json?v=1')]);
  DATA = { tasks: t.tasks, crops: c.crops, plans: c.plans };
  bind();
  renderAll();
  if (state.place) {
    loadClimate();
    loadWeather();
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
main();
