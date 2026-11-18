// api/chat.js
// v1 — Interactive AI Chat. Uses scanner internally + LLM for narrative Q&A.

// ⚠️ IMPORTANT: copy SEMUA kode dari api/scan.js (line 1 s/d akhir function handler)
// ke atas file ini, KECUALI blok `export default async function handler(...)` di scan.js.
// Setelah itu tambahkan kode chat di bawah ini.

const QWEN_BASE_URL = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const QWEN_KEYS = [process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const QWEN_MODELS = [process.env.QWEN_MODEL || 'qwen-3.8-max', process.env.QWEN_MODEL_2].filter(Boolean);
const CHAT_TIMEOUT_MS = 25000;

function extractContent(data) {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p?.text || '').join('');
  return '';
}

function buildChatSystemPrompt(scan, symbol, lang) {
  const d = scan.diagnostics;
  const s = scan.signal;
  const langName = lang === 'en' ? 'English' : 'Indonesian';

  const marketContext = {
    symbol,
    price: d.price,
    timestamp: new Date(d.timestamp).toISOString(),
    killzone: d.killzone?.name + (d.killzone?.active ? ' (ACTIVE)' : ' (INACTIVE)'),
    bias: {
      label: d.bias?.label,
      score: d.bias?.score,
      perTimeframe: d.bias?.perTf,
    },
    structures: d.structures,
    nearestZones: d.nearestZones,
    activeSetup: d.activeSetup,
    currentState: s.state,
    currentSignal: s.action !== 'NONE' ? {
      action: s.action, entry: s.entry, sl: s.sl,
      tp1: s.tp1, tp2: s.tp2, tp3: s.tp3,
      setup: s.setup, rr: s.rr, score: s.score,
    } : null,
    waitingFor: d.waitingFor,
    barsInZone: d.barsInZone,
  };

  return `You are an institutional SMC/ICT trading analyst chatting with a trader on a web interface.

CURRENT MARKET STATE (from live scanner — NEVER invent prices, zones, or levels beyond what's here):
${JSON.stringify(marketContext, null, 2)}

RULES:
1. Respond in ${langName}.
2. Be concise but specific. Reference exact prices/zones from the data.
3. If user asks "kenapa belum entry / why no entry": explain precisely which conditions are still missing based on currentState + waitingFor.
4. If user asks "should I enter": explain current state + what confirmation is needed. Do NOT invent setups not in activeSetup.
5. If user asks about bias: reference perTimeframe structures.
6. If user asks about a setup: reference activeSetup.score, activeSetup.breakdown, activeSetup.zone.
7. Use light formatting: bullet points, bold prices, short paragraphs.
8. Keep it 3-6 sentences unless user asks for deep detail.
9. If question is off-topic or unknown: politely say so. Never guess.`;
}

async function callQwenChat(messages) {
  for (const model of QWEN_MODELS) {
    for (const key of QWEN_KEYS.slice(0, 2)) {
      try {
        const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 700, temperature: 0.4, messages }),
        }, CHAT_TIMEOUT_MS);
        if (!r.ok) continue;
        const txt = extractContent(r.data).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (txt) return txt;
      } catch (e) { console.warn('chatLLM:', e.message); }
    }
  }
  return null;
}

// ── Handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reply: 'POST only' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, reply: 'Invalid JSON' }); }

    const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
    const price = Number(body.price ?? body.livePrice ?? 0);
    const lang = body.lang === 'en' ? 'en' : 'id';
    const email = String(body.email || '').trim().toLowerCase();
    const userMessage = String(body.message || '').trim();

    if (!userMessage) return res.status(200).json({ ok: false, reply: 'Pesan kosong.' });
    if (!(price > 0)) return res.status(200).json({ ok: false, reply: 'Harga live belum tersedia.' });

    const access = await checkAccess(email, false);
    if (!access.ok) return res.status(200).json({ ok: false, reply: access.reason });

    // ── Fetch + scan ──
    const dec = DECIMALS[symbol] ?? 2;
    const ctx = { symbol, dec, pip: pipSizeOf(symbol, dec), prof: pairProfile(symbol), f: v => Number(Number(v).toFixed(dec)) };
    const candleMap = { m1: clientCandles(body, 'm1'), m5: clientCandles(body, 'm5'), m15: clientCandles(body, 'm15'), m30: clientCandles(body, 'm30'), h1: clientCandles(body, 'h1'), h4: clientCandles(body, 'h4'), d1: clientCandles(body, 'd1') };

    const need = { m1: 200, m5: 200, m15: 100, m30: 100, h1: 100, h4: 80, d1: 60 };
    const ivs = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
    for (const tf of ['m1', 'm5', 'm15', 'h1']) {
      if (candleMap[tf]?.length >= (need[tf] || 50)) continue;
      const rows = await fetchRows(symbol, ivs[tf], need[tf]);
      if (rows.length) candleMap[tf] = rows;
    }

    const data = {
      price,
      m1: candleMap.m1,
      m5: candleMap.m5?.length ? candleMap.m5 : candleMap.m15,
      m15: candleMap.m15?.length ? candleMap.m15 : candleMap.m5,
      m30: candleMap.m30?.length ? candleMap.m30 : candleMap.m15,
      h1: candleMap.h1?.length ? candleMap.h1 : candleMap.m15,
      h4: candleMap.h4?.length ? candleMap.h4 : candleMap.h1,
      d1: candleMap.d1?.length ? candleMap.d1 : candleMap.h4,
    };

    const scan = runScanLean(ctx, data);

    // ── Build LLM conversation ──
    const history = Array.isArray(body.messages) ? body.messages.slice(-8) : [{ role: 'user', content: userMessage }];
    const conversation = [
      { role: 'system', content: buildChatSystemPrompt(scan, symbol, lang) },
      ...history,
    ];

    const reply = await callQwenChat(conversation);

    const fallbackReply = lang === 'en'
      ? `Right now ${symbol} is at ${price}. Current state: ${scan.signal.state}. Waiting for: ${scan.diagnostics.waitingFor || 'valid setup per SOP'}. (AI offline — this is a canned response.)`
      : `Saat ini ${symbol} di ${price}. Status: ${scan.signal.state}. Menunggu: ${scan.diagnostics.waitingFor || 'setup valid sesuai SOP'}. (AI sedang sibuk — ini respons template.)`;

    return res.status(200).json({
      ok: true,
      reply: reply || fallbackReply,
      context: {
        bias: scan.diagnostics.bias?.label,
        state: scan.signal.state,
        signal: scan.signal.action !== 'NONE' ? scan.signal.action : null,
        price,
      },
    });
  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({ ok: false, reply: `Server error: ${err.message}` });
  }
}
