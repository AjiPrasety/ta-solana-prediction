from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np
import tensorflow as tf
from datetime import datetime, timedelta, timezone
import os
import sqlite3
import joblib

app = FastAPI(title="Solana LSTM Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_NAME = 'model_solana.h5'
SCALER_NAME = 'scaler.pkl'
DB_NAME = 'predictions.db'

# Mapping pilihan periode user ke period yfinance
# Buffer ekstra agar setelah dropna RSI(14) + MA20(20) + window(30) masih cukup
PERIODE_MAP = {
    '1 Bulan': '90d',   # tampil 30 hari, ambil 90d sebagai buffer
    '3 Bulan': '150d',  # tampil 90 hari, ambil 150d sebagai buffer
    '6 Bulan': '240d',  # tampil 180 hari, ambil 240d sebagai buffer
}
TAMPIL_MAP = {
    '1 Bulan': 30,
    '3 Bulan': 90,
    '6 Bulan': 180,
}
LOOKBACK_WINDOW = 30


# --- INISIALISASI DATABASE SQLITE ---
def init_db():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                waktu TEXT,
                interval TEXT,
                harga_saat_ini REAL,
                prediksi_lstm REAL,
                selisih REAL,
                target_tanggal TEXT
            )
        ''')
        conn.commit()
        conn.close()
        print(">>> SUCCESS: Database SQLite siap digunakan!")
    except Exception as db_err:
        print(f">>> ERROR DATABASE: {str(db_err)}")

init_db()

# --- LOAD SCALER.PKL & MODEL ---
scaler = None
scaler_status = "Not Loaded"
try:
    if os.path.exists(SCALER_NAME):
        scaler = joblib.load(SCALER_NAME)
        scaler_status = "Active"
        print(">>> SUCCESS: Scaler pkl berhasil dimuat!")
    else:
        print(f">>> ERROR: File {SCALER_NAME} tidak ditemukan.")
except Exception as sc_err:
    print(f">>> ERROR CRITICAL LOAD SCALER: {str(sc_err)}")

try:
    if os.path.exists(MODEL_NAME):
        if hasattr(tf.keras.config, 'enable_unsafe_deserialization'):
            tf.keras.config.enable_unsafe_deserialization()
        try:
            from keras.initializers import GlorotUniform
            class FixedGlorotUniform(GlorotUniform):
                def __init__(self, **kwargs):
                    kwargs.pop('input_axes', None)
                    kwargs.pop('output_axes', None)
                    super().__init__(**kwargs)
            model = tf.keras.models.load_model(
                MODEL_NAME, compile=False,
                custom_objects={'GlorotUniform': FixedGlorotUniform}
            )
        except Exception:
            model = tf.keras.models.load_model(MODEL_NAME, compile=False)
        model_status = "Active"
        print(">>> SUCCESS: Model LSTM berhasil dimuat!")
    else:
        model = None
        model_status = f"File {MODEL_NAME} tidak ditemukan."
        print(f">>> ERROR: {model_status}")
except Exception as e:
    model = None
    model_status = f"Error loading model: {str(e)}"
    print(f">>> ERROR CRITICAL: {model_status}")


# --- FUNGSI HELPER: AMBIL & PROSES DATA PASAR ---
def fetch_market_data(periode: str = '1 Bulan'):
    yf_period = PERIODE_MAP.get(periode, '90d')
    df_raw = yf.download('SOL-USD', period=yf_period, interval='1d')
    if df_raw.empty:
        raise ValueError("Gagal mengambil data dari Yahoo Finance.")
    if isinstance(df_raw.columns, pd.MultiIndex):
        df_raw.columns = df_raw.columns.get_level_values(0)

    df = df_raw[['Open', 'High', 'Low', 'Close', 'Volume']].dropna().copy()

    # RSI (14) dengan handle NaN/Infinity
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['RSI'] = (100 - (100 / (1 + rs))).fillna(50).clip(0, 100)

    # MA20
    df['MA20'] = df['Close'].rolling(window=20).mean()
    df.dropna(inplace=True)

    return df[['Open', 'High', 'Low', 'Close', 'Volume', 'RSI', 'MA20']]


# --- FUNGSI HELPER: HITUNG PREDIKSI HISTORIS ---
def hitung_historis_prediksi(scaled_data, n_tampil, num_features):
    """Loop prediksi historis dengan start aman (minimal LOOKBACK_WINDOW dari awal)."""
    start = len(scaled_data) - n_tampil
    start = max(start, LOOKBACK_WINDOW)
    hasil = []
    for i in range(start, len(scaled_data)):
        batch = scaled_data[i - LOOKBACK_WINDOW:i].reshape(1, LOOKBACK_WINDOW, num_features)
        pred = model.predict(batch, verbose=0)
        dummy = np.zeros((1, num_features))
        dummy[0, 3] = pred[0, 0]
        nilai = float(scaler.inverse_transform(dummy)[0, 3])
        hasil.append(round(nilai, 2))
    return hasil


# --- FUNGSI HELPER: HITUNG MAPE & RMSE ---
def hitung_evaluasi(scaled_data, num_features):
    """Hitung MAPE dan RMSE pada 20% data terakhir (data uji), konsisten dengan notebook."""
    test_size = max(int(len(scaled_data) * 0.2), 1)
    test_start = len(scaled_data) - test_size

    y_pred_list = []
    y_actual_list = []

    for i in range(test_start, len(scaled_data)):
        if i < LOOKBACK_WINDOW:
            continue
        batch = scaled_data[i - LOOKBACK_WINDOW:i].reshape(1, LOOKBACK_WINDOW, num_features)
        pred = model.predict(batch, verbose=0)
        dummy_pred = np.zeros((1, num_features))
        dummy_pred[0, 3] = pred[0, 0]
        pred_price = float(scaler.inverse_transform(dummy_pred)[0, 3])

        dummy_actual = np.zeros((1, num_features))
        dummy_actual[0, 3] = scaled_data[i, 3]
        actual_price = float(scaler.inverse_transform(dummy_actual)[0, 3])

        y_pred_list.append(pred_price)
        y_actual_list.append(actual_price)

    if len(y_actual_list) == 0:
        return None, None

    y_pred   = np.array(y_pred_list)
    y_actual = np.array(y_actual_list)

    rmse = float(np.sqrt(np.mean((y_actual - y_pred) ** 2)))
    # Hindari division by zero pada MAPE
    mask = y_actual != 0
    mape = float(np.mean(np.abs((y_actual[mask] - y_pred[mask]) / y_actual[mask])) * 100)

    return round(mape, 2), round(rmse, 2)


@app.get("/")
def home():
    return {
        "message": "Solana LSTM API is running",
        "model_status": model_status,
        "scaler_status": scaler_status
    }


# --- ENDPOINT RIWAYAT ---
@app.get("/api/history")
def get_history():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT waktu, interval, harga_saat_ini, prediksi_lstm, selisih, target_tanggal
            FROM history ORDER BY id DESC
        """)
        rows = cursor.fetchall()
        conn.close()
        return [
            {"waktu": r[0], "interval": r[1], "harga_saat_ini": r[2],
             "prediksi_lstm": r[3], "selisih": r[4], "target_tanggal": r[5]}
            for r in rows
        ]
    except Exception as err:
        return {"error": f"Gagal mengambil riwayat: {str(err)}"}


# --- ENDPOINT MARKET (LOAD AWAL, TIDAK SIMPAN KE DB) ---
@app.get("/api/market")
def get_market(periode: str = '1 Bulan'):
    if periode not in PERIODE_MAP:
        return {"error": f"Parameter 'periode' hanya boleh: {', '.join(PERIODE_MAP.keys())}"}
    if model is None:
        return {"error": f"Model tidak siap: {model_status}"}
    if scaler is None:
        return {"error": f"Scaler tidak siap: {scaler_status}"}

    try:
        features_exact = fetch_market_data(periode)
        harga_sekarang  = float(features_exact['Close'].iloc[-1])
        harga_kemarin   = float(features_exact['Close'].iloc[-2])
        perubahan_harga = harga_sekarang - harga_kemarin
        persen_perubahan = (perubahan_harga / harga_kemarin) * 100
        volume_sekarang = float(features_exact['Volume'].iloc[-1])
        rsi_sekarang    = float(features_exact['RSI'].iloc[-1])

        scaled_data  = scaler.transform(features_exact)
        num_features = scaled_data.shape[1]

        if len(scaled_data) < LOOKBACK_WINDOW:
            return {"error": f"Data tidak cukup untuk window {LOOKBACK_WINDOW} hari."}

        n_tampil = min(TAMPIL_MAP[periode], len(scaled_data) - LOOKBACK_WINDOW)
        historis_prediksi = hitung_historis_prediksi(scaled_data, n_tampil, num_features)

        # Sesuaikan n_tampil dengan hasil aktual (mungkin lebih kecil jika data kurang)
        n_tampil = len(historis_prediksi)
        historis_aktual = features_exact['Close'].iloc[-(n_tampil + 1):].astype(float).round(2).tolist()[1:]
        historis_label  = features_exact.iloc[-(n_tampil + 1):].index.strftime('%Y-%m-%d').tolist()[1:]

        return {
            "market_data": {
                "current_price": harga_sekarang,
                "price_change": perubahan_harga,
                "price_change_percent": persen_perubahan,
                "volume_24h": volume_sekarang,
                "rsi_14": rsi_sekarang
            },
            "chart_data": {
                "labels": historis_label,
                "prices": historis_aktual,
                "predicted_prices": historis_prediksi
            }
        }
    except Exception as e:
        return {"error": f"Terjadi kegagalan komputasi: {str(e)}"}


# --- ENDPOINT PREDIKSI (DIPANGGIL SAAT TOMBOL DIKLIK) ---
@app.get("/api/predict")
def get_prediction(days: int = 1, periode: str = '1 Bulan'):
    if days not in [1, 3, 7]:
        return {"error": "Parameter 'days' hanya boleh 1, 3, atau 7."}
    if periode not in PERIODE_MAP:
        return {"error": f"Parameter 'periode' hanya boleh: {', '.join(PERIODE_MAP.keys())}"}
    if model is None:
        return {"error": f"Model tidak siap: {model_status}"}
    if scaler is None:
        return {"error": f"Scaler tidak siap: {scaler_status}"}

    try:
        features_exact = fetch_market_data(periode)
        harga_sekarang  = float(features_exact['Close'].iloc[-1])
        harga_kemarin   = float(features_exact['Close'].iloc[-2])
        perubahan_harga = harga_sekarang - harga_kemarin
        persen_perubahan = (perubahan_harga / harga_kemarin) * 100
        volume_sekarang = float(features_exact['Volume'].iloc[-1])
        rsi_sekarang    = float(features_exact['RSI'].iloc[-1])

        scaled_data  = scaler.transform(features_exact)
        num_features = scaled_data.shape[1]

        if len(scaled_data) < LOOKBACK_WINDOW:
            return {"error": f"Data tidak cukup untuk window {LOOKBACK_WINDOW} hari."}

        # Multi-step prediction
        temp_batch = scaled_data[-LOOKBACK_WINDOW:].reshape(1, LOOKBACK_WINDOW, num_features).copy()
        forecast_final = harga_sekarang
        for _ in range(days):
            pred_scaled = model.predict(temp_batch, verbose=0)
            dummy = np.zeros((1, num_features))
            dummy[0, 3] = pred_scaled[0, 0]
            forecast_final = float(scaler.inverse_transform(dummy)[0, 3])
            new_row = temp_batch[0, -1, :].copy()
            new_row[3] = pred_scaled[0, 0]
            temp_batch = np.append(temp_batch[:, 1:, :], [[new_row]], axis=1)

        waktu_wib  = datetime.now(timezone.utc) + timedelta(hours=7)
        target_wib = waktu_wib + timedelta(days=days)
        str_waktu  = waktu_wib.strftime('%H.%M.%S %d/%m/%Y')
        str_target = target_wib.strftime('%Y-%m-%d %H:%M WIB')
        selisih_val = round(forecast_final - harga_sekarang, 2)

        # Simpan ke SQLite
        try:
            conn = sqlite3.connect(DB_NAME)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO history (waktu, interval, harga_saat_ini, prediksi_lstm, selisih, target_tanggal)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (str_waktu, f"{days} Hari", round(harga_sekarang, 2),
                  round(forecast_final, 2), selisih_val, str_target))
            conn.commit()
            conn.close()
        except Exception as db_err:
            print(f">>> ERROR INSERT SQLITE: {str(db_err)}")

        # Hitung MAPE & RMSE dari data uji (20% akhir)
        mape, rmse = hitung_evaluasi(scaled_data, num_features)

        # Hitung prediksi historis sesuai periode
        n_tampil = min(TAMPIL_MAP[periode], len(scaled_data) - LOOKBACK_WINDOW)
        historis_prediksi = hitung_historis_prediksi(scaled_data, n_tampil, num_features)

        # Tambah titik prediksi masa depan
        historis_prediksi.append(round(forecast_final, 2))

        n_tampil = len(historis_prediksi) - 1  # dikurangi 1 karena ada titik masa depan
        historis_aktual = features_exact['Close'].iloc[-(n_tampil + 1):].astype(float).round(2).tolist()[1:]
        historis_label  = features_exact.iloc[-(n_tampil + 1):].index.strftime('%Y-%m-%d').tolist()[1:]
        combined_labels = historis_label + [str_target.split(' ')[0]]

        return {
            "market_data": {
                "current_price": harga_sekarang,
                "price_change": perubahan_harga,
                "price_change_percent": persen_perubahan,
                "volume_24h": volume_sekarang,
                "rsi_14": rsi_sekarang
            },
            "prediction": {
                "forecast_price": forecast_final,
                "target_date": str_target,
                "mape": mape,
                "rmse": rmse,
                "akurasi": round(100 - mape, 2) if mape is not None else None
            },
            "chart_data": {
                "labels": combined_labels,
                "prices": historis_aktual + [None],  # null di titik masa depan
                "predicted_prices": historis_prediksi
            }
        }
    except Exception as e:
        return {"error": f"Terjadi kegagalan komputasi di Backend: {str(e)}"}
