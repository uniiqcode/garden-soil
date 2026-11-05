// 土日和: 画面に依存しない判定ロジック(Node のテストからも読み込む)
// 仕様は docs/spec.md の「作業日の判定」「地域区分」「段取りの逆算」を参照。

/** 地域区分のキーと表示名 */
export const ZONES = {
  cold: '寒冷地',
  mid: '中間地',
  warm: '暖地',
};

/** 土の種類 → 雨上がりから空ける日数(普通の雨のとき) */
export const SOILS = {
  sandy: { label: '砂っぽい(水はけが良い)', wait: 0 },
  normal: { label: 'ふつう', wait: 1 },
  clay: { label: '粘土っぽい(水はけが悪い)', wait: 2 },
};

export const RAIN_MM = 1; // この量以上で「雨の日」
export const HEAVY_RAIN_MM = 20; // この量以上で「大雨」→ 空ける日数を1日延ばす
export const RAIN_PROB = 50; // 予報の降水確率がこの値以上なら雨の日として扱う

/** 年平均気温(℃)から地域区分を決める */
export function zoneFromMeanTemp(t) {
  if (t == null || Number.isNaN(t)) return null;
  if (t < 12) return 'cold';
  if (t < 17) return 'mid';
  return 'warm';
}

/** WMO 天気コード → { label, kind } kind は sun / cloud / rain / snow / fog */
export function weatherInfo(code) {
  if (code == null) return { label: '—', kind: 'none' };
  if (code <= 1) return { label: '晴れ', kind: 'sun' };
  if (code === 2) return { label: '晴れ時々曇り', kind: 'sun' };
  if (code === 3) return { label: '曇り', kind: 'cloud' };
  if (code === 45 || code === 48) return { label: '霧', kind: 'fog' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: '雪', kind: 'snow' };
  if (code >= 95) return { label: '雷雨', kind: 'rain' };
  return { label: '雨', kind: 'rain' };
}

/** その日が「雨の日」か(実績の降水量、または予報の降水確率で判断) */
export function isRainy(day) {
  if ((day.precip ?? 0) >= RAIN_MM) return true;
  if (day.prob != null && day.prob >= RAIN_PROB) return true;
  const k = weatherInfo(day.code).kind;
  return k === 'rain' || k === 'snow';
}

/**
 * Open-Meteo の daily を、扱いやすい日ごとの配列にする。
 * @param {object} daily  Open-Meteo の daily
 * @param {string} today  'YYYY-MM-DD'(その土地の今日)
 */
export function toDays(daily, today) {
  return daily.time.map((date, i) => ({
    date,
    code: daily.weather_code?.[i] ?? null,
    precip: daily.precipitation_sum?.[i] ?? 0,
    prob: daily.precipitation_probability_max?.[i] ?? null,
    tmax: daily.temperature_2m_max?.[i] ?? null,
    tmin: daily.temperature_2m_min?.[i] ?? null,
    past: date < today,
    today: date === today,
  }));
}

/**
 * 日ごとに「土の作業ができるか」を判定する。
 * ルール: その日が雨でなく、晴れか曇りで、最後の雨の日から必要な日数だけ乾いた日が続いていること。
 * 必要な日数 = 土の種類の基本日数(ふつう1日)+ 最後の雨が大雨なら1日。
 * 例(ふつうの土): 昨日で雨が上がった → 今日は乾かす日 → 明日が作業日。
 * @returns 日ごとに { ...day, rainy, workable, grade, dryDays, need, reason }
 */
export function judgeDays(days, soil = 'normal') {
  const base = SOILS[soil]?.wait ?? 1;
  const out = [];
  let dryRun = 0; // 直前まで続いている雨なしの日数
  let lastRain = null; // 最後の雨の日
  let seenRain = false;
  for (const d of days) {
    const rainy = isRainy(d);
    const need = base + (lastRain && lastRain.precip >= HEAVY_RAIN_MM ? 1 : 0);
    const w = weatherInfo(d.code);
    const skyOk = w.kind === 'sun' || w.kind === 'cloud';
    const frozen = d.tmax != null && d.tmax <= 0;
    // 観測の始めに雨が無かった場合は、十分乾いているとみなす
    const dryDays = seenRain ? dryRun : Math.max(dryRun, 9);
    let workable = false;
    let reason;
    if (rainy) {
      reason = (d.precip ?? 0) >= HEAVY_RAIN_MM ? '大雨' : w.kind === 'snow' ? '雪' : '雨';
    } else if (!skyOk) {
      reason = `${w.label}で作業に向きません`;
    } else if (frozen) {
      reason = '一日中氷点下で土が凍っています';
    } else if (dryDays < need) {
      reason = dryDays === 0 ? '雨がやんで1日目。土がまだぬれています' : `雨がやんで${dryDays + 1}日目。もう少し乾かします`;
    } else {
      workable = true;
      reason = seenRain && dryDays <= need + 1 ? `雨がやんで${dryDays + 1}日目。土がほどよく乾いています` : '土が乾いています';
    }
    const grade = workable ? (w.kind === 'sun' ? 'best' : 'ok') : 'no';
    out.push({ ...d, rainy, workable, grade, dryDays, need, reason });
    if (rainy) {
      dryRun = 0;
      lastRain = d;
      seenRain = true;
    } else {
      dryRun += 1;
    }
  }
  return out;
}

/** 今日以降で最初の作業日(無ければ null) */
export function nextWorkDay(judged) {
  return judged.find((d) => !d.past && d.workable) ?? null;
}

/**
 * 太陽熱消毒を始めるのに良い日: 作業できる日で、そこから先 3 日以上晴れが続く日。
 */
export function sunnyStreakStart(judged, len = 3) {
  for (let i = 0; i < judged.length; i++) {
    const d = judged[i];
    if (d.past || !d.workable) continue;
    const run = judged.slice(i, i + len);
    if (run.length === len && run.every((x) => !x.rainy && weatherInfo(x.code).kind === 'sun')) return d;
  }
  return null;
}

// ---- 日付の小道具 ----
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function diffDays(a, b) {
  const p = (s) => Date.UTC(...s.split('-').map((v, i) => (i === 1 ? v - 1 : +v)));
  return Math.round((p(a) - p(b)) / 86400000);
}
export function monthOf(ymd) {
  return Number(ymd.slice(5, 7));
}
/** UTC からの秒差で、その土地の今日 'YYYY-MM-DD' */
export function localToday(offsetSeconds, now = Date.now()) {
  return new Date(now + offsetSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * 植え付け予定から、土づくりの段取りを逆算する。
 * steps の from/to は植え付け日からの日数(負 = 前)。
 * @param {object} crop   crops.json の1件
 * @param {string} plantDate 'YYYY-MM-DD'
 * @param {object[]} stepDefs crops.json の plans[crop.plan]
 */
export function planSteps(crop, plantDate, stepDefs) {
  return stepDefs
    .filter((s) => !(s.skipIf && crop[s.skipIf]))
    .filter((s) => !(s.onlyIf && !crop[s.onlyIf]))
    .map((s) => ({
      ...s,
      start: addDays(plantDate, s.from),
      end: addDays(plantDate, s.to),
      plantDate,
      cropId: crop.id,
      cropName: crop.name,
    }));
}

/**
 * 段取りの各手順に、予報の範囲内で作業日を割り当てる。
 * 手順の期間内で、前の手順から gap 日以上あとの最初の作業日。
 * 期間を過ぎた手順は、今日から1週間以内の最初の作業日を「遅れ」として割り当てる。
 */
export function scheduleSteps(steps, judged, today) {
  const work = judged.filter((d) => !d.past && d.workable);
  const lastForecast = judged.length ? judged[judged.length - 1].date : today;
  let prev = null;
  return steps.map((s) => {
    // 前の手順から gap 日あける(石灰→堆肥は7日など)。gap 未指定は翌日以降。
    const after = prev ? addDays(prev, s.gap ?? 1) : today;
    const floor = after > today ? after : today;
    let day = null;
    let status;
    if (s.end < today) {
      day = work.find((d) => d.date >= floor && d.date <= addDays(today, 7)) ?? null;
      status = 'late';
    } else if (s.start > lastForecast) {
      status = 'future';
    } else {
      day = work.find((d) => d.date >= floor && d.date >= s.start && d.date <= s.end) ?? null;
      status = day ? 'planned' : 'nowork';
    }
    if (s.noWeather) {
      // 植え付けそのものは予定日に固定
      day = null;
      status = s.start < today ? 'done' : 'fixed';
    }
    if (day) prev = day.date;
    return { ...s, day: day ? day.date : null, status };
  });
}

/** 今の月・地域区分に合う季節の作業 */
export function seasonalTasks(tasks, zone, month) {
  return tasks.filter((t) => t.months?.[zone]?.includes(month));
}
