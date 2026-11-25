import assert from "node:assert/strict";
import test from "node:test";
import CARDS from "../src/data/bunpou.json" with { type: "json" };
import { RATINGS, createEmptyCardState, scheduleCard } from "../src/utils/fsrs.js";
import { MASTERY_LEVELS, evaluateMastery } from "../src/utils/mastery.js";
import {
  buildDailyReviewPlan,
  computeDashboardAnalytics,
  getWeakWords,
} from "../src/utils/scheduler.js";
import { appendReviewLog } from "../src/utils/storage.js";
import { buildRecognitionOptions } from "../src/utils/quizModes.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("1. Kartu baru tidak langsung Dikuasai setelah 1x benar", () => {
  const s0 = createEmptyCardState("22-1");
  assert.equal(evaluateMastery(s0, []), MASTERY_LEVELS.UNSEEN);

  const now = 1_700_000_000_000;
  const s1 = scheduleCard(s0, RATINGS.EASY, now, { mode: "active_recall", responseMs: 3000 });
  const logs = [{ cardId: "22-1", timestamp: now, rating: RATINGS.EASY, mode: "active_recall", elapsedDays: 0 }];
  assert.equal(evaluateMastery(s1, logs), MASTERY_LEVELS.RECOGNIZED);
  assert.ok(s1.dueAt > now);
});

test("2. Pengujian berulang dengan jeda waktu menaikkan status ke Dikuasai", () => {
  let st = createEmptyCardState("22-2");
  let now = 1_700_000_000_000;
  const logs = [];

  for (let i = 0; i < 5; i++) {
    const rating = RATINGS.GOOD;
    st = scheduleCard(st, rating, now, { mode: "active_recall", responseMs: 2500 });
    logs.push({
      idempotencyKey: `k_${i}`,
      cardId: "22-2",
      timestamp: now,
      rating,
      mode: "active_recall",
      elapsedDays: st.elapsedDays,
    });
    now = st.dueAt + DAY_MS; // simulate real elapsed time past dueAt
  }

  assert.equal(evaluateMastery(st, logs), MASTERY_LEVELS.MASTERED);
  assert.ok(st.stability >= 21);
});

test("3. Jawaban Again menurunkan stabilitas, menambah lapses, dan menurunkan status", () => {
  let st = createEmptyCardState("22-3");
  let now = 1_700_000_000_000;
  const logs = [];

  for (let i = 0; i < 5; i++) {
    st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 2500 });
    logs.push({ idempotencyKey: `g_${i}`, cardId: "22-3", timestamp: now, rating: RATINGS.GOOD, mode: "active_recall", elapsedDays: st.elapsedDays });
    now = st.dueAt + DAY_MS;
  }
  assert.equal(evaluateMastery(st, logs), MASTERY_LEVELS.MASTERED);

  const prevStability = st.stability;
  st = scheduleCard(st, RATINGS.AGAIN, now, { mode: "active_recall", responseMs: 8000 });
  logs.push({ idempotencyKey: "again_1", cardId: "22-3", timestamp: now, rating: RATINGS.AGAIN, mode: "active_recall", elapsedDays: st.elapsedDays });

  assert.equal(st.lapses, 1);
  assert.ok(st.stability < prevStability);
  assert.notEqual(evaluateMastery(st, logs), MASTERY_LEVELS.MASTERED);
  assert.ok(st.dueAt - now <= 10 * 60 * 1000);
});

test("4. Recognition-only tidak boleh mendapat status Dikuasai", () => {
  let st = createEmptyCardState("23-1");
  let now = 1_700_000_000_000;
  const logs = [];

  for (let i = 0; i < 6; i++) {
    st = scheduleCard(st, RATINGS.EASY, now, { mode: "recognition", responseMs: 1800 });
    logs.push({ idempotencyKey: `r_${i}`, cardId: "23-1", timestamp: now, rating: RATINGS.EASY, mode: "recognition", elapsedDays: st.elapsedDays });
    now = st.dueAt + DAY_MS;
  }

  assert.notEqual(evaluateMastery(st, logs), MASTERY_LEVELS.MASTERED);
});

test("5. Daily Review memprioritaskan kartu terlambat di atas kartu baru", () => {
  const now = 1_700_000_000_000;
  const overdueState = {
    ...createEmptyCardState("24-1"),
    state: "review",
    reps: 2,
    stability: 3,
    dueAt: now - 2 * DAY_MS,
    lastReviewedAt: now - 5 * DAY_MS,
    totalReviews: 2,
    correctCount: 2,
  };
  const plan = buildDailyReviewPlan(CARDS, { "24-1": overdueState }, [], 3, now);
  assert.equal(plan.queueIds[0], "24-1");
  assert.equal(plan.dueCount, 1);
  assert.equal(plan.newCount, 3);
});

test("6. Weak Words mendeteksi kartu sering salah dan menghitung dashboard akurat", () => {
  const now = 1_700_000_000_000;
  let st = createEmptyCardState("22-4");
  st = scheduleCard(st, RATINGS.AGAIN, now - 10 * DAY_MS, { mode: "active_recall", responseMs: 15000 });
  st = scheduleCard(st, RATINGS.HARD, now - 8 * DAY_MS, { mode: "active_recall", responseMs: 14000 });
  st = scheduleCard(st, RATINGS.GOOD, now, { mode: "active_recall", responseMs: 5000 });

  const weak = getWeakWords(CARDS, { "22-4": st });
  assert.equal(weak.length, 1);
  assert.equal(weak[0].card.id, "22-4");

  const logs = [
    { idempotencyKey: "1", cardId: "22-4", timestamp: now - 10 * DAY_MS, rating: RATINGS.AGAIN, mode: "active_recall", elapsedDays: 0 },
    { idempotencyKey: "2", cardId: "22-4", timestamp: now - 8 * DAY_MS, rating: RATINGS.HARD, mode: "active_recall", elapsedDays: 2 },
    { idempotencyKey: "3", cardId: "22-4", timestamp: now, rating: RATINGS.GOOD, mode: "active_recall", elapsedDays: 8 },
  ];
  const dash = computeDashboardAnalytics(CARDS, { "22-4": st }, logs, 30, now);
  assert.equal(dash.accuracyPct, 67);
  assert.equal(dash.shortTermRetentionPct, 100);
  assert.equal(dash.longTermRetentionPct, 100);
  assert.equal(dash.consistencyDays, 3);
});

test("7. Deduplikasi reviewLog & opsi Recognition", () => {
  let logs = [];
  logs = appendReviewLog(logs, { idempotencyKey: "dup_1", cardId: "22-1", rating: 3 });
  logs = appendReviewLog(logs, { idempotencyKey: "dup_1", cardId: "22-1", rating: 3 });
  assert.equal(logs.length, 1);

  const opts = buildRecognitionOptions(CARDS[0], CARDS);
  assert.equal(opts.length, 4);
  assert.equal(opts.filter((o) => o.isCorrect).length, 1);
});
