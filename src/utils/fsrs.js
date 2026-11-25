// 2-Button Adaptive Spaced Repetition Scheduler (Sulit / Mudah)
// Sulit: 5 menit (resets stage to 0)
// Mudah: 15 menit -> 30 menit -> 1 jam -> 2 jam -> 4 jam (stage 1..5+)

export const RATINGS = {
  AGAIN: 1, // Sulit
  HARD: 2,  // Kept for backward compatibility with existing logs
  GOOD: 3,  // Mudah
  EASY: 4,  // Kept for backward compatibility with existing logs
};

export const CARD_STATES = {
  NEW: "new",
  LEARNING: "learning",
  REVIEW: "review",
  RELEARNING: "relearning",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export const MUDAH_INTERVAL_MINUTES = [15, 30, 60, 120, 240];
export const SULIT_INTERVAL_MINUTES = 5;

const STAGE_STABILITY_DAYS = [0.2, 0.8, 2.5, 5.0, 10.0, 22.0];

export function createEmptyCardState(cardId) {
  return {
    cardId,
    state: CARD_STATES.NEW,
    difficulty: 5.0,
    stability: 0,
    easyStreak: 0,
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
  };
}

export function computeRetrievability(cardState, nowMs = Date.now()) {
  if (!cardState || !cardState.lastReviewedAt || !cardState.stability || cardState.stability <= 0) {
    return cardState?.state === CARD_STATES.NEW ? 0 : 1;
  }
  const elapsedDays = Math.max(0, (nowMs - cardState.lastReviewedAt) / DAY_MS);
  return Math.pow(1 + elapsedDays / (9 * cardState.stability), -1);
}

export function getNextMudahMinutes(currentEasyStreak = 0) {
  const idx = Math.min(currentEasyStreak, MUDAH_INTERVAL_MINUTES.length - 1);
  return MUDAH_INTERVAL_MINUTES[Math.max(0, idx)];
}

/**
 * Computes next card state for Sulit (RATINGS.AGAIN = 1) or Mudah (RATINGS.GOOD = 3).
 */
export function scheduleCard(prevState, rating, nowMs = Date.now(), options = {}) {
  const mode = options.mode || "active_recall";
  const responseMs = typeof options.responseMs === "number" ? Math.max(0, options.responseMs) : 0;

  const prev = prevState || createEmptyCardState(options.cardId || "");
  const elapsedDays = prev.lastReviewedAt
    ? Math.max(0, (nowMs - prev.lastReviewedAt) / DAY_MS)
    : 0;

  const prevStreak = prev.easyStreak || 0;
  const isSulit = rating === RATINGS.AGAIN || rating === RATINGS.HARD;

  let nextEasyStreak;
  let intervalMinutes;
  let nextState;
  let nextLapses = prev.lapses || 0;
  let nextD = prev.difficulty ?? 5.0;

  if (isSulit) {
    nextEasyStreak = 0;
    intervalMinutes = SULIT_INTERVAL_MINUTES;
    nextState = prev.reps > 0 ? CARD_STATES.RELEARNING : CARD_STATES.LEARNING;
    nextLapses += 1;
    nextD = Math.min(10, Number((nextD + 0.6).toFixed(3)));
  } else {
    nextEasyStreak = prevStreak + 1;
    intervalMinutes = getNextMudahMinutes(prevStreak);
    nextState = CARD_STATES.REVIEW;
    nextD = Math.max(1, Number((nextD - 0.35).toFixed(3)));
  }

  const dueAt = nowMs + intervalMinutes * MIN_MS;
  const scheduledDays = Number((intervalMinutes / (24 * 60)).toFixed(4));
  const stabilityIdx = Math.min(nextEasyStreak, STAGE_STABILITY_DAYS.length - 1);
  const nextS = STAGE_STABILITY_DAYS[stabilityIdx];

  const totalReviews = (prev.totalReviews || 0) + 1;
  const correctCount = (prev.correctCount || 0) + (isSulit ? 0 : 1);
  const hardCount = (prev.hardCount || 0) + (isSulit ? 1 : 0);
  const againCount = (prev.againCount || 0) + (isSulit ? 1 : 0);
  const totalResponseMs = (prev.totalResponseMs || 0) + responseMs;
  const avgResponseMs = totalReviews > 0 ? Math.round(totalResponseMs / totalReviews) : 0;

  return {
    ...prev,
    state: nextState,
    difficulty: nextD,
    stability: nextS,
    easyStreak: nextEasyStreak,
    elapsedDays: Number(elapsedDays.toFixed(4)),
    scheduledDays,
    reps: (prev.reps || 0) + 1,
    lapses: nextLapses,
    lastReviewedAt: nowMs,
    dueAt,
    lastRating: isSulit ? RATINGS.AGAIN : RATINGS.GOOD,
    lastMode: mode,
    totalReviews,
    correctCount,
    hardCount,
    againCount,
    totalResponseMs,
    avgResponseMs,
  };
}

export function formatMinutesLabel(minutes) {
  if (minutes < 60) return `${minutes} menit`;
  const hours = minutes / 60;
  return `${hours} jam`;
}

export function formatIntervalLabel(dueAt, nowMs = Date.now()) {
  if (!dueAt) return "-";
  const diffMs = Math.max(0, dueAt - nowMs);
  const mins = Math.round(diffMs / MIN_MS);
  if (mins < 60) return `${Math.max(1, mins)} menit`;
  const hours = Math.round(diffMs / (60 * MIN_MS));
  if (hours < 24) return `${hours} jam`;
  const days = Math.round(diffMs / DAY_MS);
  return `${days} hari`;
}

export function previewNextIntervals(cardState) {
  const streak = cardState?.easyStreak || 0;
  return {
    sulit: formatMinutesLabel(SULIT_INTERVAL_MINUTES),
    mudah: formatMinutesLabel(getNextMudahMinutes(streak)),
  };
}
