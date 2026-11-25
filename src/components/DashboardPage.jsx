import { useState } from "react";
import { MASTERY_LEVELS, MASTERY_META } from "../utils/mastery";

function BarChartSvg({ data, valueKey, maxVal, color, emptyLabel }) {
  const hasAny = data.some((d) => d[valueKey] !== null && d[valueKey] > 0);
  if (!hasAny) {
    return <div className="chart-empty">{emptyLabel}</div>;
  }

  const width = 420;
  const height = 130;
  const padBottom = 22;
  const chartH = height - padBottom - 10;
  const barW = Math.max(10, Math.floor((width - 20) / data.length) - 6);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img">
      {data.map((d, idx) => {
        const val = d[valueKey] || 0;
        const h = maxVal > 0 ? Math.round((val / maxVal) * chartH) : 0;
        const x = 10 + idx * ((width - 20) / data.length);
        const y = 10 + (chartH - h);
        return (
          <g key={d.dateKey}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(2, h)}
              rx="4"
              fill={val > 0 ? color : "var(--border)"}
              opacity={val > 0 ? 0.9 : 0.35}
            >
              <title>{`${d.dateKey}: ${val}`}</title>
            </rect>
            {(idx % 2 === 0 || data.length <= 7) && (
              <text
                x={x + barW / 2}
                y={height - 5}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-muted)"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function DashboardPage({
  analytics,
  dailyPlan,
  dailyNewTarget,
  onChangeDailyTarget,
  onStartDailyReview,
  onStartWeakWords,
  onOpenPenjelasan,
}) {
  const [period, setPeriod] = useState(30);

  const maxReviews = Math.max(1, ...analytics.dailySeries.map((d) => d.reviews));
  const masteryOrder = [
    MASTERY_LEVELS.MASTERED,
    MASTERY_LEVELS.FAMILIAR,
    MASTERY_LEVELS.LEARNING,
    MASTERY_LEVELS.RECOGNIZED,
    MASTERY_LEVELS.UNSEEN,
  ];

  const highestErrChapter = [...analytics.chapterBreakdown]
    .filter((c) => c.reviews > 0)
    .sort((a, b) => b.errorRate - a.errorRate)[0];

  return (
    <div className="dashboard">
      {/* Ringkasan Utama */}
      <section className="dash-grid-4">
        <div className="dash-kpi">
          <div className="kpi-label">Total Kosakata</div>
          <div className="kpi-value">{analytics.totalCards}</div>
          <div className="kpi-sub">3 Bab (22–24)</div>
        </div>
        <div className="dash-kpi kpi-success">
          <div className="kpi-label">Dikuasai</div>
          <div className="kpi-value">{analytics.masteredCount}</div>
          <div className="kpi-sub">Retensi jangka panjang</div>
        </div>
        <div className="dash-kpi kpi-accent">
          <div className="kpi-label">Sedang Dipelajari</div>
          <div className="kpi-value">{analytics.inProgressCount}</div>
          <div className="kpi-sub">Baru – Cukup hafal</div>
        </div>
        <div className="dash-kpi kpi-warn">
          <div className="kpi-label">Perlu Diulang</div>
          <div className="kpi-value">{analytics.dueReviewCount}</div>
          <div className="kpi-sub">Jatuh tempo / terlambat</div>
        </div>
      </section>

      {/* Informasi Pembelajaran Hari Ini */}
      <section className="dash-card">
        <div className="dash-card-head">
          <div>
            <h3>📅 Pembelajaran Hari Ini (Daily Review)</h3>
            <p className="dash-sub">
              Prioritas: Terlambat → Weak Words → Jatuh tempo hari ini → Kartu baru
            </p>
          </div>
          <div className="target-control">
            <label htmlFor="dailyTarget">Target baru/hari:</label>
            <input
              id="dailyTarget"
              type="number"
              min="1"
              max="20"
              value={dailyNewTarget}
              onChange={(e) => onChangeDailyTarget(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
            />
          </div>
        </div>

        <div className="today-grid">
          <div className="today-stat">
            <span>Review harus selesai</span>
            <strong>{dailyPlan.dueCount} kartu</strong>
          </div>
          <div className="today-stat">
            <span>Materi baru hari ini</span>
            <strong>{dailyPlan.newCount} kartu</strong>
          </div>
          <div className="today-stat">
            <span>Selesai hari ini</span>
            <strong>{dailyPlan.completedTodayCount} kartu</strong>
          </div>
          <div className="today-stat">
            <span>Tertunda / Perkiraan</span>
            <strong>
              {dailyPlan.remainingCount} kartu (~{dailyPlan.estimatedMinutes} mnt)
            </strong>
          </div>
        </div>

        <div className="dash-actions">
          <button
            type="button"
            className="btn-penjelasan"
            disabled={dailyPlan.remainingCount === 0}
            onClick={onStartDailyReview}
          >
            🚀 Mulai Daily Review ({dailyPlan.remainingCount})
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={analytics.weakWords.length === 0}
            onClick={onStartWeakWords}
          >
            ⚠️ Latih Weak Words ({analytics.weakWords.length})
          </button>
        </div>
      </section>

      {/* Metrik Kemampuan Aktual */}
      <section className="dash-card">
        <div className="dash-card-head">
          <h3>📊 Pengukuran Kemampuan Aktual</h3>
          <div className="pills">
            {[7, 30, "all"].map((p) => (
              <button
                key={p}
                type="button"
                className={`pill ${period === p ? "active" : ""}`}
                onClick={() => setPeriod(p)}
              >
                {p === "all" ? "Semua" : `${p} Hari`}
              </button>
            ))}
          </div>
        </div>

        <div className="today-grid">
          <div className="today-stat">
            <span>Akurasi Jawaban</span>
            <strong>
              {analytics.accuracyPct !== null ? `${analytics.accuracyPct}%` : "Belum ada data"}
            </strong>
            <small>{analytics.totalPeriodReviews} pengujian tercatat</small>
          </div>
          <div className="today-stat">
            <span>Retensi Keseluruhan</span>
            <strong>
              {analytics.overallRetentionPct !== null
                ? `${analytics.overallRetentionPct}%`
                : "Belum ada data"}
            </strong>
            <small>Setelah jeda waktu</small>
          </div>
          <div className="today-stat">
            <span>Retensi Jangka Pendek / Panjang</span>
            <strong>
              {analytics.shortTermRetentionPct !== null ? `${analytics.shortTermRetentionPct}%` : "—"}
              {" / "}
              {analytics.longTermRetentionPct !== null ? `${analytics.longTermRetentionPct}%` : "—"}
            </strong>
            <small>&lt; 7 hari / ≥ 7 hari</small>
          </div>
          <div className="today-stat">
            <span>Konsistensi Belajar</span>
            <strong>{analytics.consistencyDays} hari aktif</strong>
            <small>Dihitung dari aktivitas pengujian</small>
          </div>
        </div>
      </section>

      {/* Grafik Perkembangan */}
      <section className="dash-grid-2">
        <div className="dash-card">
          <h3>🎯 Distribusi Tingkat Penguasaan</h3>
          <div className="mastery-bars">
            {masteryOrder.map((lvl) => {
              const count = analytics.masteryCounts[lvl] || 0;
              const pct = Math.round((count / analytics.totalCards) * 100);
              const meta = MASTERY_META[lvl];
              return (
                <div key={lvl} className="mbar-row">
                  <div className="mbar-label">
                    <span className={`status-badge ${meta.cls}`}>{meta.label}</span>
                    <span>
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="mbar-track">
                    <div className={`mbar-fill ${meta.cls}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dash-card">
          <h3>📈 Riwayat Aktivitas Belajar (14 Hari)</h3>
          <BarChartSvg
            data={analytics.dailySeries}
            valueKey="reviews"
            maxVal={maxReviews}
            color="var(--accent)"
            emptyLabel="Belum ada aktivitas pengujian tercatat."
          />
        </div>

        <div className="dash-card">
          <h3>🎯 Grafik Akurasi Jawaban (%)</h3>
          <BarChartSvg
            data={analytics.dailySeries}
            valueKey="accuracy"
            maxVal={100}
            color="var(--success)"
            emptyLabel="Belum ada data akurasi harian."
          />
        </div>

        <div className="dash-card">
          <h3>🧠 Grafik Retensi Hafalan (%)</h3>
          <BarChartSvg
            data={analytics.dailySeries}
            valueKey="retention"
            maxVal={100}
            color="var(--warn)"
            emptyLabel="Data retensi muncul setelah kartu diuji ulang melewati jeda waktu."
          />
        </div>
      </section>

      {/* Analisis Kemampuan: Terkuat, Weak Words, Kategori */}
      <section className="dash-grid-2">
        <div className="dash-card">
          <h3>⚠️ Weak Words (Perlu Perhatian)</h3>
          {analytics.weakWords.length === 0 ? (
            <p className="dash-sub">Belum ada kartu lemah yang terdeteksi.</p>
          ) : (
            <ul className="analysis-list">
              {analytics.weakWords.slice(0, 6).map(({ card, state }) => (
                <li key={card.id}>
                  <div>
                    <strong>{card.bunpou}</strong>{" "}
                    <span className="dash-sub">· {card.arti}</span>
                    <div className="dash-sub">
                      Salah: {state.againCount}x · Hard: {state.hardCount}x · Rata-rata:{" "}
                      {Math.round((state.avgResponseMs || 0) / 1000)} dtk
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => onOpenPenjelasan(card.id)}
                  >
                    📖
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dash-card">
          <h3>💪 Kosakata Terkuat & Analisis Bab</h3>
          {analytics.strongestCards.length === 0 ? (
            <p className="dash-sub">Mulai uji kartu untuk melihat peringkat kekuatan.</p>
          ) : (
            <ul className="analysis-list">
              {analytics.strongestCards.map(({ card, state }) => (
                <li key={card.id}>
                  <div>
                    <strong>{card.bunpou}</strong>{" "}
                    <span className="dash-sub">· Stabilitas {state.stability} hr</span>
                  </div>
                  <span className="badge">第{card.ch}課</span>
                </li>
              ))}
            </ul>
          )}

          <div className="chapter-err-box">
            <div className="info-label">Tingkat Kesalahan per Bab</div>
            {analytics.chapterBreakdown.map((ch) => (
              <div key={ch.chapter} className="ch-err-row">
                <span>第{ch.chapter}課 (Bab {ch.chapter})</span>
                <span>
                  {ch.reviews > 0
                    ? `${ch.errorRate}% salah (${ch.errors}/${ch.reviews})`
                    : "Belum diuji"}
                </span>
              </div>
            ))}
            {highestErrChapter && (
              <p className="dash-sub" style={{ marginTop: 6 }}>
                Bab dengan kesalahan tertinggi saat ini: <strong>Bab {highestErrChapter.chapter}</strong>
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
