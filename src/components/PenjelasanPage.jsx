import { useEffect, useMemo, useState } from "react";

function extractAbAnswer(answerHtml) {
  const plain = answerHtml.replace(/<[^>]+>/g, "").trim();
  const m = plain.match(/^Jawaban:\s*([ab])(?:\b|[．.\s]|$)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Splits detailHtml into chunks so every A/B question gets interactive clickable A/B buttons
 * and hides the answer/reason until the user picks A or B.
 */
function parseDetailBlocks(detailHtml) {
  // Remove bolding on "(a．...)" or "a．..." / "b．..." options so correct answer isn't spoiled
  const unspoiled = detailHtml.replace(
    /<strong>(([ab])[．.].+?)<\/strong>/gi,
    "$1"
  );

  const tokenRegex =
    /(<div class="doc-answer">[\s\S]*?<\/div>(?:\s*<div class="doc-reason">[\s\S]*?<\/div>)?)/g;

  const parts = [];
  let lastIdx = 0;
  let match;
  let qIndex = 0;

  while ((match = tokenRegex.exec(unspoiled)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: "html", html: unspoiled.slice(lastIdx, match.index) });
    }
    const block = match[1];
    const ansMatch = block.match(/<div class="doc-answer">([\s\S]*?)<\/div>/);
    const reasonMatch = block.match(/<div class="doc-reason">([\s\S]*?)<\/div>/);
    const correctOption = ansMatch ? extractAbAnswer(ansMatch[1]) : null;

    if (correctOption) {
      parts.push({
        type: "ab_quiz",
        qIndex: qIndex++,
        correctOption,
        answerHtml: ansMatch[0],
        reasonHtml: reasonMatch ? reasonMatch[0] : "",
      });
    } else {
      parts.push({ type: "html", html: block });
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < unspoiled.length) {
    parts.push({ type: "html", html: unspoiled.slice(lastIdx) });
  }

  return parts;
}

function AbQuizBlock({ correctOption, answerHtml, reasonHtml }) {
  const [selected, setSelected] = useState(null);

  const isCorrect = selected === correctOption;

  return (
    <div className="ab-quiz-box">
      <div className="ab-quiz-prompt">Pilih jawaban yang benar:</div>
      <div className="ab-quiz-buttons">
        {["a", "b"].map((opt) => {
          let cls = "ab-btn";
          if (selected !== null) {
            if (opt === correctOption) cls += " ab-correct";
            else if (opt === selected) cls += " ab-wrong";
          }
          return (
            <button
              key={opt}
              type="button"
              className={cls}
              disabled={selected !== null}
              onClick={() => setSelected(opt)}
            >
              Pilihan {opt.toUpperCase()}
            </button>
          );
        })}
        {selected !== null && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSelected(null)}
          >
            ↺ Coba Lagi
          </button>
        )}
      </div>

      {selected !== null && (
        <div className="ab-feedback">
          <div className={`ab-status ${isCorrect ? "ok" : "err"}`}>
            {isCorrect
              ? `✅ Benar! Pilihan ${correctOption.toUpperCase()} tepat.`
              : `❌ Kurang tepat. Jawaban yang benar adalah ${correctOption.toUpperCase()}.`}
          </div>
          <div dangerouslySetInnerHTML={{ __html: answerHtml }} />
          {reasonHtml && <div dangerouslySetInnerHTML={{ __html: reasonHtml }} />}
        </div>
      )}
    </div>
  );
}

export default function PenjelasanPage({ card, onBack }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [card.id]);

  const blocks = useMemo(() => parseDetailBlocks(card.detailHtml), [card.detailHtml]);

  return (
    <section>
      <div className="detail-header">
        <button className="icon-btn" type="button" onClick={onBack}>
          ← Kembali ke Flashcard
        </button>
        <span className="badge">第{card.ch}課 · #{card.num}</span>
      </div>

      <article className="detail-card">
        <h2 className="detail-title">{card.bunpou}</h2>
        {blocks.map((blk, i) =>
          blk.type === "ab_quiz" ? (
            <AbQuizBlock
              key={`${card.id}_q_${blk.qIndex}`}
              correctOption={blk.correctOption}
              answerHtml={blk.answerHtml}
              reasonHtml={blk.reasonHtml}
            />
          ) : (
            <div key={`${card.id}_h_${i}`} dangerouslySetInnerHTML={{ __html: blk.html }} />
          )
        )}
      </article>
    </section>
  );
}
