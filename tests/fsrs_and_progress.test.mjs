import assert from "node:assert/strict";
import test from "node:test";
import CARDS from "../src/data/bunpou.json" with { type: "json" };
import {
  RATINGS,
  createEmptyCardState,
  previewNextIntervals,
  scheduleCard,
} from "../src/utils/fsrs.js";
import { MASTERY_LEVELS, evaluateMastery } from "../src/utils/mastery.js";
import {
  buildDailyReviewPlan,
  computeDashboardAnalytics,
  getWeakWords,
} from "../src/utils/scheduler.js";
import { appendReviewLog } from "../src/utils/storage.js";
import { buildRecognitionOptions } from "../src/utils/quizModes.js";

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

test("1. Interval Sulit (5 menit) dan Mudah bertahap (15m -> 30m -> 1j -> 2j -> 4j -> 4j)", () => {
  let st = createEmptyCardState("22-1");
  let now = 1_700_000_000_000;

  // Preview awal
  assert.deepEqual(previewNextIntervals(st), {
    sulit: "5 menit",
    mudah: "15 menit",
  });

  // Mudah 1 -> 15 menit
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2000 });
  assert.equal(st.dueAt - now, 15 * MIN_MS);
  assert.equal(previewNextIntervals(st).mudah, "30 menit");

  // Mudah 2 -> 30 menit
  now = st.dueAt;
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2000 });
  assert.equal(st.dueAt - now, 30 * MIN_MS);
  assert.equal(previewNextIntervals(st).mudah, "1 jam");

  // Mudah 3 -> 1 jam
  now = st.dueAt;
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2000 });
  assert.equal(st.dueAt - now, 60 * MIN_MS);
  assert.equal(previewNextIntervals(st).mudah, "2 jam");

  // Mudah 4 -> 2 jam
  now = st.dueAt;
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2000 });
  assert.equal(st.dueAt - now, 120 * MIN_MS);
  assert.equal(previewNextIntervals(st).mudah, "4 jam");

  // Mudah 5 -> 4 jam
  now = st.dueAt;
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2000 });
  assert.equal(st.dueAt - now, 240 * MIN_MS);
  assert.equal(previewNextIntervals(st).mudah, "4 jam");

  // Mudah 6 -> tetap 4 jam
  now = st.dueAt;
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2000 });
  assert.equal(st.dueAt - now, 240 * MIN_MS);

  // Pilih Sulit -> reset ke 5 menit, dan Mudah berikutnya kembali ke 15 menit
  now = st.dueAt;
  st = scheduleCard(st, RATINGS.AGAIN, now, { mode: "active_recall", responseMs: 5000 });
  assert.equal(st.dueAt - now, 5 * MIN_MS);
  assert.equal(st.easyStreak, 0);
  assert.deepEqual(previewNextIntervals(st), {
    sulit: "5 menit",
    mudah: "15 menit",
  });
});

test("2. Tingkat penguasaan naik bertahap hingga Dikuasai dan turun saat Sulit", () => {
  let st = createEmptyCardState("22-2");
  let now = 1_700_000_000_000;
  const logs = [];

  assert.equal(evaluateMastery(st, logs), MASTERY_LEVELS.UNSEEN);

  for (let i = 0; i < 5; i++) {
    st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2500 });
    logs.push({
      idempotencyKey: `m_${i}`,
      cardId: "22-2",
      timestamp: now,
      rating: RATINGS.GOOD,
      mode: "active_recall",
      elapsedDays: st.elapsedDays,
    });
    now = st.dueAt + MIN_MS;
  }
  assert.equal(evaluateMastery(st, logs), MASTERY_LEVELS.MASTERED);

  // Sulit -> turun kembali ke Baru dikenali
  st = scheduleCard(st, RATINGS.AGAIN, now, { mode: "active_recall", responseMs: 6000 });
  logs.push({
    idempotencyKey: "m_fail",
    cardId: "22-2",
    timestamp: now,
    rating: RATINGS.AGAIN,
    mode: "active_recall",
    elapsedDays: st.elapsedDays,
  });
  assert.equal(evaluateMastery(st, logs), MASTERY_LEVELS.RECOGNIZED);
});

test("3. Recognition-only tidak boleh mendapat status Dikuasai", () => {
  let st = createEmptyCardState("23-1");
  let now = 1_700_000_000_000;
  const logs = [];

  for (let i = 0; i < 6; i++) {
    st = scheduleCard(st, RATINGS.GOOD, now, { mode: "recognition", responseMs: 1800 });
    logs.push({
      idempotencyKey: `r_${i}`,
      cardId: "23-1",
      timestamp: now,
      rating: RATINGS.GOOD,
      mode: "recognition",
      elapsedDays: st.elapsedDays,
    });
    now = st.dueAt + MIN_MS;
  }

  assert.notEqual(evaluateMastery(st, logs), MASTERY_LEVELS.MASTERED);
});

test("4. Daily Review memprioritaskan kartu jatuh tempo di atas kartu baru", () => {
  const now = 1_700_000_000_000;
  const overdueState = {
    ...createEmptyCardState("24-1"),
    state: "review",
    reps: 2,
    easyStreak: 2,
    stability: 2.5,
    dueAt: now - 5 * MIN_MS,
    lastReviewedAt: now - 35 * MIN_MS,
    totalReviews: 2,
    correctCount: 2,
  };
  const plan = buildDailyReviewPlan(CARDS, { "24-1": overdueState }, [], 3, now);
  assert.equal(plan.queueIds[0], "24-1");
  assert.equal(plan.dueCount, 1);
  assert.equal(plan.newCount, 3);
});

test("5. Weak Words & Dashboard menghitung akurasi dan retensi aktual", () => {
  const now = 1_700_000_000_000;
  let st = createEmptyCardState("22-4");
  st = scheduleCard(st, RATINGS.AGAIN, now - 10 * DAY_MS, { mode: "active_recall", responseMs: 15000 });
  st = scheduleCard(st, RATINGS.AGAIN, now - 8 * DAY_MS, { mode: "active_recall", responseMs: 14000 });
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 5000 });

  const weak = getWeakWords(CARDS, { "22-4": st });
  assert.equal(weak.length, 1);
  assert.equal(weak[0].card.id, "22-4");

  const logs = [
    { idempotencyKey: "1", cardId: "22-4", timestamp: now - 10 * DAY_MS, rating: RATINGS.AGAIN, mode: "active_recall", elapsedDays: 0 },
    { idempotencyKey: "2", cardId: "22-4", timestamp: now - 8 * DAY_MS, rating: RATINGS.AGAIN, mode: "active_recall", elapsedDays: 2 },
    { idempotencyKey: "3", cardId: "22-4", timestamp: now, rating: RATINGS.GOOD, mode: "active_recall", elapsedDays: 8 },
  ];
  const dash = computeDashboardAnalytics(CARDS, { "22-4": st }, logs, 30, now);
  assert.equal(dash.accuracyPct, 33);
  assert.equal(dash.shortTermRetentionPct, 0);
  assert.equal(dash.longTermRetentionPct, 100);
  assert.equal(dash.consistencyDays, 3);
});

test("6. Deduplikasi reviewLog & opsi Recognition", () => {
  let logs = [];
  logs = appendReviewLog(logs, { idempotencyKey: "dup_1", cardId: "22-1", rating: 3 });
  logs = appendReviewLog(logs, { idempotencyKey: "dup_1", cardId: "22-1", rating: 3 });
  assert.equal(logs.length, 1);

  const opts = buildRecognitionOptions(CARDS[0], CARDS);
  assert.equal(opts.length, 4);
  assert.equal(opts.filter((o) => o.isCorrect).length, 1);
});
