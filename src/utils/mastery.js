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
 * Determines 5-tier mastery level strictly from actual test history & FSRS state.
 * - Never grants Dikuasai on 1x answer, card flip alone, or Recognition-only passes.
 * - Drops level if performance declines (Again / low stability).
 */
export function evaluateMastery(cardState, cardLogs = []) {
  if (!cardState || cardState.reps === 0) {
    return MASTERY_LEVELS.UNSEEN;
  }

  const { reps, stability, scheduledDays, lastRating, lapses, totalReviews, correctCount } = cardState;
  const accuracy = totalReviews > 0 ? correctCount / totalReviews : 0;

  // If user just forgot (Again), cannot be Cukup hafal or Dikuasai
  if (lastRating === RATINGS.AGAIN) {
    return reps >= 2 && stability >= 2
      ? MASTERY_LEVELS.LEARNING
      : MASTERY_LEVELS.RECOGNIZED;
  }

  // Check if card has non-recognition (active recall / reverse / context) passes
  const hasRecallPass =
    cardLogs.length === 0
      ? cardState.lastMode !== "recognition"
      : cardLogs.some((l) => l.mode !== "recognition" && l.rating >= RATINGS.GOOD);

  // Tier 5: Dikuasai (long-term retention proven across spaced intervals)
  if (
    reps >= 4 &&
    stability >= 21 &&
    scheduledDays >= 7 &&
    lastRating >= RATINGS.GOOD &&
    accuracy >= 0.7 &&
    hasRecallPass
  ) {
    return MASTERY_LEVELS.MASTERED;
  }

  // Tier 4: Cukup hafal (multiple sessions & multi-day stability)
  if (reps >= 3 && stability >= 7 && scheduledDays >= 2 && lastRating >= RATINGS.HARD && lapses <= 2) {
    return MASTERY_LEVELS.FAMILIAR;
  }

  // Tier 3: Mulai hafal (able to answer correctly with >1 day stability)
  if (reps >= 2 && stability >= 2 && lastRating >= RATINGS.HARD) {
    return MASTERY_LEVELS.LEARNING;
  }

  // Tier 2: Baru dikenali (introduced, not yet proven)
  return MASTERY_LEVELS.RECOGNIZED;
}
