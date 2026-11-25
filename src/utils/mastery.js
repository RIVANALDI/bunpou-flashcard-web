import { RATINGS } from "./fsrs.js";

export const MASTERY_LEVELS = {
  UNSEEN: "unseen",
  RECOGNIZED: "recognized",
  LEARNING: "learning",
  FAMILIAR: "familiar",
  MASTERED: "mastered",
};

export const MASTERY_META = {
  [MASTERY_LEVELS.UNSEEN]: {
    label: "Belum dipelajari",
    short: "Belum",
    cls: "unseen",
    order: 0,
  },
  [MASTERY_LEVELS.RECOGNIZED]: {
    label: "Baru dikenali",
    short: "Baru dikenali",
    cls: "recognized",
    order: 1,
  },
  [MASTERY_LEVELS.LEARNING]: {
    label: "Mulai hafal",
    short: "Mulai hafal",
    cls: "learning",
    order: 2,
  },
  [MASTERY_LEVELS.FAMILIAR]: {
    label: "Cukup hafal",
    short: "Cukup hafal",
    cls: "familiar",
    order: 3,
  },
  [MASTERY_LEVELS.MASTERED]: {
    label: "Dikuasai",
    short: "Dikuasai",
    cls: "mastered",
    order: 4,
  },
};

/**
 * Determines 5-tier mastery level from actual test history & Sulit/Mudah stage.
 * - Stage 0 / Sulit -> Baru dikenali
 * - Mudah 1 (15m)   -> Baru dikenali
 * - Mudah 2 (30m)   -> Mulai hafal
 * - Mudah 3-4 (1-2j)-> Cukup hafal
 * - Mudah 5+ (4j)   -> Dikuasai (requires accuracy >= 70% & non-recognition pass)
 */
export function evaluateMastery(cardState, cardLogs = []) {
  if (!cardState || cardState.reps === 0) {
    return MASTERY_LEVELS.UNSEEN;
  }

  const {
    reps,
    easyStreak = 0,
    lastRating,
    totalReviews,
    correctCount,
  } = cardState;
  const accuracy = totalReviews > 0 ? correctCount / totalReviews : 0;

  // If last answer was Sulit, drop back to Baru dikenali
  if (lastRating === RATINGS.AGAIN || lastRating === RATINGS.HARD || easyStreak === 0) {
    return MASTERY_LEVELS.RECOGNIZED;
  }

  const hasRecallPass =
    cardLogs.length === 0
      ? cardState.lastMode !== "recognition"
      : cardLogs.some((l) => l.mode !== "recognition" && l.rating >= RATINGS.GOOD);

  if (easyStreak >= 5 && reps >= 5 && accuracy >= 0.7 && hasRecallPass) {
    return MASTERY_LEVELS.MASTERED;
  }

  if (easyStreak >= 3) {
    return MASTERY_LEVELS.FAMILIAR;
  }

  if (easyStreak >= 2) {
    return MASTERY_LEVELS.LEARNING;
  }

  return MASTERY_LEVELS.RECOGNIZED;
}
