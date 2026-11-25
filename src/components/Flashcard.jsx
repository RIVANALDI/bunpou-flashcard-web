import { useMemo, useState } from "react";
import { MASTERY_META } from "../utils/mastery";
import {
  QUIZ_MODES,
  buildRecognitionOptions,
} from "../utils/quizModes";

export default function Flashcard({
  card,
  allCards,
  masteryLevel,
  isWeak,
  mode,
  isFlipped,
  onFlip,
  onOpenPenjelasan,
}) {
  const [selectedOptId, setSelectedOptId] = useState(null);
  const chapterText = `第${card.ch}課 · #${card.num}`;
  const meta = MASTERY_META[masteryLevel] || MASTERY_META.unseen;

  const recognitionOptions = useMemo(
    () => (mode === QUIZ_MODES.RECOGNITION ? buildRecognitionOptions(card, allCards) : []),
    [card, allCards, mode]
  );

  const handleCardClick = (e) => {
    if (e.target.closest(".btn-penjelasan") || e.target.closest(".mc-option")) {
      return;
    }
    onFlip();
  };

  return (
    <div className="stage">
      <div
        className={`card ${isFlipped ? "flipped" : ""}`}
        onClick={handleCardClick}
      >
        {/* Front Face */}
        <div className="face front">
          <div className="card-meta">
            <div className="meta-left">
              <span className="badge">{chapterText}</span>
              {isWeak && <span className="weak-badge">⚠️ Weak</span>}
            </div>
            <span className={`status-badge ${meta.cls}`}>{meta.label}</span>
          </div>

          <div className="front-center">
            {mode === QUIZ_MODES.REVERSE_RECALL ? (
              <div className="reverse-prompt">
                <div className="info-label">Tebak Bunpou (Bahasa Jepang)</div>
                <div className="reverse-arti">{card.arti}</div>
                <div className="reverse-fungsi">{card.fungsi}</div>
              </div>
            ) : (
              <>
                <div className="bunpou-main">{card.bunpou}</div>
                {mode === QUIZ_MODES.RECOGNITION && (
                  <div className="mc-grid" onClick={(e) => e.stopPropagation()}>
                    {recognitionOptions.map((opt) => {
                      const isChosen = selectedOptId === opt.id;
                      let optCls = "mc-option";
                      if (selectedOptId !== null) {
                        if (opt.isCorrect) optCls += " mc-correct";
                        else if (isChosen) optCls += " mc-wrong";
                      }
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={optCls}
                          onClick={() => {
                            setSelectedOptId(opt.id);
                            if (!isFlipped) onFlip();
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="hint">
            Klik kartu atau tekan <kbd>Space</kbd> untuk membalik
          </div>
        </div>

        {/* Back Face */}
        <div className="face back">
          <div className="card-meta">
            <div className="meta-left">
              <span className="badge">{chapterText}</span>
              {isWeak && <span className="weak-badge">⚠️ Weak</span>}
            </div>
            <span className={`status-badge ${meta.cls}`}>{meta.label}</span>
          </div>

          <div className="back-body">
            <div className="back-title-row">
              <span className="back-bunpou">{card.bunpou}</span>
              <span className="back-romaji">{card.romaji}</span>
            </div>

            <div className="info-block">
              <div className="info-label">Arti</div>
              <div className="info-text">{card.arti}</div>
            </div>

            <div className="info-block">
              <div className="info-label">Fungsi Bunpou</div>
              <div className="info-text">{card.fungsi}</div>
            </div>
          </div>

          <div className="back-footer">
            <span className="hint">Pilih penilaian FSRS di bawah</span>
            <button
              className="btn-penjelasan"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPenjelasan();
              }}
            >
              📖 Penjelasan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
