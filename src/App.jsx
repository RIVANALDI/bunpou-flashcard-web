import { useEffect, useMemo, useRef, useState } from "react";
import CARDS from "./data/bunpou.json";
import Flashcard from "./components/Flashcard";
import PenjelasanPage from "./components/PenjelasanPage";
import DashboardPage from "./components/DashboardPage";
import {
  RATINGS,
  createEmptyCardState,
  previewNextIntervals,
  scheduleCard,
} from "./utils/fsrs";
import { evaluateMastery, MASTERY_LEVELS } from "./utils/mastery";
import {
  appendReviewLog,
  createUserProfile,
  loadStore,
  saveStore,
} from "./utils/storage";
import {
  buildDailyReviewPlan,
  computeDashboardAnalytics,
  getWeakWords,
} from "./utils/scheduler";
import { QUIZ_MODES, QUIZ_MODE_LABELS } from "./utils/quizModes";

const STORAGE_THEME = "bunpou_flashcard_theme_v1";

const DECK_SOURCES = [
  { key: "daily", label: "📅 Daily Review" },
  { key: "all", label: "Semua (31)" },
  { key: "22", label: "Bab 22 (11)" },
  { key: "23", label: "Bab 23 (10)" },
  { key: "24", label: "Bab 24 (10)" },
  { key: "weak", label: "⚠️ Weak Words" },
];

const ALL_MODES = [
  QUIZ_MODES.ACTIVE_RECALL,
  QUIZ_MODES.REVERSE_RECALL,
  QUIZ_MODES.RECOGNITION,
];

function buildQueueForSource(source, cards, cardStates, dailyPlan, weakIds, shuffle = false) {
  let ids = [];
  if (source === "daily") {
    ids = [...dailyPlan.queueIds];
  } else if (source === "weak") {
    ids = [...weakIds];
  } else if (source === "all") {
    ids = cards.map((c) => c.id);
  } else {
    ids = cards.filter((c) => String(c.ch) === source).map((c) => c.id);
  }

  if (shuffle && source !== "daily") {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  }
  return ids;
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_THEME) || "light");
  const [store, setStore] = useState(() => loadStore());
  const [view, setView] = useState("study"); // 'study' | 'dashboard'
  const [menuOpen, setMenuOpen] = useState(false);
  const [deckSource, setDeckSource] = useState("daily");
  const [quizMode, setQuizMode] = useState(QUIZ_MODES.ACTIVE_RECALL); // or 'mixed'
  const [isFlipped, setIsFlipped] = useState(false);
  const [turnCounter, setTurnCounter] = useState(1);
  const cardShownAtRef = useRef(0);
  const lastSubmittedTurnRef = useRef(null);

  useEffect(() => {
    cardShownAtRef.current = Date.now();
  }, []);

  const [detailCardId, setDetailCardId] = useState(() => {
    const hash = window.location.hash;
    return hash.startsWith("#penjelasan/") ? hash.replace("#penjelasan/", "") : null;
  });

  const activeUser = store.users[store.activeUserId];
  const cardStates = useMemo(() => activeUser.cardStates || {}, [activeUser.cardStates]);
  const reviewLogs = useMemo(() => activeUser.reviewLogs || [], [activeUser.reviewLogs]);
  const dailyNewTarget = activeUser.dailyNewTarget || 5;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_THEME, theme);
  }, [theme]);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      setDetailCardId(hash.startsWith("#penjelasan/") ? hash.replace("#penjelasan/", "") : null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const cardMap = useMemo(() => {
    const m = new Map();
    CARDS.forEach((c) => m.set(c.id, c));
    return m;
  }, []);

  const analytics = useMemo(
    () => computeDashboardAnalytics(CARDS, cardStates, reviewLogs, 30),
    [cardStates, reviewLogs]
  );

  const dailyPlan = useMemo(
    () => buildDailyReviewPlan(CARDS, cardStates, reviewLogs, dailyNewTarget),
    [cardStates, reviewLogs, dailyNewTarget]
  );

  const weakWordsList = useMemo(
    () => getWeakWords(CARDS, cardStates),
    [cardStates]
  );
  const weakSet = useMemo(() => new Set(weakWordsList.map((w) => w.card.id)), [weakWordsList]);

  const [queue, setQueue] = useState(() =>
    buildQueueForSource(
      "daily",
      CARDS,
      activeUser.cardStates || {},
      buildDailyReviewPlan(CARDS, activeUser.cardStates || {}, activeUser.reviewLogs || [], activeUser.dailyNewTarget || 5),
      [],
      false
    )
  );

  const currentCard = queue.length > 0 ? cardMap.get(queue[0]) || null : null;
  const detailCard = detailCardId ? cardMap.get(detailCardId) || null : null;

  const effectiveMode = useMemo(() => {
    if (quizMode !== "mixed") return quizMode;
    return ALL_MODES[turnCounter % ALL_MODES.length];
  }, [quizMode, turnCounter]);

  const currentCardState = currentCard
    ? cardStates[currentCard.id] || createEmptyCardState(currentCard.id)
    : null;

  const currentMastery = currentCard
    ? evaluateMastery(currentCardState, analytics.logsByCard[currentCard.id] || [])
    : MASTERY_LEVELS.UNSEEN;

  const intervalPreviews = useMemo(
    () => (currentCardState ? previewNextIntervals(currentCardState) : null),
    [currentCardState]
  );

  const switchDeckSource = (source, shuffle = false, customPlan = dailyPlan, customWeak = weakWordsList) => {
    setDeckSource(source);
    const nextQueue = buildQueueForSource(
      source,
      CARDS,
      cardStates,
      customPlan,
      customWeak.map((w) => w.card.id),
      shuffle
    );
    setQueue(nextQueue);
    setIsFlipped(false);
    cardShownAtRef.current = Date.now();
  };

  const openPenjelasan = (cardId) => {
    window.location.hash = `penjelasan/${cardId}`;
    setDetailCardId(cardId);
  };

  const closePenjelasan = () => {
    window.location.hash = "";
    setDetailCardId(null);
  };

  const handleRate = (rating) => {
    if (!currentCard || !isFlipped) return;

    const idempotencyKey = `${activeUser.id}_${currentCard.id}_${turnCounter}`;
    if (lastSubmittedTurnRef.current === idempotencyKey) return;
    lastSubmittedTurnRef.current = idempotencyKey;

    const nowMs = Date.now();
    const responseMs = Math.max(200, nowMs - cardShownAtRef.current);
    const prevState = cardStates[currentCard.id] || createEmptyCardState(currentCard.id);
    const prevLogs = analytics.logsByCard[currentCard.id] || [];
    const prevMastery = evaluateMastery(prevState, prevLogs);

    const nextState = scheduleCard(prevState, rating, nowMs, {
      cardId: currentCard.id,
      mode: effectiveMode,
      responseMs,
    });

    const newLog = {
      idempotencyKey,
      cardId: currentCard.id,
      timestamp: nowMs,
      rating,
      mode: effectiveMode,
      responseMs,
      elapsedDays: nextState.elapsedDays,
      prevMastery,
      nextMastery: MASTERY_LEVELS.UNSEEN, // computed below
      isRetentionTest: nextState.elapsedDays >= 0.003,
    };

    const nextLogsForCard = [...prevLogs, newLog];
    const nextMastery = evaluateMastery(nextState, nextLogsForCard);
    newLog.nextMastery = nextMastery;

    setStore((prevStore) => {
      const user = prevStore.users[prevStore.activeUserId];
      return {
        ...prevStore,
        users: {
          ...prevStore.users,
          [user.id]: {
            ...user,
            cardStates: {
              ...user.cardStates,
              [currentCard.id]: nextState,
            },
            reviewLogs: appendReviewLog(user.reviewLogs || [], newLog),
          },
        },
      };
    });

    const rest = queue.slice(1);
    setQueue(rest);
    setIsFlipped(false);
    setTurnCounter((c) => c + 1);
    cardShownAtRef.current = Date.now();
  };

  // Automatic time-based due check: cards whose dueAt <= now re-enter queue automatically
  useEffect(() => {
    const checkDueCards = () => {
      const now = Date.now();
      const scopeIds = new Set(
        deckSource === "daily"
          ? buildDailyReviewPlan(CARDS, cardStates, reviewLogs, dailyNewTarget, now).queueIds
          : deckSource === "weak"
          ? weakWordsList.map((w) => w.card.id)
          : CARDS.filter((c) => deckSource === "all" || String(c.ch) === deckSource)
              .filter((c) => {
                const st = cardStates[c.id];
                return st && st.reps > 0 && st.dueAt && st.dueAt <= now;
              })
              .map((c) => c.id)
      );

      setQueue((prevQueue) => {
        const inQueue = new Set(prevQueue);
        const newlyDue = [...scopeIds].filter((id) => !inQueue.has(id));
        if (newlyDue.length === 0) return prevQueue;
        return [...prevQueue, ...newlyDue];
      });
    };

    const timer = setInterval(checkDueCards, 15000);
    return () => clearInterval(timer);
  }, [deckSource, cardStates, reviewLogs, dailyNewTarget, weakWordsList]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (menuOpen) {
        if (e.key === "Escape") setMenuOpen(false);
        return;
      }
      if (detailCard) {
        if (e.key === "Escape") closePenjelasan();
        return;
      }
      if (view !== "study") return;
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        if (currentCard) setIsFlipped((f) => !f);
      } else if (e.key === "1" && isFlipped) {
        handleRate(RATINGS.AGAIN);
      } else if (e.key === "2" && isFlipped) {
        handleRate(RATINGS.GOOD);
      } else if (e.key.toLowerCase() === "p" && isFlipped && currentCard) {
        openPenjelasan(currentCard.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleAddUser = () => {
    const name = window.prompt("Masukkan nama profil pengguna baru:");
    if (!name || !name.trim()) return;
    const nextStore = createUserProfile(store, name);
    setStore(nextStore);
    setDeckSource("daily");
    const newUser = nextStore.users[nextStore.activeUserId];
    const plan = buildDailyReviewPlan(CARDS, newUser.cardStates, newUser.reviewLogs, newUser.dailyNewTarget);
    setQueue(plan.queueIds);
    setIsFlipped(false);
  };

  const handleSwitchUser = (userId) => {
    const nextStore = { ...store, activeUserId: userId };
    setStore(nextStore);
    const u = nextStore.users[userId];
    const plan = buildDailyReviewPlan(CARDS, u.cardStates, u.reviewLogs, u.dailyNewTarget);
    setDeckSource("daily");
    setQueue(plan.queueIds);
    setIsFlipped(false);
  };

  const activeSourceLabel =
    deckSource === "daily"
      ? `Daily Review (${dailyPlan.remainingCount})`
      : deckSource === "weak"
      ? `Weak Words (${weakWordsList.length})`
      : DECK_SOURCES.find((s) => s.key === deckSource)?.label || "Semua";

  return (
    <div className="app">
      {/* Minimalist Top Bar */}
      <header className="topbar">
        <div className="topbar-left">
          <button
            className="icon-btn menu-trigger"
            type="button"
            aria-label="Buka menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            ☰ Menu
          </button>
          <div className="brand">
            <h1>文法フラッシュカード</h1>
            <p>
              {view === "dashboard" ? "Dashboard Progres" : `${activeSourceLabel} · ${quizMode === "mixed" ? "Mixed" : QUIZ_MODE_LABELS[quizMode]}`}
            </p>
          </div>
        </div>

        <div className="topbar-right">
          {view === "dashboard" && !detailCard && (
            <button
              className="pill active"
              type="button"
              onClick={() => setView("study")}
            >
              📚 Belajar
            </button>
          )}
          <button
            className="icon-btn"
            type="button"
            aria-label="Ganti tema"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* Curtain Menu Overlay */}
      <div
        className={`curtain-backdrop ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside
        className={`curtain-menu ${menuOpen ? "open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <div className="curtain-inner">
          <div className="curtain-head">
            <div>
              <strong>Menu Belajar</strong>
              <span className="curtain-sub">HONSATSU 第22課・第23課・第24課 · FSRS</span>
            </div>
            <button
              className="icon-btn"
              type="button"
              onClick={() => setMenuOpen(false)}
            >
              ✕ Tutup
            </button>
          </div>

          <div className="curtain-section">
            <div className="curtain-label">Tampilan &amp; Profil</div>
            <div className="curtain-row">
              <button
                type="button"
                className={`pill ${view === "study" && !detailCard ? "active" : ""}`}
                onClick={() => {
                  if (detailCard) closePenjelasan();
                  setView("study");
                  setMenuOpen(false);
                }}
              >
                📚 Belajar
              </button>
              <button
                type="button"
                className={`pill ${view === "dashboard" && !detailCard ? "active" : ""}`}
                onClick={() => {
                  if (detailCard) closePenjelasan();
                  setView("dashboard");
                  setMenuOpen(false);
                }}
              >
                📊 Dashboard Progres
              </button>
              <select
                aria-label="Profil pengguna"
                className="select-input"
                value={store.activeUserId}
                onChange={(e) => handleSwitchUser(e.target.value)}
              >
                {Object.values(store.users).map((u) => (
                  <option key={u.id} value={u.id}>
                    👤 {u.name}
                  </option>
                ))}
              </select>
              <button className="icon-btn" type="button" onClick={handleAddUser}>
                +Profil
              </button>
            </div>
          </div>

          <div className="curtain-section">
            <div className="curtain-label">Sumber Kartu</div>
            <div className="curtain-row">
              {DECK_SOURCES.map((src) => (
                <button
                  key={src.key}
                  type="button"
                  className={`pill ${deckSource === src.key ? "active" : ""}`}
                  onClick={() => {
                    if (detailCard) closePenjelasan();
                    switchDeckSource(src.key);
                    setView("study");
                    setMenuOpen(false);
                  }}
                >
                  {src.key === "daily"
                    ? `${src.label} (${dailyPlan.remainingCount})`
                    : src.key === "weak"
                    ? `${src.label} (${weakWordsList.length})`
                    : src.label}
                </button>
              ))}
              {deckSource !== "daily" && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    switchDeckSource(deckSource, true);
                    setView("study");
                    setMenuOpen(false);
                  }}
                >
                  🔀 Acak Urutan
                </button>
              )}
            </div>
          </div>

          <div className="curtain-section">
            <div className="curtain-label">Mode Pengujian</div>
            <div className="curtain-row">
              <select
                aria-label="Mode Pengujian"
                className="select-input"
                value={quizMode}
                onChange={(e) => {
                  setQuizMode(e.target.value);
                  setIsFlipped(false);
                }}
              >
                {Object.entries(QUIZ_MODE_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
                <option value="mixed">🎲 Mixed Review (Campur Mode)</option>
              </select>
            </div>
          </div>
        </div>
      </aside>

      {detailCard ? (
        <PenjelasanPage card={detailCard} onBack={closePenjelasan} />
      ) : view === "dashboard" ? (
        <DashboardPage
          analytics={analytics}
          dailyPlan={dailyPlan}
          dailyNewTarget={dailyNewTarget}
          onChangeDailyTarget={(val) => {
            setStore((prev) => ({
              ...prev,
              users: {
                ...prev.users,
                [activeUser.id]: { ...activeUser, dailyNewTarget: val },
              },
            }));
          }}
          onStartDailyReview={() => {
            switchDeckSource("daily");
            setView("study");
          }}
          onStartWeakWords={() => {
            switchDeckSource("weak");
            setView("study");
          }}
          onOpenPenjelasan={openPenjelasan}
        />
      ) : (
        <main>
          <section className="progress-wrap">
            <div className="progress-stats">
              <div className="stat-group">
                <span className="stat-dot">
                  <span className="dot known" /> Dikuasai: {analytics.masteredCount}
                </span>
                <span className="stat-dot">
                  <span className="dot learning" /> Dipelajari: {analytics.inProgressCount}
                </span>
                <span className="stat-dot">
                  <span className="dot review" /> Perlu Diulang: {analytics.dueReviewCount}
                </span>
              </div>
              <strong>Sisa antrean: {queue.length}</strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-known"
                style={{ width: `${(analytics.masteredCount / analytics.totalCards) * 100}%` }}
              />
              <div
                className="progress-learning"
                style={{ width: `${(analytics.inProgressCount / analytics.totalCards) * 100}%` }}
              />
            </div>
          </section>

          {currentCard ? (
            <>
              <Flashcard
                key={`${currentCard.id}_${turnCounter}`}
                card={currentCard}
                allCards={CARDS}
                masteryLevel={currentMastery}
                isWeak={weakSet.has(currentCard.id)}
                mode={effectiveMode}
                isFlipped={isFlipped}
                onFlip={() => setIsFlipped((f) => !f)}
                onOpenPenjelasan={() => openPenjelasan(currentCard.id)}
              />

              <div className="fsrs-controls">
                <button
                  className="fsrs-btn fsrs-again"
                  type="button"
                  disabled={!isFlipped}
                  onClick={() => handleRate(RATINGS.AGAIN)}
                >
                  <span className="fsrs-title">Sulit (1)</span>
                  <span className="fsrs-sub">
                    {intervalPreviews ? intervalPreviews.sulit : "5 menit"}
                  </span>
                </button>
                <button
                  className="fsrs-btn fsrs-easy"
                  type="button"
                  disabled={!isFlipped}
                  onClick={() => handleRate(RATINGS.GOOD)}
                >
                  <span className="fsrs-title">Mudah (2)</span>
                  <span className="fsrs-sub">
                    {intervalPreviews ? intervalPreviews.mudah : "15 menit"}
                  </span>
                </button>
              </div>

              {!isFlipped && (
                <div className="gate-hint">
                  🔒 Balik kartu terlebih dahulu sebelum menilai (Sulit / Mudah)
                </div>
              )}
            </>
          ) : (
            <section className="empty-state">
              <h2>
                {deckSource === "daily"
                  ? "🎉 Daily Review hari ini selesai!"
                  : deckSource === "weak"
                  ? "✨ Tidak ada Weak Words saat ini!"
                  : "🎉 Semua kartu pada pilihan ini selesai diuji!"}
              </h2>
              <p style={{ color: "var(--text-muted)", margin: "8px 0 16px" }}>
                Cek perkembanganmu di Dashboard atau pilih bab / mode lain untuk latihan tambahan.
              </p>
              <div className="dash-actions" style={{ justifyContent: "center" }}>
                <button
                  className="btn-penjelasan"
                  type="button"
                  onClick={() => setView("dashboard")}
                >
                  📊 Buka Dashboard Progres
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => switchDeckSource("all", true)}
                >
                  🔀 Latihan Semua Bab
                </button>
              </div>
            </section>
          )}

          <div className="kbd-hint">
            Shortcut: <kbd>Space</kbd> Balik · <kbd>1</kbd> Sulit · <kbd>2</kbd> Mudah ·{" "}
            <kbd>P</kbd> Penjelasan
          </div>
        </main>
      )}
    </div>
  );
}
