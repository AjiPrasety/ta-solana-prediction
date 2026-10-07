from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
from datetime import datetime, timedelta, timezone
import os
import sqlite3

app = FastAPI(title="Solana LSTM Prediction API")

# MENGIZINKAN REACT UNTUK MENGAKSES API INI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_NAME = 'model_solana.h5'
DB_NAME = 'predictions.db'

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

# Jalankan inisialisasi tabel database
init_db()

# Muat model LSTM dengan penanganan fleksibel untuk lintas versi Keras
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
                MODEL_NAME,
                compile=False,
                custom_objects={'GlorotUniform': FixedGlorotUniform}
            )
        except Exception:
            model = tf.keras.models.load_model(MODEL_NAME, compile=False)

        model_status = "Active"
        print(">>> SUCCESS: Model LSTM berhasil dimuat ke memori!")
    else:
        model = None
        model_status = f"File {MODEL_NAME} tidak ditemukan di direktori utama."
        print(f">>> ERROR: {model_status}")
except Exception as e:
    model = None
    model_status = f"Error loading model: {str(e)}"
    print(f">>> ERROR CRITICAL: {model_status}")

@app.get("/")
def home():
    return {"message": "Solana LSTM API is running", "model_status": model_status}

# --- ENDPOINT AMBIL SELURUH RIWAYAT DARI SQLITE ---
@app.get("/api/history")
def get_history():
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT waktu, interval, harga_saat_ini, prediksi_lstm, selisih, target_tanggal 
            FROM history 
            ORDER BY id DESC
        """)
        rows = cursor.fetchall()
        conn.close()

        history_list = []
        for row in rows:
            history_list.append({
                "waktu": row[0],
                "interval": row[1],
                "harga_saat_ini": row[2],
                "prediksi_lstm": row[3],
                "selisih": row[4],
                "target_tanggal": row[5]
            })
        return history_list
    except Exception as err:
        return {"error": f"Gagal mengambil riwayat database: {str(err)}"}

# --- ENDPOINT PREDIKSI MULTI-STEP (MENERIMA PARAMETER DAYS) ---
@app.get("/api/predict")
def get_prediction(days: int = 1):
    if model is None:
        return {"error": f"Model LSTM tidak siap. Status: {model_status}"}

    try:
        # 1. Ambil Data 100 Hari Terakhir dari Yahoo Finance
        df_raw = yf.download('SOL-USD', period='100d', interval='1d')
        
        if df_raw.empty:
            return {"error": "Gagal mengambil data dari Yahoo Finance."}

        if isinstance(df_raw.columns, pd.MultiIndex):
            df_raw.columns = df_raw.columns.get_level_values(0)
            
        df = df_raw[['Open', 'High', 'Low', 'Close', 'Volume']].dropna().copy()
        
        # 2. Hitung Indikator Teknikal Multivariate (9 Fitur Persis)
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))
        
        exp1 = df['Close'].ewm(span=12, adjust=False).mean()
        exp2 = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = exp1 - exp2
        df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
        
        ma20 = df['Close'].rolling(window=20).mean()
        std20 = df['Close'].rolling(window=20).std()
        df['BB_Upper'] = ma20 + (2 * std20)
        df['BB_Lower'] = ma20 - (2 * std20)
        
        df.dropna(inplace=True)
        features_exact = df[['Open', 'High', 'Low', 'Close', 'RSI', 'MACD', 'MACD_Signal', 'BB_Upper', 'BB_Lower']]
        
        harga_sekarang = float(features_exact['Close'].iloc[-1])
        harga_kemarin = float(features_exact['Close'].iloc[-2])
        perubahan_harga = harga_sekarang - harga_kemarin
        persen_perubahan = (perubahan_harga / harga_kemarin) * 100
        volume_sekarang = float(df['Volume'].iloc[-1])
        rsi_sekarang = float(features_exact['RSI'].iloc[-1])

        # 3. Normalisasi MinMax
        scaler = MinMaxScaler(feature_range=(0, 1))
        scaled_data = scaler.fit_transform(features_exact)
        
        prediction_window = 24
        if len(scaled_data) < prediction_window:
            return {"error": "Data historis tidak mencukupi untuk sliding window 24 hari."}

        current_batch = scaled_data[-prediction_window:].reshape(1, prediction_window, 9)
        
        # --- PROSES MULTI-STEP PREDICTION BERDASARKAN HARI (1, 3, ATAU 7) ---
        temp_batch = current_batch.copy()
        forecast_final = harga_sekarang

        for _ in range(days):
            pred_scaled = model.predict(temp_batch, verbose=0)
            
            # De-normalisasi nilai Close
            dummy_future = np.zeros((1, 9))
            dummy_future[0, 3] = pred_scaled[0, 0]
            forecast_final = float(scaler.inverse_transform(dummy_future)[0, 3])

            # Update sliding window batch untuk iterasi hari berikutnya
            new_row = temp_batch[0, -1, :].copy()
            new_row[3] = pred_scaled[0, 0]
            temp_batch = np.append(temp_batch[:, 1:, :], [[new_row]], axis=1)

        # Hitung waktu target sesuai parameter days
        waktu_wib = datetime.now(timezone.utc) + timedelta(hours=7)
        target_wib = waktu_wib + timedelta(days=days)

        str_waktu = waktu_wib.strftime('%H.%M.%S %d/%m/%Y')
        str_target = target_wib.strftime('%Y-%m-%d %H:%M WIB')
        selisih_val = round(forecast_final - harga_sekarang, 2)
        interval_val = f"{days} Hari"

        # --- SIMPAN KE SQLITE ---
        try:
            conn = sqlite3.connect(DB_NAME)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO history (waktu, interval, harga_saat_ini, prediksi_lstm, selisih, target_tanggal)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (str_waktu, interval_val, round(harga_sekarang, 2), round(forecast_final, 2), selisih_val, str_target))
            conn.commit()
            conn.close()
        except Exception as db_insert_err:
            print(f">>> ERROR INSERT SQLITE: {str(db_insert_err)}")

        # --- HITUNG PREDIKSI UNTUK SELURUH DATA HISTORIS (UNTUK GRAFIK BERHIMPITAN) ---
        historis_prediksi = []
        for i in range(len(scaled_data) - 15, len(scaled_data)):
            batch_hist = scaled_data[i-prediction_window:i].reshape(1, prediction_window, 9)
            pred_h = model.predict(batch_hist, verbose=0)
            
            dummy_h = np.zeros((1, 9))
            dummy_h[0, 3] = pred_h[0, 0]
            val_h = float(scaler.inverse_transform(dummy_h)[0, 3])
            historis_prediksi.append(val_h)

        # Tambahkan nilai prediksi target hari mendatang
        historis_prediksi.append(forecast_final)

        historis_aktual = features_exact['Close'].tail(15).astype(float).tolist()
        historis_label = features_exact.tail(15).index.strftime('%Y-%m-%d').tolist()

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
                "target_date": str_target
            },
            "chart_data": {
                "labels": historis_label,
                "prices": historis_aktual,
                "predicted_prices": historis_prediksi
            }
        }
    except Exception as internal_err:
        return {"error": f"Terjadi kegagalan komputasi di Backend: {str(internal_err)}"}