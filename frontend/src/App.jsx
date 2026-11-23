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
const SOL_PURPLE = '#A855F7';

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

const formatVolumeCMC = (vol) => {
  if (!vol) return '—';
  if (vol >= 1e9) return '$' + (vol / 1e9).toFixed(2) + 'B';
  return '$' + (vol / 1e6).toFixed(1) + 'M';
};

export default function App() {
  const [marketData, setMarketData] = useState(null);   // data pasar dari /api/market
  const [predData, setPredData] = useState(null);       // data prediksi dari /api/predict
  const [chartData, setChartData] = useState({ labels: [], prices: [], predicted_prices: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [intervalVal, setIntervalVal] = useState('1 Hari');
  const [periodeVal, setPeriodeVal] = useState('1 Bulan');
  const [history, setHistory] = useState([]);
  const [hasPredicted, setHasPredicted] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 5;

  // ─── 1. AMBIL RIWAYAT DARI DATABASE SQLITE ───
  const fetchHistory = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/history');
      if (!res.ok) throw new Error('Gagal mengambil riwayat');
      const data = await res.json();
      if (Array.isArray(data)) {
        setHistory(data);
        setCurrentPage(1); // reset ke halaman 1 setiap kali data baru masuk
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  // ─── 2. AMBIL DATA PASAR SAJA SAAT LOAD AWAL (TIDAK SIMPAN KE DB) ───
  // FIX #1: Gunakan /api/market bukan /api/predict agar tidak menyimpan ke DB
  const fetchInitialMarketData = async (periode = '1 Bulan') => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/market?periode=${encodeURIComponent(periode)}`);
      if (!res.ok) throw new Error('Gagal memuat data pasar');
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      setMarketData(data.market_data);
      setChartData(data.chart_data);
    } catch (err) {
      console.error('Initial market load error:', err.message);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchInitialMarketData(periodeVal);
  }, []);

  // ─── 3. EKSEKUSI PREDIKSI MANUAL SAAT TOMBOL DIKLIK ───
  const runPrediction = () => {
    setLoading(true);
    setError(null);

    const daysNum = parseInt(intervalVal) || 1;

    fetch(`http://127.0.0.1:8000/api/predict?days=${daysNum}&periode=${encodeURIComponent(periodeVal)}`)
      .then((r) => { if (!r.ok) throw new Error('Server error ' + r.status); return r.json(); })
      .then((d) => {
        if (d?.error) throw new Error(d.error);
        setMarketData(d.market_data);
        setPredData(d.prediction);
        setChartData(d.chart_data);
        setHasPredicted(true);
        fetchHistory();
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  // ─── 4. RELOAD GRAFIK SAAT PERIODE HISTORIS BERUBAH ───
  const handlePeriodeChange = (newPeriode) => {
    setPeriodeVal(newPeriode);
    setHasPredicted(false);
    setPredData(null);
    fetchInitialMarketData(newPeriode);
  };

  const market = marketData ?? null;
  const pred = hasPredicted ? (predData ?? null) : null;
  const chart = chartData;

  const isUp = market ? market.price_change >= 0 : true;
  const fDelta = (market && pred) ? pred.forecast_price - market.current_price : 0;
  const fUp = fDelta >= 0;
  const fPct = market?.current_price > 0 ? ((fDelta / market.current_price) * 100).toFixed(2) : '0.00';

  const isPredUp = fDelta > 0;
  const isPredDown = fDelta < 0;
  const predDirectionLabel = !pred ? null : isPredUp ? '▲ Naik' : isPredDown ? '▼ Turun' : '► Stabil';
  const predDirectionColor = isPredUp ? SOL_GREEN : isPredDown ? '#f87171' : '#9ca3af';

  // ─── PENYUSUNAN DATA GRAFIK ───
  // Saat hasPredicted: labels sudah include target date dari backend (16 label)
  // Saat belum prediksi: labels 15 hari historis
  const combinedLabels = chart.labels;

  // Garis aktual: dari chart_data.prices (sudah berisi null di posisi terakhir saat prediksi)
  const actualLine = chart.prices;

  // Garis prediksi: hanya tampil saat sudah klik prediksi
  const predictedLine = (hasPredicted && chart.predicted_prices?.length > 0)
    ? chart.predicted_prices
    : [];

  const datasetsList = [
    {
      label: 'Harga Asli Solana',
      data: actualLine,
      borderColor: '#e5e7eb',
      backgroundColor: 'transparent',
      tension: 0.2,
      borderWidth: 2,
      pointRadius: 2,
      pointBackgroundColor: '#e5e7eb',
      fill: false,
      order: 2,
    }
  ];

  if (hasPredicted && predictedLine.length > 0) {
    datasetsList.push({
      label: `Harga Prediksi (LSTM) - ${intervalVal}`,
      data: predictedLine,
      borderColor: SOL_GREEN,
      backgroundColor: 'transparent',
      tension: 0.4,
      borderWidth: 2.5,
      pointRadius: (ctx) => ctx.dataIndex === combinedLabels.length - 1 ? 6 : 1.5,
      pointBackgroundColor: SOL_GREEN,
      fill: false,
      order: 1,
    });
  }

  const combinedChartData = {
    labels: combinedLabels,
    datasets: datasetsList
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
        borderColor: 'rgba(20,241,149,0.4)',
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
          <p style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>⚙ Dashboard</p>
          <label style={{ fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span>🕐</span> Time Interval
          </label>
          <select
            value={intervalVal} onChange={(e) => {
              setIntervalVal(e.target.value);
              // Reset hasil prediksi agar tidak tampil hasil lama saat interval berubah
              setHasPredicted(false);
              setPredData(null);
            }}
            style={{ width: '100%', background: '#161635', border: '1px solid rgba(153,69,255,0.25)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', cursor: 'pointer' }}
          >
            <option>1 Hari</option>
            <option>3 Hari</option>
            <option>7 Hari</option>
          </select>
        </div>

        {/* Dropdown Periode Historis */}
        <div>
          <label style={{ fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span>📅</span> Periode Historis
          </label>
          <select
            value={periodeVal} onChange={(e) => handlePeriodeChange(e.target.value)}
            style={{ width: '100%', background: '#161635', border: '1px solid rgba(153,69,255,0.25)', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', cursor: 'pointer' }}
          >
            <option>1 Bulan</option>
            <option>3 Bulan</option>
            <option>6 Bulan</option>
          </select>
        </div>

        <button
          onClick={runPrediction} disabled={loading}
          style={{ width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', background: loading ? '#4c2a9e' : 'linear-gradient(135deg,#9945FF,#7c2fe0)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {loading ? (
            <><span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Loading...</>
          ) : 'Jalankan Prediksi'}
        </button>

        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: error ? '#f87171' : market ? SOL_GREEN : '#6b7280', animation: (!error && market) ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontSize: 10, color: error ? '#f87171' : '#6b7280', letterSpacing: '0.08em' }}>
            {error ? 'OFFLINE' : market ? 'LIVE' : 'STANDBY'}
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

        {/* 4 METRIC CARDS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          {/* Card 1: Live Price */}
          <div style={cardStyle(SOL_GREEN)}>
            <div style={topBar(SOL_GREEN)} />
            <p style={lbl}>Harga Live SOL/USD</p>
            <p style={{ ...val, color: '#fff' }}>
              {market ? '$' + market.current_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
            </p>
            <p style={{ fontSize: 11, fontWeight: 600, color: isUp ? SOL_GREEN : '#f87171', marginTop: 4 }}>
              {market ? (isUp ? '▲ ' : '▼ ') + Math.abs(market.price_change_percent).toFixed(2) + '% (24j)' : '—'}
            </p>
          </div>

          {/* Card 2: Prediction */}
          <div style={cardStyle(SOL_PURPLE)}>
            <div style={topBar(SOL_PURPLE)} />
            <p style={lbl}>Prediksi LSTM ({intervalVal})</p>
            <p style={{ ...val, color: SOL_PURPLE }}>{pred ? '$' + pred.forecast_price.toFixed(2) : '—'}</p>
            <p style={{ fontSize: 11, fontWeight: 600, color: fUp ? SOL_GREEN : '#f87171', marginTop: 4 }}>
              {pred ? (fUp ? '▲ +' : '▼ ') + fDelta.toFixed(2) + ' (' + fPct + '%)' : '—'}
            </p>
          </div>

          {/* Card 3: Volume */}
          <div style={cardStyle('#60a5fa')}>
            <div style={topBar('#60a5fa')} />
            <p style={lbl}>Volume 24j</p>
            <p style={{ ...val, color: '#93c5fd' }}>{market ? formatVolumeCMC(market.volume_24h) : '—'}</p>
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Market volume harian</p>
          </div>

          {/* Card 4: MAPE (menggantikan RSI) */}
          <div style={cardStyle('#34d399')}>
            <div style={topBar('#34d399')} />
            <p style={lbl}>MAPE — Tingkat Akurasi Model</p>
            <p style={{ ...val, color: '#34d399' }}>
              {pred?.mape != null ? pred.mape.toFixed(2) + '%' : '—'}
            </p>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>
              Akurasi:&nbsp;
              <span style={{ color: pred?.akurasi >= 90 ? '#34d399' : pred?.akurasi >= 70 ? '#fbbf24' : pred?.akurasi != null ? '#f87171' : '#6b7280', fontWeight: 700 }}>
                {pred?.akurasi != null ? pred.akurasi.toFixed(2) + '%' : '—'}
              </span>
            </p>
          </div>
        </div>

        {/* RMSE CARD — hanya tampil setelah prediksi dijalankan */}
        {hasPredicted && pred && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
            <div style={cardStyle('#f472b6')}>
              <div style={topBar('#f472b6')} />
              <p style={lbl}>RMSE — Rata-rata Error Prediksi</p>
              <p style={{ ...val, color: '#f472b6' }}>
                {pred.rmse !== null ? '$' + pred.rmse.toFixed(2) : '—'}
              </p>
            </div>
          </div>
        )}

        {/* ─── GRAFIK ─── */}
        <div style={{ background: '#0f0f28', border: '1px solid rgba(153,69,255,0.18)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb' }}>Harga SOL — Perbandingan Harga Asli vs Prediksi (LSTM)</p>
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Historis {periodeVal} + proyeksi {intervalVal} ke depan</p>
            </div>
            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#e5e7eb' }}>
                <span style={{ display: 'inline-block', width: 20, height: 2, background: '#e5e7eb', borderRadius: 2 }} />
                Harga Asli Solana
              </span>
              {hasPredicted && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: SOL_GREEN }}>
                  <span style={{ display: 'inline-block', width: 20, height: 2.5, background: SOL_GREEN, borderRadius: 2 }} />
                  Harga Prediksi (LSTM)
                </span>
              )}
            </div>
          </div>

          <div style={{ height: 320 }}>
            {hasData ? (
              <Line data={combinedChartData} options={chartOptions} />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: 13 }}>
                Memuat data pasar...
              </div>
            )}
          </div>
        </div>

        {/* ─── HISTORY TABLE ─── */}
        <div style={{ background: '#0f0f28', border: '1px solid rgba(153,69,255,0.18)', borderRadius: 16, padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: '#e5e7eb' }}>📋 Riwayat Hasil Prediksi Sistem</p>
            {history.length > 0 && (
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                Total: {history.length} prediksi
              </span>
            )}
          </div>
          {history.length === 0 ? (
            <p style={{ color: '#4b5563', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Belum ada riwayat. Klik "Jalankan Prediksi" untuk memulai.</p>
          ) : (() => {
            const totalPages = Math.ceil(history.length / ROWS_PER_PAGE);
            const startIdx = (currentPage - 1) * ROWS_PER_PAGE;
            const pageData = history.slice(startIdx, startIdx + ROWS_PER_PAGE);

            return (
              <>
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
                      {pageData.map((row, i) => {
                        const diff = row.selisih ?? (row.prediksi_lstm - row.harga_saat_ini);
                        const dUp = diff >= 0;
                        const isFirst = currentPage === 1 && i === 0;
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: isFirst ? 'rgba(153,69,255,0.06)' : 'transparent' }}>
                            <td style={td}><span style={{ color: '#e5e7eb' }}>{row.waktu}</span></td>
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

                {/* ─── PAGINATION ─── */}
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 }}>
                    {/* Tombol Prev */}
                    <button
                      onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                      disabled={currentPage === 1}
                      style={{
                        padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(153,69,255,0.3)',
                        background: currentPage === 1 ? 'transparent' : 'rgba(153,69,255,0.15)',
                        color: currentPage === 1 ? '#4b5563' : '#e5e7eb',
                        cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600
                      }}
                    >← Prev</button>

                    {/* Info Halaman */}
                    <span style={{ fontSize: 11, color: '#6b7280', padding: '0 8px' }}>
                      {currentPage} / {totalPages}
                    </span>

                    {/* Tombol Next */}
                    <button
                      onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      style={{
                        padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(153,69,255,0.3)',
                        background: currentPage === totalPages ? 'transparent' : 'rgba(153,69,255,0.15)',
                        color: currentPage === totalPages ? '#4b5563' : '#e5e7eb',
                        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600
                      }}
                    >Next →</button>
                  </div>
                )}
              </>
            );
          })()}
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
