import { CARD_STATES, createEmptyCardState } from "./fsrs.js";

export const STORE_KEY = "bunpou_flashcard_store_v3";
const LEGACY_PROGRESS_V2_KEY = "bunpou_flashcard_progress_v2";
const LEGACY_PROGRESS_V1_KEY = "bunpou_flashcard_progress_v1";

export const DEFAULT_USER_ID = "user_default";

function createDefaultUserData(name = "Pengguna Utama") {
  return {
    id: DEFAULT_USER_ID,
    name,
    createdAt: Date.now(),
    dailyNewTarget: 5,
    cardStates: {},
    reviewLogs: [],
  };
}

function migrateLegacyProgress(userData) {
  try {
    const rawV2 = localStorage.getItem(LEGACY_PROGRESS_V2_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      const now = Date.now();
      Object.entries(parsed).forEach(([cardId, entry]) => {
        if (!entry || typeof entry !== "object") return;
        const streak = entry.streak || 0;
        const state = createEmptyCardState(cardId);
        if (streak >= 3) {
          state.state = CARD_STATES.REVIEW;
          state.reps = streak;
          state.stability = 4.0;
          state.scheduledDays = 3;
          state.lastRating = 3;
          state.lastReviewedAt = now - 24 * 60 * 60 * 1000;
          state.dueAt = now + 2 * 24 * 60 * 60 * 1000;
          state.totalReviews = streak;
          state.correctCount = streak;
        } else if (streak > 0 || entry.lastResult === "review") {
          state.state = CARD_STATES.LEARNING;
          state.reps = Math.max(1, streak);
          state.stability = streak > 0 ? 1.2 : 0.4;
          state.scheduledDays = streak > 0 ? 1 : 0;
          state.lastRating = entry.lastResult === "review" ? 1 : 3;
          state.lastReviewedAt = now - 12 * 60 * 60 * 1000;
          state.dueAt = now;
          state.totalReviews = Math.max(1, streak);
          state.correctCount = streak;
          state.againCount = entry.lastResult === "review" ? 1 : 0;
        }
        userData.cardStates[cardId] = state;
      });
      return true;
    }

    const rawV1 = localStorage.getItem(LEGACY_PROGRESS_V1_KEY);
    if (rawV1) {
      const parsed = JSON.parse(rawV1);
      const now = Date.now();
      Object.entries(parsed).forEach(([cardId, status]) => {
        const state = createEmptyCardState(cardId);
        state.state = status === "known" ? CARD_STATES.REVIEW : CARD_STATES.LEARNING;
        state.reps = 1;
        state.stability = status === "known" ? 2.4 : 0.5;
        state.scheduledDays = status === "known" ? 1 : 0;
        state.lastRating = status === "known" ? 3 : 1;
        state.lastReviewedAt = now - 12 * 60 * 60 * 1000;
        state.dueAt = now;
        state.totalReviews = 1;
        state.correctCount = status === "known" ? 1 : 0;
        state.againCount = status === "known" ? 0 : 1;
        userData.cardStates[cardId] = state;
      });
      return true;
    }
  } catch {
    // Ignore corrupted legacy data safely
  }
  return false;
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.users && parsed.activeUserId && parsed.users[parsed.activeUserId]) {
        return parsed;
      }
    }
  } catch {
    // Fall through to fresh initialization + migration
  }

  const defaultUser = createDefaultUserData("Pengguna Utama");
  migrateLegacyProgress(defaultUser);
  const store = {
    version: 3,
    activeUserId: DEFAULT_USER_ID,
    users: {
      [DEFAULT_USER_ID]: defaultUser,
    },
  };
  saveStore(store);
  return store;
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

export function createUserProfile(store, name) {
  const cleanName = (name || "").trim();
  if (!cleanName) return store;
  const id = `user_${Date.now()}`;
  const nextStore = {
    ...store,
    activeUserId: id,
    users: {
      ...store.users,
      [id]: {
        ...createDefaultUserData(cleanName),
        id,
      },
    },
  };
  saveStore(nextStore);
  return nextStore;
}

/**
 * Appends a review log safely with idempotencyKey deduplication.
 */
export function appendReviewLog(logs, entry) {
  if (!entry || !entry.idempotencyKey) return logs;
  if (logs.some((l) => l.idempotencyKey === entry.idempotencyKey)) {
    return logs;
  }
  return [...logs, entry];
}
