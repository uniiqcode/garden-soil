// node --test tests/ で実行
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeDays, nextWorkDay, zoneFromMeanTemp, planSteps, scheduleSteps, sunnyStreakStart, addDays, diffDays, toDays,
} from '../js/logic.js';

// 晴れ=1, 曇り=3, 雨=61
const day = (date, code, precip = 0, prob = null, past = false) => ({ date, code, precip, prob, tmax: 15, tmin: 5, past, today: false });

test('ふつうの土: 昨日で雨が上がったら、明日が作業日', () => {
  const days = [
    day('2026-11-03', 61, 8, null, true), // おととい 雨
    day('2026-11-04', 61, 5, null, true), // 昨日 雨(ここで上がる)
    day('2026-11-05', 1, 0, 10), // 今日 晴れ(雨がやんで1日目)
    day('2026-11-06', 1, 0, 10), // 明日 晴れ
  ];
  const j = judgeDays(days, 'normal');
  assert.equal(j[2].workable, false);
  assert.match(j[2].reason, /雨がやんで1日目/);
  assert.equal(j[3].workable, true);
  assert.equal(nextWorkDay(j).date, '2026-11-06');
});

test('砂っぽい土は雨の翌日から、粘土っぽい土はさらに1日あける', () => {
  const days = [
    day('2026-11-04', 61, 5, null, true),
    day('2026-11-05', 1),
    day('2026-11-06', 1),
    day('2026-11-07', 1),
  ];
  assert.equal(nextWorkDay(judgeDays(days, 'sandy')).date, '2026-11-05');
  assert.equal(nextWorkDay(judgeDays(days, 'clay')).date, '2026-11-07');
});

test('大雨のあとは1日長く乾かす', () => {
  const days = [
    day('2026-11-04', 63, 35, null, true),
    day('2026-11-05', 1),
    day('2026-11-06', 1),
    day('2026-11-07', 1),
  ];
  assert.equal(nextWorkDay(judgeDays(days, 'normal')).date, '2026-11-07');
});

test('降水確率が高い日・曇りの日・霧の日の扱い', () => {
  const days = [
    day('2026-11-01', 1, 0, null, true),
    day('2026-11-02', 1, 0, null, true),
    day('2026-11-05', 3, 0, 60), // 曇りでも確率60% → 雨扱い
    day('2026-11-06', 45, 0, 10), // 霧
    day('2026-11-07', 3, 0, 20), // 曇り → 作業はできる(○)
  ];
  const j = judgeDays(days, 'sandy');
  assert.equal(j[2].rainy, true);
  assert.equal(j[3].workable, false);
  assert.equal(j[4].workable, true);
  assert.equal(j[4].grade, 'ok');
});

test('しばらく雨が無ければ、いつでも作業できる', () => {
  const days = [day('2026-11-04', 1, 0, null, true), day('2026-11-05', 1), day('2026-11-06', 2)];
  const j = judgeDays(days, 'clay');
  assert.equal(nextWorkDay(j).date, '2026-11-05');
  assert.equal(j[1].grade, 'best');
});

test('地域区分のしきい値', () => {
  assert.equal(zoneFromMeanTemp(9.5), 'cold');
  assert.equal(zoneFromMeanTemp(11.99), 'cold');
  assert.equal(zoneFromMeanTemp(12), 'mid');
  assert.equal(zoneFromMeanTemp(16.4), 'mid');
  assert.equal(zoneFromMeanTemp(17), 'warm');
  assert.equal(zoneFromMeanTemp(null), null);
});

const vegPlan = [
  { task: 'ph', name: 'pH', from: -28, to: -15, skipIf: 'noLime' },
  { task: 'lime', name: '石灰', from: -21, to: -10, gap: 0, skipIf: 'noLime' },
  { task: 'compost', name: '堆肥', from: -10, to: -5, gap: 7 },
  { task: 'bed', name: '畝', from: -6, to: -1 },
  { task: null, name: '植え付け', from: 0, to: 0, noWeather: true },
];

test('段取りの逆算: 石灰を入れない作物は石灰とpHを飛ばす', () => {
  const s1 = planSteps({ id: 'tomato', name: 'トマト' }, '2026-12-01', vegPlan);
  assert.deepEqual(s1.map((s) => s.task), ['ph', 'lime', 'compost', 'bed', null]);
  assert.equal(s1[1].start, '2026-11-10');
  assert.equal(s1[1].end, '2026-11-21');
  const s2 = planSteps({ id: 'potato', name: 'ジャガイモ', noLime: true }, '2026-12-01', vegPlan);
  assert.deepEqual(s2.map((s) => s.task), ['compost', 'bed', null]);
});

test('段取りの割り当て: 期間内の作業日に、順番を守って入れる', () => {
  const today = '2026-11-05';
  const days = [];
  for (let i = 0; i < 20; i++) {
    const date = addDays(today, i);
    const rainy = i === 3 || i === 4; // 11/8, 11/9 雨
    days.push(day(date, rainy ? 61 : 1, rainy ? 10 : 0, rainy ? 80 : 10));
  }
  days[0].today = true;
  const j = judgeDays(days, 'normal');
  const steps = planSteps({ id: 'x', name: 'X' }, '2026-11-25', vegPlan);
  const sch = scheduleSteps(steps, j, today);
  const by = Object.fromEntries(sch.map((s) => [s.name, s]));
  // pH: 10/28〜11/10 → 期間内の最初の作業日 11/5
  assert.equal(by.pH.day, '2026-11-05');
  // 石灰: 11/4〜11/15 → pHを測った同じ日にまいてよい(gap 0)
  assert.equal(by['石灰'].day, '2026-11-05');
  // 堆肥: 11/15〜11/20
  assert.equal(by['堆肥'].day, '2026-11-15');
  assert.equal(by['畝'].day, '2026-11-19');
  assert.equal(by['植え付け'].status, 'fixed');
  // 雨の翌日(11/10)は作業日にならない
  assert.equal(j.find((d) => d.date === '2026-11-10').workable, false);
});

test('段取り: 石灰が遅れても、堆肥は石灰から7日あける', () => {
  const today = '2026-11-05';
  const days = [];
  for (let i = 0; i < 16; i++) days.push(day(addDays(today, i), 1, 0, 10));
  const j = judgeDays(days, 'normal');
  // 植え付け 11/15 → 石灰の期間 10/25〜11/5、堆肥の期間 11/5〜11/10
  const sch = scheduleSteps(planSteps({ id: 'x', name: 'X' }, '2026-11-15', vegPlan), j, today);
  const by = Object.fromEntries(sch.map((s) => [s.name, s]));
  assert.equal(by['石灰'].day, '2026-11-05');
  assert.equal(by['堆肥'].day, null); // 11/12以降でないと置けないが、期間は11/10まで
  assert.equal(by['堆肥'].status, 'nowork');
});

test('段取り: 予定を過ぎた手順は「遅れ」、予報より先は「未定」', () => {
  const today = '2026-11-05';
  const days = [0, 1, 2].map((i) => day(addDays(today, i), 1));
  const j = judgeDays(days, 'normal');
  const sch = scheduleSteps(planSteps({ id: 'x', name: 'X' }, '2026-11-12', vegPlan), j, today);
  assert.equal(sch[0].status, 'late'); // pH 〜10/28
  assert.equal(sch[0].day, '2026-11-05');
  const far = scheduleSteps(planSteps({ id: 'x', name: 'X' }, '2027-03-01', vegPlan), j, today);
  assert.ok(far.slice(0, 4).every((s) => s.status === 'future'));
});

test('太陽熱消毒は晴れが3日続く最初の作業日', () => {
  const days = [
    day('2026-07-30', 1, 0, null, true),
    day('2026-07-31', 1, 0, 10),
    day('2026-08-01', 3, 0, 10),
    day('2026-08-02', 1, 0, 10),
    day('2026-08-03', 1, 0, 10),
    day('2026-08-04', 2, 0, 10),
  ];
  assert.equal(sunnyStreakStart(judgeDays(days)).date, '2026-08-02');
});

test('日付の小道具と toDays', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(diffDays('2027-01-02', '2026-12-30'), 3);
  const d = toDays({ time: ['2026-11-04', '2026-11-05'], weather_code: [61, 1], precipitation_sum: [3, 0], precipitation_probability_max: [null, 10] }, '2026-11-05');
  assert.equal(d[0].past, true);
  assert.equal(d[1].today, true);
});
