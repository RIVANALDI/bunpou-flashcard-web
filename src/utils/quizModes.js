// Quiz Mode helpers: Active Recall, Reverse Recall, Recognition, Context Test, Mixed Review

export const QUIZ_MODES = {
  ACTIVE_RECALL: "active_recall",
  REVERSE_RECALL: "reverse_recall",
  RECOGNITION: "recognition",
};

export const QUIZ_MODE_LABELS = {
  [QUIZ_MODES.ACTIVE_RECALL]: "Active Recall (JP → ID)",
  [QUIZ_MODES.REVERSE_RECALL]: "Reverse Recall (ID → JP)",
  [QUIZ_MODES.RECOGNITION]: "Recognition (Pilihan Ganda)",
};

/**
 * Generates 4 deterministic/shuffled multiple-choice options for Recognition mode.
 */
export function buildRecognitionOptions(targetCard, allCards) {
  const distractors = allCards
    .filter((c) => c.id !== targetCard.id)
    .sort((a, b) => {
      // Prefer same chapter distractors first for meaningful challenge
      const sameA = a.ch === targetCard.ch ? 0 : 1;
      const sameB = b.ch === targetCard.ch ? 0 : 1;
      if (sameA !== sameB) return sameA - sameB;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 8);

  // Pick 3 distractors deterministically rotated by targetCard.num
  const picked = [];
  for (let i = 0; i < 3 && i < distractors.length; i++) {
    picked.push(distractors[(targetCard.num + i) % distractors.length]);
  }

  const options = [targetCard, ...picked].map((c) => ({
    id: c.id,
    label: c.arti,
    bunpou: c.bunpou,
    isCorrect: c.id === targetCard.id,
  }));

  // Deterministic shuffle based on card id
  const seed = targetCard.ch * 31 + targetCard.num;
  for (let i = options.length - 1; i > 0; i--) {
    const j = (seed + i * 7) % (i + 1);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}
