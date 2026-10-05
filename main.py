from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import numpy as np
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
from datetime import datetime, timedelta, timezone
import os

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

# Muat model LSTM dengan penanganan fleksibel untuk lintas versi Keras
try:
    if os.path.exists(MODEL_NAME):
        # Aktifkan penanganan objek Keras 3 jika tersedia
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

@app.get("/api/predict")
def get_prediction():
    if model is None:
        return {"error": f"Model LSTM tidak siap. Status: {model_status}"}

    try:
        # 1. Ambil Data 100 Hari Terakhir dari Yahoo Finance
        df_raw = yf.download('SOL-USD', period='100d', interval='1d')
        
        if df_raw.empty:
            return {"error": "Gagal mengambil data dari Yahoo Finance."}

        # Amankan multi-index jika yfinance mengembalikannya
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
        
        # Bersihkan NaN
        df.dropna(inplace=True)
        
        # Susun 9 Fitur Baku
        features_exact = df[['Open', 'High', 'Low', 'Close', 'RSI', 'MACD', 'MACD_Signal', 'BB_Upper', 'BB_Lower']]
        
        # Metrik Pasar Terbaru
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
        
        # Eksekusi Prediksi
        pred_scaled = model.predict(current_batch, verbose=0)
        
        # De-normalisasi khusus harga Close (index 3)
        dummy_future = np.zeros((1, 9))
        dummy_future[0, 3] = pred_scaled[0, 0]
        forecast_1d = float(scaler.inverse_transform(dummy_future)[0, 3])
        
        # Waktu WIB
        waktu_wib = datetime.now(timezone.utc) + timedelta(hours=7)
        target_wib = waktu_wib + timedelta(days=1)

        # Histori Grafik
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
                "forecast_price": forecast_1d,
                "target_date": target_wib.strftime('%Y-%m-%d %H:%M WIB')
            },
            "chart_data": {
                "labels": historis_label,
                "prices": historis_aktual
            }
        }
    except Exception as internal_err:
        return {"error": f"Terjadi kegagalan komputasi di Backend: {str(internal_err)}"}