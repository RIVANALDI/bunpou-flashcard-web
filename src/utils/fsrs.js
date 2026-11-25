// FSRS-4.5 / FSRS-5 inspired Spaced Repetition Scheduler (pure JS, deterministic)

export const RATINGS = {
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
};

export const CARD_STATES = {
  NEW: "new",
  LEARNING: "learning",
  REVIEW: "review",
  RELEARNING: "relearning",
};

const DEFAULT_PARAMS = {
  requestRetention: 0.9,
  maximumInterval: 365,
  // FSRS standard default weights (w0..w16)
  w: [
    0.4, 0.6, 2.4, 5.8,
    4.93, 0.94, 0.86, 0.01,
    1.49, 0.14, 0.94, 2.18,
    0.05, 0.34, 1.26, 0.29,
    2.61,
  ],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export function createEmptyCardState(cardId) {
  return {
    cardId,
    state: CARD_STATES.NEW,
    difficulty: 5.0,
    stability: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    dueAt: null,
    lastRating: null,
    lastMode: null,
    totalReviews: 0,
    correctCount: 0,
    hardCount: 0,
    againCount: 0,
    totalResponseMs: 0,
    avgResponseMs: 0,
    recognitionOnlyMastery: false,
  };
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export function computeRetrievability(cardState, nowMs = Date.now()) {
  if (!cardState || !cardState.lastReviewedAt || !cardState.stability || cardState.stability <= 0) {
    return cardState?.state === CARD_STATES.NEW ? 0 : 1;
  }
  const elapsedDays = Math.max(0, (nowMs - cardState.lastReviewedAt) / DAY_MS);
  // FSRS forgetting curve: R(t, S) = (1 + t / (9 * S)) ^ -1
  return Math.pow(1 + elapsedDays / (9 * cardState.stability), -1);
}

function initDifficulty(rating, w) {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10);
}

function initStability(rating, w) {
  return Math.max(0.1, w[rating - 1]);
}

function nextDifficulty(d, rating, w) {
  const nextD = d - w[6] * (rating - 3);
  // Mean reversion toward w[4]
  return clamp(w[7] * w[4] + (1 - w[7]) * nextD, 1, 10);
}

function nextRecallStability(d, s, r, rating, w) {
  const hardPenalty = rating === RATINGS.HARD ? w[15] : 1;
  const easyBonus = rating === RATINGS.EASY ? w[16] : 1;
  const factor =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp((1 - r) * w[10]) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(0.1, s * (1 + factor));
}

function nextForgetStability(d, s, r, w) {
  const sNew =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp((1 - r) * w[14]);
  return Math.max(0.1, Math.min(s, sNew));
}

function stabilityToIntervalDays(stability, requestRetention, maxInterval) {
  // Inverse of R(t, S) = (1 + t / (9 * S)) ^ -1  => t = 9 * S * (1/R - 1)
  const raw = 9 * stability * (1 / requestRetention - 1);
  return clamp(Math.round(raw), 1, maxInterval);
}

/**
 * Computes the next FSRS card state for a given rating (1..4) at nowMs.
 */
export function scheduleCard(prevState, rating, nowMs = Date.now(), options = {}) {
  const { w, requestRetention, maximumInterval } = DEFAULT_PARAMS;
  const mode = options.mode || "active_recall";
  const responseMs = typeof options.responseMs === "number" ? Math.max(0, options.responseMs) : 0;

  const prev = prevState || createEmptyCardState(options.cardId || "");
  const elapsedDays = prev.lastReviewedAt
    ? Math.max(0, (nowMs - prev.lastReviewedAt) / DAY_MS)
    : 0;

  let nextState = prev.state;
  let nextD = prev.difficulty;
  let nextS = prev.stability;
  let nextLapses = prev.lapses;
  let scheduledDays = 0;
  let dueAt = nowMs;

  if (prev.state === CARD_STATES.NEW || prev.reps === 0) {
    nextD = initDifficulty(rating, w);
    nextS = initStability(rating, w);

    if (rating === RATINGS.AGAIN) {
      nextState = CARD_STATES.LEARNING;
      scheduledDays = 0;
      dueAt = nowMs + 5 * MIN_MS;
      nextLapses += 1;
    } else if (rating === RATINGS.HARD) {
      nextState = CARD_STATES.LEARNING;
      scheduledDays = 0;
      dueAt = nowMs + 15 * MIN_MS;
    } else if (rating === RATINGS.GOOD) {
      nextState = CARD_STATES.REVIEW;
      scheduledDays = Math.max(1, stabilityToIntervalDays(nextS, requestRetention, maximumInterval));
      dueAt = nowMs + scheduledDays * DAY_MS;
    } else {
      nextState = CARD_STATES.REVIEW;
      scheduledDays = Math.max(3, stabilityToIntervalDays(nextS, requestRetention, maximumInterval));
      dueAt = nowMs + scheduledDays * DAY_MS;
    }
  } else {
    const r = computeRetrievability(prev, nowMs);
    nextD = nextDifficulty(prev.difficulty, rating, w);

    if (rating === RATINGS.AGAIN) {
      nextS = nextForgetStability(nextD, Math.max(0.2, prev.stability), r, w);
      nextState = CARD_STATES.RELEARNING;
      nextLapses += 1;
      scheduledDays = 0;
      dueAt = nowMs + 5 * MIN_MS;
    } else {
      nextS = nextRecallStability(nextD, Math.max(0.2, prev.stability), r, rating, w);
      nextState = CARD_STATES.REVIEW;

      let interval = stabilityToIntervalDays(nextS, requestRetention, maximumInterval);
      if (rating === RATINGS.HARD) {
        interval = Math.max(1, Math.min(interval, Math.max(1, Math.round((prev.scheduledDays || 1) * 1.2))));
      } else if (rating === RATINGS.GOOD) {
        interval = Math.max((prev.scheduledDays || 0) + 1, interval);
      } else if (rating === RATINGS.EASY) {
        interval = Math.max((prev.scheduledDays || 1) + 2, Math.round(interval * 1.3));
      }
      scheduledDays = clamp(interval, 1, maximumInterval);
      dueAt = nowMs + scheduledDays * DAY_MS;
    }
  }

  const totalReviews = prev.totalReviews + 1;
  const correctCount = prev.correctCount + (rating >= RATINGS.HARD ? 1 : 0);
  const hardCount = prev.hardCount + (rating === RATINGS.HARD ? 1 : 0);
  const againCount = prev.againCount + (rating === RATINGS.AGAIN ? 1 : 0);
  const totalResponseMs = prev.totalResponseMs + responseMs;
  const avgResponseMs = totalReviews > 0 ? Math.round(totalResponseMs / totalReviews) : 0;

  return {
    ...prev,
    state: nextState,
    difficulty: Number(nextD.toFixed(3)),
    stability: Number(nextS.toFixed(3)),
    elapsedDays: Number(elapsedDays.toFixed(3)),
    scheduledDays,
    reps: prev.reps + 1,
    lapses: nextLapses,
    lastReviewedAt: nowMs,
    dueAt,
    lastRating: rating,
    lastMode: mode,
    totalReviews,
    correctCount,
    hardCount,
    againCount,
    totalResponseMs,
    avgResponseMs,
  };
}

export function formatIntervalLabel(dueAt, nowMs = Date.now()) {
  if (!dueAt) return "-";
  const diffMs = Math.max(0, dueAt - nowMs);
  const mins = Math.round(diffMs / MIN_MS);
  if (mins < 60) return `${Math.max(1, mins)} mnt`;
  const hours = Math.round(diffMs / (60 * MIN_MS));
  if (hours < 24) return `${hours} jam`;
  const days = Math.round(diffMs / DAY_MS);
  if (days < 30) return `${days} hr`;
  const months = Math.round(days / 30);
  return `${months} bln`;
}

export function previewNextIntervals(cardState, nowMs = Date.now()) {
  return {
    [RATINGS.AGAIN]: formatIntervalLabel(scheduleCard(cardState, RATINGS.AGAIN, nowMs).dueAt, nowMs),
    [RATINGS.HARD]: formatIntervalLabel(scheduleCard(cardState, RATINGS.HARD, nowMs).dueAt, nowMs),
    [RATINGS.GOOD]: formatIntervalLabel(scheduleCard(cardState, RATINGS.GOOD, nowMs).dueAt, nowMs),
    [RATINGS.EASY]: formatIntervalLabel(scheduleCard(cardState, RATINGS.EASY, nowMs).dueAt, nowMs),
  };
}
