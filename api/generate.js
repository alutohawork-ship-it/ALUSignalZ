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
        "label": "Intraday (hold seharian)",
        "tf_entry": "1H", "tf_bias": "4H", "tf_minutes": 60,
        "max_hold_bars": 16,           # 16 x 1H = 16 jam
        "killzone": False,
        "tech_weight": 0.5,
        "min_total": 65,
        "exit_mode": "partial",
        "target_tp": 2,
        "management": "TP1: tutup 50% & SL ke entry. Sisa target TP2 (liquidity). Tutup sebelum hari berganti.",
        "cfg": {"adx_min": 20, "pullback_atr": 0.3, "swing_lookback": 10, "sr_lookback": 50,
                "sl_min_atr": 1.0, "sl_max_atr": 2.5, "tp_r": [1.0, 2.0, 3.0],
                "min_score": 65, "risk_per_trade": 0.01},
        "smc": {"swing_len": 3, "structure_lookback": 100, "sweep_lookback": 10,
                "min_smc_score": 45},
    },
    "swing": {
        "label": "Swing (hold berhari-hari)",
        "tf_entry": "4H", "tf_bias": "1D", "tf_minutes": 240,
        "max_hold_bars": 60,           # 60 x 4H = 10 hari
        "killzone": False,
        "tech_weight": 0.7,            # 70% teknikal, 30% SMC
        "min_total": 65,
        "exit_mode": "partial",
        "target_tp": 3,
        "management": "TP1: tutup 50% & SL ke entry. Sisa trailing ke TP3. Maks. hold 10 hari.",
        "cfg": {"adx_min": 20, "pullback_atr": 0.3, "swing_lookback": 20, "sr_lookback": 100,
                "sl_min_atr": 1.2, "sl_max_atr": 3.5, "tp_r": [1.5, 3.0, 4.5],
                "min_score": 70, "risk_per_trade": 0.01},
        "smc": {"swing_len": 5, "structure_lookback": 150, "sweep_lookback": 15,
                "ob_lookback": 40, "fvg_lookback": 40, "min_smc_score": 35},
    },
}

# Biaya transaksi (sesuaikan dengan broker/exchange Anda)
FEE_CONFIG = {
    "fee_pct": 0.0005,       # 0.05% per sisi (contoh: taker fee futures)
    "slippage_pct": 0.0002,  # 0.02% total slippage/spread
}

# Killzone UTC: London 07-10, New York 12-15  (WIB: 14-17 & 19-22)
KILLZONES_UTC = [(7, 10), (12, 15)]

def in_killzone(ts):
    ts = pd.Timestamp(ts)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC")
    return any(start <= ts.hour < end for start, end in KILLZONES_UTC)

def _style_cfg(style):
    if style not in STYLE_PRESETS:
        raise ValueError(f"Style harus salah satu dari: {list(STYLE_PRESETS)}")
    p = STYLE_PRESETS[style]
    return p, {**CONFIG, **p["cfg"]}, {**SMC_CONFIG, **p["smc"]}

def _apply_style(sig, p):
    """Hitung ulang skor total sesuai bobot gaya trading."""
    if sig["signal"] not in ("LONG", "SHORT"):
        return sig
    w = p["tech_weight"]
    total = round(sig["technical_score"] * w + sig["smc_score"] * (1 - w))
    if total < p["min_total"]:
        return {"signal": "NO TRADE",
                "technical_score": sig["technical_score"], "smc_score": sig["smc_score"],
                "total_score": total,
                "reasons": sig["reasons"] + [f"Skor total {total}% < minimal {p['min_total']}% untuk {p['label']}"]}
    sig["total_score"] = total
    sig["confidence"] = "TINGGI" if total >= 85 else "SEDANG" if total >= 70 else "RENDAH"
    sig["management"] = p["management"]
    sig["main_target"] = f"TP{p['target_tp']}"
    return sig

# ===================== SINYAL PER GAYA =====================
def get_signal_style(df, style="daytrade", balance=None, htf_df=None):
    """
    df     : OHLCV timeframe entry (index DatetimeIndex, idealnya UTC, candle sudah close)
    htf_df : OHLCV timeframe bias (lihat tf_bias di preset)
    style  : "scalping" / "daytrade" / "intraday" / "swing"
    """
    p, cfg, scfg = _style_cfg(style)

    if p["killzone"] and not in_killzone(df.index[-1]):
        sig = no_trade(f"Di luar killzone London/New York, likuiditas rendah untuk {p['label']}")
    else:
        sig = _apply_style(get_signal_smc(df, balance, htf_df, cfg, scfg), p)

    tf = pd.Timedelta(minutes=p["tf_minutes"])
    entry_time = pd.Timestamp(df.index[-1]) + tf          # waktu candle terakhir close
    sig.update({
        "style": p["label"],
        "timeframe": p["tf_entry"],
        "bias_timeframe": p["tf_bias"],
        "max_hold": str(tf * p["max_hold_bars"]),
    })
    if sig["signal"] in ("LONG", "SHORT"):
        sig["close_by"] = str(entry_time + tf * p["max_hold_bars"])
    return sig

def scan_all_styles(data, balance=None):
    """
    data = {"5m": df_5m, "15m": df_15m, "1H": df_1h, "4H": df_4h, "1D": df_1d}
    Mengembalikan sinyal untuk semua gaya sekaligus.
    """
    results = {}
    for style, p in STYLE_PRESETS.items():
        df, htf = data.get(p["tf_entry"]), data.get(p["tf_bias"])
        if df is None:
            results[style] = {"signal": "SKIP", "reasons": [f"Data {p['tf_entry']} tidak tersedia"]}
            continue
        results[style] = get_signal_style(df, style, balance, htf)
    return results

# ===================== BACKTEST REALISTIS =====================
def _simulate(d, i, sig, p):
    """Simulasi 1 trade: SL, partial TP1 + break even, target TP, dan time exit."""
    long = sig["signal"] == "LONG"
    s = 1 if long else -1
    entry, sl = sig["entry"], sig["stop_loss"]
    risk = abs(entry - sl)
    tp1, target = sig["tp1"], sig[f"tp{p['target_tp']}"]
    end = min(i + p["max_hold_bars"], len(d) - 1)
    realized, size, tp1_hit = 0.0, 1.0, False

    for j in range(i + 1, end + 1):
        hi, lo = d["high"].iloc[j], d["low"].iloc[j]

        # SL dicek duluan (asumsi konservatif)
        if (lo <= sl) if long else (hi >= sl):
            realized += size * (sl - entry) * s / risk
            return realized, j, "BE" if tp1_hit else "SL"

        # Partial di TP1 lalu SL ke break even
        if p["exit_mode"] == "partial" and not tp1_hit and ((hi >= tp1) if long else (lo <= tp1)):
            realized += 0.5 * (tp1 - entry) * s / risk
            size, tp1_hit, sl = 0.5, True, entry

        # Target utama
        if (hi >= target) if long else (lo <= target):
            realized += size * (target - entry) * s / risk
            return realized, j, f"TP{p['target_tp']}"

    # Time exit: batas hold tercapai, tutup di harga close
    realized += size * (d["close"].iloc[end] - entry) * s / risk
    return realized, end, "TIME"

def backtest_style(df, style="daytrade", htf_df=None, fee=FEE_CONFIG):
    p, cfg, scfg = _style_cfg(style)
    d = add_indicators(df, cfg)
    h = add_indicators(htf_df, cfg) if htf_df is not None else None
    trades, i = [], cfg["ema_slow"] + 10

    while i < len(d) - 1:
        ts = d.index[i]
        if p["killzone"] and not in_killzone(ts):
            i += 1; continue

        htf_bias = None
        if h is not None:   # bias dari candle HTF yang sudah close sebelum waktu ini
            hh = h[h.index < ts]
            if len(hh):
                htf_bias = "LONG" if hh["close"].iloc[-1] > hh["ema200"].iloc[-1] else "SHORT"

        sig = _apply_style(generate_signal_smc(d.iloc[:i + 1], cfg, scfg, None, htf_bias), p)
        if sig["signal"] not in ("LONG", "SHORT"):
            i += 1; continue

        r, exit_i, reason = _simulate(d, i, sig, p)
        risk = abs(sig["entry"] - sig["stop_loss"])
        cost_r = (fee["fee_pct"] * 2 + fee["slippage_pct"]) * sig["entry"] / risk
        trades.append({"time": ts, "signal": sig["signal"], "R": r - cost_r, "exit": reason})
        i = exit_i + 1

    if not trades:
        return {"style": p["label"], "trades": 0}

    res = pd.DataFrame(trades)
    equity = res["R"].cumsum()
    gains, losses = res.loc[res["R"] > 0, "R"].sum(), -res.loc[res["R"] < 0, "R"].sum()
    return {
        "style": p["label"],
        "trades": len(res),
        "winrate": f"{(res['R'] > 0).mean() * 100:.1f}%",
        "avg_R": round(res["R"].mean(), 2),
        "total_R": round(res["R"].sum(), 2),
        "profit_factor": round(gains / losses, 2) if losses > 0 else None,
        "max_drawdown_R": round((equity.cummax() - equity).max(), 2),
        "exit_breakdown": res["exit"].value_counts().to_dict(),
        "avg_fee_R": round(cost_r, 3),
        "trades_detail": res,
    }
