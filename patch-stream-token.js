/* =====================================================================
   PATCH untuk index.html
   Token tidak lagi ditulis di file HTML, melainkan diambil dari server.

   PATCH 1: di bagian "KONFIG MARKET", HAPUS baris ini:
       const XBTFX_TOKEN = 'ISI_TOKEN_KAMU';
   lalu ganti dengan:
   ===================================================================== */

let XBTFX_TOKEN = '';

/* =====================================================================
   PATCH 2: tambahkan fungsi ini di bagian "STREAM (xbtfx)",
   letakkan tepat sebelum "function connect()".
   ===================================================================== */

async function fetchStreamToken() {
    const email = localStorage.getItem(SESSION_EMAIL_KEY);
    if (!email) return { wait: true };

    const r = await api('/api/stream-token', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ value: email }),
    });
    if (r.ok && r.data.token) return { token: r.data.token };
    if (r.status === 401) return { fatal: true, msg: r.data.msg };
    return { error: r.data.msg || 'Gagal mengambil token' };
}

/* =====================================================================
   PATCH 3: GANTI seluruh function connect() yang lama dengan ini.
   Mulai dari "function connect() {" sampai penutup "}" sebelum
   "// TODO: request candle history xbtfx".
   ===================================================================== */

let connectId = 0;

async function connect() {
    clearTimeout(reconnectTimer);
    if (ws) { const old = ws; ws = null; old.onclose = null; old.onmessage = null; old.close(); }
    streamReady = false;
    authFailed = false;
    const myId = ++connectId;

    setWsStatus('TOKEN...', 'yellow');
    const t = await fetchStreamToken();
    if (myId !== connectId) return; // sudah ada connect baru, batalkan yang ini

    if (t.wait) {
        // Belum login: coba lagi sebentar lagi (akan tersambung setelah login)
        setWsStatus('LOGIN DULU', 'gray');
        reconnectTimer = setTimeout(connect, 2000);
        return;
    }
    if (t.fatal) {
        authFailed = true;
        setWsStatus('SESI TIDAK VALID', 'red');
        return;
    }
    if (t.error) {
        setWsStatus('TOKEN GAGAL', 'red');
        scheduleReconnect();
        return;
    }

    XBTFX_TOKEN = t.token;
    setWsStatus('CONNECTING', 'yellow');
    const sock = new WebSocket(WS_URL);
    ws = sock;

    sock.onopen = () => {
        setWsStatus('AUTH...', 'yellow');
        sendJSON(sock, { action: 'auth', token: XBTFX_TOKEN });
    };

    sock.onmessage = e => {
        retryCount = 0;
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (DEBUG && dbgCount < 40) { dbgCount++; console.log('[WS]', e.data.slice(0, 400)); }

        if (msg.action === 'auth_ok') {
            streamReady = true;
            setWsStatus('CONNECTED', 'green');
            subscribeAll(sock);
            setTimeout(() => { if (ws === sock) refreshBias(selectedKey(), true); }, 1500);
            return;
        }

        if (msg.channel === 'quote') { handleQuote(msg); return; }

        if (!streamReady && (msg.action === 'auth_error' || msg.action === 'error' || msg.error)) {
            authFailed = true;
            setWsStatus('AUTH GAGAL', 'red');
            return;
        }

        if (msg.action === 'error' && msg.symbol) {
            for (const key of keysOf(msg.symbol)) markSrc(key, 'ERR', 'text-red-400');
        }
    };

    sock.onerror = () => setWsStatus('ERROR', 'red');
    sock.onclose = () => {
        if (ws !== sock) return;
        streamReady = false;
        setWsStatus('DISCONNECTED', 'red');
        for (const k of Object.keys(MARKETS)) markSrc(k, 'OFF', 'text-gray-600');
        if (!authFailed) scheduleReconnect();
    };
}
