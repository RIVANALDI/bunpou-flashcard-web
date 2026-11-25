import { RATINGS } from "./fsrs.js";
import { evaluateMastery, MASTERY_LEVELS } from "./mastery.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function toLocalDateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Computes weakness score for a card.
 * Slow response time is an additional indicator, never treated as automatic failure.
 */
export function computeWeaknessScore(cardState) {
  if (!cardState || cardState.totalReviews === 0) return 0;
  const againRate = cardState.againCount / cardState.totalReviews;
  const hardRate = cardState.hardCount / cardState.totalReviews;
  const failRate = 1 - cardState.correctCount / cardState.totalReviews;
  const slowPenalty = cardState.avgResponseMs > 12000 ? Math.min(0.15, (cardState.avgResponseMs - 12000) / 80000) : 0;
  const lapseWeight = Math.min(0.4, cardState.lapses * 0.12);

  return Number((againRate * 0.4 + failRate * 0.25 + hardRate * 0.15 + lapseWeight + slowPenalty).toFixed(3));
}

export function getWeakWords(cards, cardStates) {
  return cards
    .map((card) => {
      const st = cardStates[card.id];
      const score = computeWeaknessScore(st);
      const isWeak =
        st &&
        st.totalReviews > 0 &&
        (st.lapses >= 1 ||
          st.againCount >= 1 ||
          st.hardCount >= 2 ||
          (st.totalReviews >= 2 && st.correctCount / st.totalReviews < 0.65) ||
          score >= 0.28);
      return { card, state: st, weaknessScore: score, isWeak: Boolean(isWeak) };
    })
    .filter((item) => item.isWeak)
    .sort((a, b) => b.weaknessScore - a.weaknessScore);
}

/**
 * Builds Daily Review queue with strict priority:
 * 1. Overdue cards (most overdue first)
 * 2. Weak / frequently missed cards that are due
 * 3. Cards due today / approaching due window (within 24h)
 * 4. New cards up to dailyNewTarget (not flooding existing review backlog)
 */
export function buildDailyReviewPlan(cards, cardStates, reviewLogs, dailyNewTarget = 5, nowMs = Date.now()) {
  const todayKey = toLocalDateKey(nowMs);
  const completedTodayIds = new Set(
    reviewLogs.filter((l) => toLocalDateKey(l.timestamp) === todayKey).map((l) => l.cardId)
  );
  const newStartedTodayCount = reviewLogs.filter(
    (l) => toLocalDateKey(l.timestamp) === todayKey && l.prevMastery === MASTERY_LEVELS.UNSEEN
  ).length;

  const endOfToday = new Date(nowMs);
  endOfToday.setHours(23, 59, 59, 999);
  const dueCutoff = endOfToday.getTime();

  const overdue = [];
  const dueSoon = [];
  const unseen = [];

  cards.forEach((card) => {
    const st = cardStates[card.id];
    if (!st || st.reps === 0) {
      unseen.push(card);
      return;
    }
    if (st.dueAt && st.dueAt <= nowMs) {
      overdue.push({ card, st, weakness: computeWeaknessScore(st), overdueMs: nowMs - st.dueAt });
    } else if (st.dueAt && st.dueAt <= dueCutoff) {
      dueSoon.push({ card, st, weakness: computeWeaknessScore(st), dueAt: st.dueAt });
    }
  });

  // Sort overdue: highest weakness + most overdue first
  overdue.sort((a, b) => {
    if (Math.abs(b.weakness - a.weakness) > 0.15) return b.weakness - a.weakness;
    return b.overdueMs - a.overdueMs;
  });

  dueSoon.sort((a, b) => a.dueAt - b.dueAt);

  // Limit new cards if there's already a heavy review backlog, and cap by remaining daily target
  const remainingNewQuota = Math.max(0, dailyNewTarget - newStartedTodayCount);
  const maxNewWithBacklog = overdue.length > 15 ? Math.min(2, remainingNewQuota) : remainingNewQuota;
  const newCards = unseen.slice(0, maxNewWithBacklog);

  const reviewQueueIds = [
    ...overdue.map((x) => x.card.id),
    ...dueSoon.map((x) => x.card.id),
  ];
  const queueIds = [...reviewQueueIds, ...newCards.map((c) => c.id)];

  const avgMsValues = Object.values(cardStates)
    .map((s) => s.avgResponseMs)
    .filter((v) => v > 0);
  const avgSecPerCard =
    avgMsValues.length > 0
      ? Math.max(8, Math.min(60, Math.round(avgMsValues.reduce((a, b) => a + b, 0) / avgMsValues.length / 1000)))
      : 18;

  const estimatedMinutes = Math.max(
    queueIds.length > 0 ? 1 : 0,
    Math.ceil((queueIds.length * avgSecPerCard) / 60)
  );

  return {
    queueIds,
    dueCount: reviewQueueIds.length,
    overdueCount: overdue.length,
    newCount: newCards.length,
    completedTodayCount: completedTodayIds.size,
    remainingCount: queueIds.length,
    estimatedMinutes,
  };
}

/**
 * Computes real analytics from actual cardStates and reviewLogs (no fake/dummy numbers).
 */
export function computeDashboardAnalytics(cards, cardStates, reviewLogs, periodDays = 30, nowMs = Date.now()) {
  const logsByCard = {};
  reviewLogs.forEach((l) => {
    if (!logsByCard[l.cardId]) logsByCard[l.cardId] = [];
    logsByCard[l.cardId].push(l);
  });

  const masteryCounts = {
    [MASTERY_LEVELS.UNSEEN]: 0,
    [MASTERY_LEVELS.RECOGNIZED]: 0,
    [MASTERY_LEVELS.LEARNING]: 0,
    [MASTERY_LEVELS.FAMILIAR]: 0,
    [MASTERY_LEVELS.MASTERED]: 0,
  };

  let dueReviewCount = 0;
  const chapterStats = { 22: { total: 0, reviews: 0, errors: 0 }, 23: { total: 0, reviews: 0, errors: 0 }, 24: { total: 0, reviews: 0, errors: 0 } };

  const cardSummaries = cards.map((card) => {
    const st = cardStates[card.id];
    const cLogs = logsByCard[card.id] || [];
    const mastery = evaluateMastery(st, cLogs);
    masteryCounts[mastery]++;

    if (st && st.reps > 0 && st.dueAt && st.dueAt <= nowMs) {
      dueReviewCount++;
    }

    if (chapterStats[card.ch]) {
      chapterStats[card.ch].total++;
      if (st) {
        chapterStats[card.ch].reviews += st.totalReviews;
        chapterStats[card.ch].errors += st.againCount;
      }
    }

    return {
      card,
      state: st,
      mastery,
      weaknessScore: computeWeaknessScore(st),
    };
  });

  const periodCutoff = periodDays === "all" ? 0 : nowMs - periodDays * DAY_MS;
  const periodLogs = reviewLogs.filter((l) => l.timestamp >= periodCutoff);

  const totalPeriodReviews = periodLogs.length;
  const correctPeriodReviews = periodLogs.filter((l) => l.rating >= RATINGS.HARD).length;
  const accuracyPct =
    totalPeriodReviews > 0 ? Math.round((correctPeriodReviews / totalPeriodReviews) * 100) : null;

  // Retention: reviews after a time gap (>= ~4 min = short-term < 7d, >= 7d = long-term)
  const retentionShortLogs = periodLogs.filter((l) => l.elapsedDays >= 0.003 && l.elapsedDays < 7);
  const retentionLongLogs = periodLogs.filter((l) => l.elapsedDays >= 7);
  const allRetentionLogs = periodLogs.filter((l) => l.elapsedDays >= 0.003);

  const calcRetention = (arr) =>
    arr.length > 0
      ? Math.round((arr.filter((l) => l.rating >= RATINGS.HARD).length / arr.length) * 100)
      : null;

  const overallRetentionPct = calcRetention(allRetentionLogs);
  const shortTermRetentionPct = calcRetention(retentionShortLogs);
  const longTermRetentionPct = calcRetention(retentionLongLogs);

  // Study consistency: distinct local calendar days with >= 1 actual review
  const activeDaysSet = new Set(reviewLogs.map((l) => toLocalDateKey(l.timestamp)));
  const consistencyDays = activeDaysSet.size;

  // Daily activity & accuracy series (last 7 or 14 days that exist, or calendar window)
  const windowDays = periodDays === 7 ? 7 : 14;
  const dailySeries = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dTs = nowMs - i * DAY_MS;
    const key = toLocalDateKey(dTs);
    const dayLogs = reviewLogs.filter((l) => toLocalDateKey(l.timestamp) === key);
    const dayCorrect = dayLogs.filter((l) => l.rating >= RATINGS.HARD).length;
    const dayRet = dayLogs.filter((l) => l.elapsedDays >= 0.003);
    dailySeries.push({
      dateKey: key,
      label: key.slice(5), // MM-DD
      reviews: dayLogs.length,
      accuracy: dayLogs.length > 0 ? Math.round((dayCorrect / dayLogs.length) * 100) : null,
      retention: calcRetention(dayRet),
      masteredSnapshot: dayLogs.filter((l) => l.nextMastery === MASTERY_LEVELS.MASTERED).length,
    });
  }

  // Strongest & Weakest cards
  const testedCards = cardSummaries.filter((x) => x.state && x.state.totalReviews > 0);
  const strongestCards = [...testedCards]
    .sort((a, b) => (b.state.stability || 0) - (a.state.stability || 0))
    .slice(0, 5);
  const weakWords = getWeakWords(cards, cardStates);

  // Highest error chapter
  const chapterBreakdown = Object.entries(chapterStats).map(([ch, data]) => ({
    chapter: Number(ch),
    total: data.total,
    reviews: data.reviews,
    errors: data.errors,
    errorRate: data.reviews > 0 ? Math.round((data.errors / data.reviews) * 100) : 0,
  }));

  return {
    totalCards: cards.length,
    masteredCount: masteryCounts[MASTERY_LEVELS.MASTERED],
    inProgressCount:
      masteryCounts[MASTERY_LEVELS.RECOGNIZED] +
      masteryCounts[MASTERY_LEVELS.LEARNING] +
      masteryCounts[MASTERY_LEVELS.FAMILIAR],
    dueReviewCount,
    masteryCounts,
    accuracyPct,
    totalPeriodReviews,
    overallRetentionPct,
    shortTermRetentionPct,
    longTermRetentionPct,
    consistencyDays,
    dailySeries,
    strongestCards,
    weakWords,
    chapterBreakdown,
    logsByCard,
  };
}
