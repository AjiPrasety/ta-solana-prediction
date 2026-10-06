import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const SOL_GREEN = '#14F195';
const SOL_PURPLE = '#9945FF';

function SolanaIcon({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 397.7 311.7" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sg" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path fill="url(#sg)" d="M64.6 237.9a14 14 0 0 1 9.9-4.1h317.4c6.2 0 9.4 7.5 5 12l-62.7 62.7a14 14 0 0 1-9.9 4.1H6.9c-6.2 0-9.4-7.5-5-12l62.7-62.7z" />
      <path fill="url(#sg)" d="M64.6 4.1A14.3 14.3 0 0 1 74.5 0h317.4c6.2 0 9.4 7.5 5 12L334.2 74.7a14 14 0 0 1-9.9 4.1H6.9c-6.2 0-9.4-7.5-5-12L64.6 4.1z" />
      <path fill="url(#sg)" d="M333.1 120.1a14 14 0 0 0-9.9-4.1H5.8c-6.2 0-9.4 7.5-5 12l62.7 62.7a14 14 0 0 0 9.9 4.1h317.4c6.2 0 9.4-7.5 5-12l-62.7-62.7z" />
    </svg>
  );
}

const cardStyle = (accent) => ({
  position: 'relative', background: '#0f0f28',
  border: '1px solid ' + accent + '22', borderRadius: 14,
  padding: '16px 18px', overflow: 'hidden',
});
const topBar = (color) => ({
  position: 'absolute', top: 0, left: 0, right: 0,
  height: 2, background: color, opacity: 0.75,
});
const lbl = { fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 8 };
const val = { fontSize: 26, fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em' };
const td = { padding: '10px 12px', verticalAlign: 'middle' };

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [intervalVal, setIntervalVal] = useState('1 Hari');
  const [history, setHistory] = useState([]);

  // ─── AMBIL RIWAYAT DARI DATABASE SQLITE ───
  const fetchHistory = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/history');
      if (!response.ok) throw new Error('Gagal mengambil riwayat');
      const dataHistory = await response.json();
      if (Array.isArray(dataHistory)) {
        setHistory(dataHistory);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  // Ambil riwayat dari SQLite saat halaman pertama kali dimuat
  useEffect(() => {
    fetchHistory();
  }, []);

  // ─── EKSEKUSI PREDIKSI ───
  const runPrediction = () => {
    setLoading(true);
    setError(null);
    fetch('http://127.0.0.1:8000/api/predict')
      .then((r) => { if (!r.ok) throw new Error('Server error ' + r.status); return r.json(); })
      .then((d) => {
        if (d?.error) throw new Error(d.error);
        setData(d);
        // Panggil ulang riwayat dari database SQLite agar tabel langsung ter-update
        fetchHistory();
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { runPrediction(); }, []);

  const market = data?.market_data ?? null;
  const pred = data?.prediction ?? null;
  const chart = data?.chart_data ?? { labels: [], prices: [] };

  const isUp = market ? market.price_change >= 0 : true;
  const fDelta = (market && pred) ? pred.forecast_price - market.current_price : 0;
  const fUp = fDelta >= 0;
  const fPct = market?.current_price > 0 ? ((fDelta / market.current_price) * 100).toFixed(2) : '0.00';
  const rsiLabel = !market ? '-' : market.rsi_14 > 70 ? 'Overbought' : market.rsi_14 < 30 ? 'Oversold' : 'Neutral';

  // ── 1 grafik, 2 line ──────────────────────────────────────────────────
  const predLabel = pred ? (pred.target_date?.split(' ')[0] ?? 'Besok') : null;
  const combinedLabels = predLabel ? [...chart.labels, predLabel] : chart.labels;

  const actualLine = pred ? [...chart.prices, null] : [...chart.prices];

  const predLine = pred && chart.prices.length > 0
    ? [...Array(chart.prices.length - 1).fill(null), chart.prices[chart.prices.length - 1], pred.forecast_price]
    : [];

  const combinedData = {
    labels: combinedLabels,
    datasets: [
      {
        label: 'Harga Aktual',
        data: actualLine,
        borderColor: SOL_GREEN,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
          g.addColorStop(0, 'rgba(20,241,149,0.20)');
          g.addColorStop(1, 'rgba(20,241,149,0.00)');
          return g;
        },
        tension: 0.4, borderWidth: 2.5,
        pointRadius: 4, pointBackgroundColor: SOL_GREEN,
        pointBorderColor: '#0b0b1e', pointBorderWidth: 2,
        fill: true, spanGaps: false,
      },
      {
        label: 'Prediksi LSTM',
        data: predLine,
        borderColor: SOL_PURPLE,
        backgroundColor: 'transparent',
        borderDash: [6, 4],
        tension: 0.2, borderWidth: 2.5,
        pointRadius: (ctx) => ctx.dataIndex === combinedLabels.length - 1 ? 8 : 0,
        pointBackgroundColor: SOL_PURPLE,
        pointBorderColor: '#fff', pointBorderWidth: 2,
        fill: false, spanGaps: false,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12, padding: 18 }
      },
      tooltip: {
        backgroundColor: '#0f0f23',
        borderColor: 'rgba(153,69,255,0.4)',
        borderWidth: 1,
        titleColor: '#d1d5db',
        bodyColor: '#e5e7eb',
        padding: 10,
        callbacks: {
          label: (ctx) => {
            if (ctx.parsed.y === null) return null;
            const n = ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return '  ' + ctx.dataset.label + ': $' + n;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#6b7280', font: { size: 10 }, maxRotation: 30 },
        border: { color: 'rgba(255,255,255,0.06)' }
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          color: '#6b7280', font: { size: 10 },
          callback: (v) => '$' + Number(v).toLocaleString()
        },
        border: { color: 'rgba(255,255,255,0.06)' }
      }
    }
  };

  const hasData = chart.labels.length > 0;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0b0b1e', color: '#fff', fontFamily: 'Inter, sans-serif' }}>

      {/* ─── SIDEBAR ─── */}
      <aside style={{
        width: 220, minWidth: 220, background: '#0f0f28',
        borderRight: '1px solid rgba(153,69,255,0.18)',
        display: 'flex', flexDirection: 'column', padding: '24px 16px', gap: 24,
        position: 'sticky', top: 0, height: '100vh',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg,#9945FF,#14F195)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SolanaIcon size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: 1 }}>SOLANA</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: SOL_PURPLE, letterSpacing: 1 }}>PREDICTION</div>
          </div>
        </div>

        <div>
          <p style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>⚙ Configuration</p>
          <label style={{ fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span>🕐</span> Time Interval
          </label>
          <select
            value={intervalVal} onChange={(e) => setIntervalVal(e.target.value)}
            style={{ width: '100%', background: '#161635', border: '1px solid rgba(153,69,255,0.25)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', cursor: 'pointer' }}
          >
            <option>1 Hari</option>
            <option>3 Hari</option>
            <option>7 Hari</option>
          </select>
        </div>

        <button
          onClick={runPrediction} disabled={loading}
          style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', background: loading ? '#4c2a9e' : 'linear-gradient(135deg,#9945FF,#7c2fe0)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {loading ? (
            <><span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Loading...</>
          ) : 'Run Prediction'}
        </button>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: error ? '#f87171' : data ? SOL_GREEN : '#6b7280', animation: (!error && data) ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontSize: 10, color: error ? '#f87171' : '#6b7280', letterSpacing: '0.08em' }}>
            {error ? 'OFFLINE' : data ? 'LIVE' : 'STANDBY'}
          </span>
        </div>
      </aside>

      {/* ─── MAIN ─── */}
      <main style={{ flex: 1, padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Error banner */}
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p style={{ color: '#f87171', fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Error: Koneksi ke Backend terputus</p>
              <p style={{ color: '#9ca3af', fontSize: 11, fontFamily: 'monospace' }}>{error}</p>
            </div>
            <button onClick={runPrediction} style={{ background: '#1f1f3a', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Coba Lagi
            </button>
          </div>
        )}

        {/* 4 metric cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          <div style={cardStyle(SOL_GREEN)}>
            <div style={topBar(SOL_GREEN)} />
            <p style={lbl}>Harga Live SOL/USD</p>
            <p style={{ ...val, color: '#fff' }}>{market ? '$' + market.current_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: isUp ? SOL_GREEN : '#f87171', marginTop: 4 }}>
              {market ? (isUp ? '▲ ' : '▼ ') + Math.abs(market.price_change_percent).toFixed(2) + '% (24j)' : '—'}
            </p>
          </div>
          <div style={cardStyle(SOL_PURPLE)}>
            <div style={topBar(SOL_PURPLE)} />
            <p style={lbl}>Prediksi LSTM Besok</p>
            <p style={{ ...val, color: SOL_PURPLE }}>{pred ? '$' + pred.forecast_price.toFixed(2) : '—'}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: fUp ? SOL_GREEN : '#f87171', marginTop: 4 }}>
              {pred ? (fUp ? '▲ +' : '▼ ') + fDelta.toFixed(2) + ' (' + fPct + '%)' : '—'}
            </p>
          </div>
          <div style={cardStyle('#60a5fa')}>
            <div style={topBar('#60a5fa')} />
            <p style={lbl}>Volume 24j</p>
            <p style={{ ...val, color: '#93c5fd' }}>{market ? '$' + (market.volume_24h / 1e6).toFixed(1) + 'M' : '—'}</p>
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Market volume harian</p>
          </div>
          <div style={cardStyle('#fbbf24')}>
            <div style={topBar('#fbbf24')} />
            <p style={lbl}>RSI (14)</p>
            <p style={{ ...val, color: '#fbbf24' }}>{market ? market.rsi_14.toFixed(2) : '—'}</p>
            <p style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: market?.rsi_14 > 70 ? '#f87171' : market?.rsi_14 < 30 ? SOL_GREEN : '#9ca3af' }}>
              {rsiLabel}
            </p>
          </div>
        </div>

        {/* ─── 1 GRAFIK 2 LINE ─── */}
        <div style={{ background: '#0f0f28', border: '1px solid rgba(153,69,255,0.18)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb' }}>Harga SOL — Aktual &amp; Prediksi LSTM</p>
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>15 hari historis + proyeksi 1 hari ke depan</p>
            </div>
            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: SOL_GREEN }}>
                <span style={{ display: 'inline-block', width: 20, height: 2.5, background: SOL_GREEN, borderRadius: 2 }} />
                Aktual
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: SOL_PURPLE }}>
                <span style={{ display: 'inline-block', width: 20, height: 0, borderTop: '2.5px dashed ' + SOL_PURPLE }} />
                Prediksi
              </span>
            </div>
          </div>

          <div style={{ height: 300 }}>
            {hasData ? (
              <Line data={combinedData} options={chartOptions} />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 13 }}>
                Jalankan prediksi untuk melihat grafik
              </div>
            )}
          </div>
        </div>

        {/* ─── HISTORY TABLE (PERMANENT FROM SQLITE) ─── */}
        <div style={{ background: '#0f0f28', border: '1px solid rgba(153,69,255,0.18)', borderRadius: 16, padding: '20px 22px' }}>
          <p style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb', marginBottom: 14 }}>📋 Riwayat Hasil Prediksi Sistem</p>
          {history.length === 0 ? (
            <p style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Belum ada riwayat. Klik "Run Prediction" untuk memulai.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    {['Waktu', 'Interval', 'Harga Saat Ini', 'Prediksi LSTM', 'Selisih', 'Target Tanggal'].map((h) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 10 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => {
                    const diff = row.selisih ?? (row.prediksi_lstm - row.harga_saat_ini);
                    const dUp = diff >= 0;
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i === 0 ? 'rgba(153,69,255,0.06)' : 'transparent' }}>
                        <td style={td}>
                          <span style={{ color: '#e5e7eb' }}>{row.waktu}</span>
                        </td>
                        <td style={td}>
                          <span style={{ background: 'rgba(153,69,255,0.15)', color: SOL_PURPLE, borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 600 }}>
                            {row.interval}
                          </span>
                        </td>
                        <td style={{ ...td, color: '#e5e7eb', fontFamily: 'monospace' }}>
                          {'$' + Number(row.harga_saat_ini).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ ...td, color: SOL_PURPLE, fontFamily: 'monospace', fontWeight: 700 }}>
                          {'$' + Number(row.prediksi_lstm).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ ...td, color: dUp ? SOL_GREEN : '#f87171', fontFamily: 'monospace', fontWeight: 600 }}>
                          {(dUp ? '+' : '') + Number(diff).toFixed(2)}
                        </td>
                        <td style={{ ...td, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11 }}>
                          {row.target_tanggal || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        select option { background: #161635; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: rgba(153,69,255,0.3); border-radius: 3px; }
      `}</style>
    </div>
  );
}