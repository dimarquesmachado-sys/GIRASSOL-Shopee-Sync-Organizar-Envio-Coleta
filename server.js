const express = require('express');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

const SHOPEE_PARTNER_ID = process.env.SHOPEE_PARTNER_ID;
const SHOPEE_PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY;
const SHOPEE_HOST = process.env.SHOPEE_HOST || 'https://partner.test-stable.shopeemobile.com';
const BASE_URL = process.env.BASE_URL || 'https://girassol-shopee-sync-organizar-envio.onrender.com';
const NODE_ENV = process.env.NODE_ENV || 'sandbox';

app.use(express.json());

// =========================================================
// Helpers
// =========================================================

function signPublic(apiPath, timestamp) {
  const baseString = `${SHOPEE_PARTNER_ID}${apiPath}${timestamp}`;
  return crypto.createHmac('sha256', SHOPEE_PARTNER_KEY).update(baseString).digest('hex');
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function checkConfig(res) {
  if (!SHOPEE_PARTNER_ID || !SHOPEE_PARTNER_KEY) {
    res.status(500).json({
      error: 'Configuracao incompleta',
      missing: {
        SHOPEE_PARTNER_ID: !SHOPEE_PARTNER_ID,
        SHOPEE_PARTNER_KEY: !SHOPEE_PARTNER_KEY
      }
    });
    return false;
  }
  return true;
}

// =========================================================
// Rotas basicas
// =========================================================

app.get('/', (req, res) => {
  res.json({
    service: 'Girassol Shopee NFe Sync',
    status: 'online',
    version: '0.3.0',
    environment: NODE_ENV,
    shopee_host: SHOPEE_HOST,
    partner_id_configured: !!SHOPEE_PARTNER_ID,
    partner_key_configured: !!SHOPEE_PARTNER_KEY,
    base_url: BASE_URL,
    timestamp: new Date().toISOString(),
    actions: {
      start_auth: `${BASE_URL}/shopee/auth`,
      debug: `${BASE_URL}/shopee/debug`,
      status: `${BASE_URL}/status`
    }
  });
});

app.get('/status', (req, res) => {
  res.json({
    service: 'Girassol Shopee NFe Sync',
    timestamp: new Date().toISOString(),
    config: {
      environment: NODE_ENV,
      shopee_host: SHOPEE_HOST,
      base_url: BASE_URL,
      partner_id: SHOPEE_PARTNER_ID || 'NAO_CONFIGURADO',
      partner_key: SHOPEE_PARTNER_KEY ? 'CONFIGURADA' : 'NAO_CONFIGURADA',
      shop_id: process.env.SHOPEE_SHOP_ID || 'NAO_AUTORIZADA',
      access_token: process.env.SHOPEE_ACCESS_TOKEN ? 'CONFIGURADO' : 'NAO_CONFIGURADO',
      refresh_token: process.env.SHOPEE_REFRESH_TOKEN ? 'CONFIGURADO' : 'NAO_CONFIGURADO'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// =========================================================
// DEBUG - diagnostico de assinatura
// =========================================================

app.get('/shopee/debug', (req, res) => {
  if (!checkConfig(res)) return;

  const apiPath = '/api/v2/shop/auth_partner';
  const timestamp = nowTs();
  const sign = signPublic(apiPath, timestamp);
  const baseString = `${SHOPEE_PARTNER_ID}${apiPath}${timestamp}`;

  const key = SHOPEE_PARTNER_KEY || '';
  const id = SHOPEE_PARTNER_ID || '';

  res.json({
    config: {
      partner_id: id,
      host: SHOPEE_HOST,
      base_url: BASE_URL,
    },
    partner_id_check: {
      value: id,
      length: id.length,
      starts_with_space: id.startsWith(' '),
      ends_with_space: id.endsWith(' '),
      has_whitespace: /\s/.test(id),
      is_numeric: /^\d+$/.test(id)
    },
    partner_key_check: {
      length: key.length,
      first_4_chars: key.substring(0, 4),
      last_4_chars: key.substring(key.length - 4),
      starts_with_space: key.startsWith(' '),
      ends_with_space: key.endsWith(' '),
      has_newline: key.includes('\n') || key.includes('\r'),
      has_tab: key.includes('\t'),
      has_any_whitespace: /\s/.test(key),
      is_hex_only: /^[a-f0-9]+$/i.test(key)
    },
    test_signature: {
      api_path: apiPath,
      timestamp: timestamp,
      base_string: baseString,
      sign: sign
    },
    server_time: {
      utc: new Date().toISOString(),
      local: new Date().toString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unix: Math.floor(Date.now() / 1000)
    }
  });
});

// =========================================================
// Rotas OAuth Shopee
// =========================================================

app.get('/shopee/auth', (req, res) => {
  if (!checkConfig(res)) return;

  const apiPath = '/api/v2/shop/auth_partner';
  const timestamp = nowTs();
  const sign = signPublic(apiPath, timestamp);
  const redirectUrl = `${BASE_URL}/shopee/callback`;

  const authUrl = `${SHOPEE_HOST}${apiPath}` +
    `?partner_id=${SHOPEE_PARTNER_ID}` +
    `&timestamp=${timestamp}` +
    `&sign=${sign}` +
    `&redirect=${encodeURIComponent(redirectUrl)}`;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Autorizar Loja Shopee</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 60px auto; padding: 20px; }
        h1 { color: #ee4d2d; }
        .info { background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .btn { display: inline-block; background: #ee4d2d; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold; }
        .btn:hover { background: #d44222; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
      </style>
    </head>
    <body>
      <h1>Autorizar Loja Shopee</h1>
      <div class="info">
        <p><strong>Ambiente:</strong> ${NODE_ENV}</p>
        <p><strong>Shopee Host:</strong> <code>${SHOPEE_HOST}</code></p>
        <p><strong>Partner ID:</strong> <code>${SHOPEE_PARTNER_ID}</code></p>
        <p><strong>Timestamp:</strong> <code>${timestamp}</code></p>
        <p><strong>Sign (primeiros 12 chars):</strong> <code>${sign.substring(0, 12)}...</code></p>
      </div>
      <p>Ao clicar, voce sera redirecionado para a Shopee.</p>
      <p><a class="btn" href="${authUrl}">Autorizar com Shopee</a></p>
    </body>
    </html>
  `);
});

app.get('/shopee/callback', async (req, res) => {
  if (!checkConfig(res)) return;

  const { code, shop_id } = req.query;
  console.log('[CALLBACK] Query params:', req.query);

  if (!code || !shop_id) {
    return res.status(400).send(`
      <h1>Erro no callback</h1>
      <pre>${JSON.stringify(req.query, null, 2)}</pre>
    `);
  }

  try {
    const apiPath = '/api/v2/auth/token/get';
    const timestamp = nowTs();
    const sign = signPublic(apiPath, timestamp);

    const url = `${SHOPEE_HOST}${apiPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;

    const body = {
      code: code,
      shop_id: parseInt(shop_id, 10),
      partner_id: parseInt(SHOPEE_PARTNER_ID, 10)
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    console.log('[CALLBACK] Response:', JSON.stringify(data));

    if (data.error || !data.access_token) {
      return res.status(500).send(`
        <h1>Erro ao obter token</h1>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      `);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Tokens Gerados</title>
        <style>
          body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; }
          h1 { color: #ee4d2d; }
          .success { background: #e6f7e6; border: 2px solid #4caf50; padding: 20px; border-radius: 8px; }
          .token-box { background: #f5f5f5; border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin: 15px 0; }
          .token-box strong { display: block; margin-bottom: 8px; }
          code { background: #fff; padding: 10px; display: block; word-break: break-all; border: 1px solid #ccc; font-size: 13px; font-family: monospace; }
          .warning { background: #fff3cd; border: 2px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
          button { background: #ee4d2d; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 10px; }
        </style>
        <script>
          function copyText(id, btn) {
            const el = document.getElementById(id);
            navigator.clipboard.writeText(el.textContent.trim());
            btn.textContent = 'Copiado!';
            setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
          }
        </script>
      </head>
      <body>
        <h1>Tokens Shopee Gerados</h1>
        <div class="success">
          <strong>Shop ID:</strong> ${shop_id}<br>
          <strong>Expira em:</strong> ${Math.round(data.expire_in/3600)} horas
        </div>
        <div class="warning"><strong>IMPORTANTE:</strong> Copie os 3 valores abaixo AGORA.</div>
        <div class="token-box">
          <strong>SHOPEE_SHOP_ID <button onclick="copyText('sid', this)">Copiar</button></strong>
          <code id="sid">${shop_id}</code>
        </div>
        <div class="token-box">
          <strong>SHOPEE_ACCESS_TOKEN <button onclick="copyText('at', this)">Copiar</button></strong>
          <code id="at">${data.access_token}</code>
        </div>
        <div class="token-box">
          <strong>SHOPEE_REFRESH_TOKEN <button onclick="copyText('rt', this)">Copiar</button></strong>
          <code id="rt">${data.refresh_token}</code>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[CALLBACK] Erro:', err);
    res.status(500).send(`<h1>Erro</h1><pre>${err.message}</pre>`);
  }
});

app.listen(PORT, () => {
  console.log(`Girassol Shopee Sync rodando na porta ${PORT}`);
  console.log(`Partner ID: ${SHOPEE_PARTNER_ID || 'NAO CONFIGUR
