# ===================== PRESET GAYA TRADING =====================
STYLE_PRESETS = {
    "scalping": {
        "label": "Scalping (hit & run)",
        "tf_entry": "5m", "tf_bias": "15m", "tf_minutes": 5,
        "max_hold_bars": 6,            # 6 x 5m = 30 menit
        "killzone": True,
        "tech_weight": 0.3,            # 30% teknikal, 70% SMC
        "min_total": 60,
        "exit_mode": "single",         # langsung tutup penuh di target
        "target_tp": 1,
        "management": "Hit & run: tutup 100% di TP1. Kalau 30 menit belum kena, tutup manual.",
        "cfg": {"adx_min": 18, "pullback_atr": 0.4, "swing_lookback": 5, "sr_lookback": 30,
                "sl_min_atr": 0.8, "sl_max_atr": 1.8, "tp_r": [1.0, 1.5, 2.0],
                "min_score": 50, "risk_per_trade": 0.005},
        "smc": {"swing_len": 2, "structure_lookback": 60, "sweep_lookback": 5,
                "ob_lookback": 15, "fvg_lookback": 10, "displacement_atr": 0.8,
                "min_smc_score": 60},
    },
    "daytrade": {
        "label": "Day Trade (hold 1-2 jam)",
        "tf_entry": "15m", "tf_bias": "1H", "tf_minutes": 15,
        "max_hold_bars": 8,            # 8 x 15m = 2 jam
        "killzone": True,
        "tech_weight": 0.4,
        "min_total": 60,
        "exit_mode": "partial",
        "target_tp": 2,
        "management": "TP1: tutup 50% & SL ke entry. Sisa target TP2. Maks. hold 2 jam.",
        "cfg": {"adx_min": 20, "pullback_atr": 0.35, "swing_lookback": 8, "sr_lookback": 40,
                "sl_min_atr": 1.0, "sl_max_atr": 2.2, "tp_r": [1.0, 1.5, 2.5],
                "min_score": 60, "risk_per_trade": 0.0075},
        "smc": {"swing_len": 3, "structure_lookback": 80, "sweep_lookback": 8,
                "ob_lookback": 25, "fvg_lookback": 20, "min_smc_score": 50},
    },
    "intraday": {
