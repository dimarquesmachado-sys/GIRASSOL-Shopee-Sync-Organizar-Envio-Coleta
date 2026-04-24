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
    version: '0.2.0',
    environment: NODE_ENV,
    shopee_host: SHOPEE_HOST,
    partner_id_configured: !!SHOPEE_PARTNER_ID,
    partner_key_configured: !!SHOPEE_PARTNER_KEY,
    base_url: BASE_URL,
    timestamp: new Date().toISOString(),
    actions: {
      start_auth: `${BASE_URL}/shopee/auth`,
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
// Rotas OAuth Shopee
// =========================================================

// Pagina inicial de autorizacao (com botao para iniciar)
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
        <p><strong>Callback:</strong> <code>${redirectUrl}</code></p>
      </div>
      <p>Ao clicar no botao abaixo, voce sera redirecionado para a Shopee para autorizar este App.</p>
      <p>Na Shopee, faca login com sua conta de VENDEDOR do Girassol, nao com a conta de desenvolvedor.</p>
      <p><a class="btn" href="${authUrl}">Autorizar com Shopee</a></p>
    </body>
    </html>
  `);
});

// Callback - recebe code e shop_id e troca por access_token
app.get('/shopee/callback', async (req, res) => {
  if (!checkConfig(res)) return;

  const { code, shop_id } = req.query;

  console.log('[CALLBACK] Query params:', req.query);

  if (!code || !shop_id) {
    return res.status(400).send(`
      <h1>Erro no callback</h1>
      <p>Faltou code ou shop_id nos parametros.</p>
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

    console.log('[CALLBACK] Calling token/get...');
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
        <p><strong>Shopee retornou erro:</strong></p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      `);
    }

    // Sucesso! Exibir tokens pro usuario copiar
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Tokens Shopee Gerados</title>
        <style>
          body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; }
          h1 { color: #ee4d2d; }
          .success { background: #e6f7e6; border: 2px solid #4caf50; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .token-box { background: #f5f5f5; border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin: 15px 0; }
          .token-box strong { display: block; margin-bottom: 8px; color: #333; font-size: 15px; }
          code { background: #fff; padding: 10px; display: block; word-break: break-all; border: 1px solid #ccc; font-size: 13px; font-family: monospace; margin-top: 8px; }
          .warning { background: #fff3cd; border: 2px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .step { background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .step ol { margin: 10px 0; padding-left: 20px; }
          .step li { margin: 8px 0; }
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
        <h1>Tokens Shopee Gerados com Sucesso</h1>

        <div class="success">
          <strong>Loja autorizada:</strong> Shop ID ${shop_id}<br>
          <strong>Access Token expira em:</strong> ${data.expire_in} segundos (aproximadamente ${Math.round(data.expire_in/3600)} horas)<br>
          <strong>Refresh Token valido por:</strong> 30 dias
        </div>

        <div class="warning">
          <strong>IMPORTANTE:</strong> Copie os 3 valores abaixo e adicione como variaveis de ambiente no Render AGORA.
          Esses valores so aparecem AQUI, UMA VEZ.
        </div>

        <div class="token-box">
          <strong>1. SHOPEE_SHOP_ID <button onclick="copyText('shop_id', this)">Copiar</button></strong>
          <code id="shop_id">${shop_id}</code>
        </div>

        <div class="token-box">
          <strong>2. SHOPEE_ACCESS_TOKEN <button onclick="copyText('access_token', this)">Copiar</button></strong>
          <code id="access_token">${data.access_token}</code>
        </div>

        <div class="token-box">
          <strong>3. SHOPEE_REFRESH_TOKEN <button onclick="copyText('refresh_token', this)">Copiar</button></strong>
          <code id="refresh_token">${data.refresh_token}</code>
        </div>

        <div class="step">
          <strong>Proximos passos:</strong>
          <ol>
            <li>Va no Render Dashboard deste serviço</li>
            <li>Entre em <strong>Environment</strong></li>
            <li>Adicione as 3 variaveis acima (Key + Value) - uma por vez</li>
            <li>Clique em <strong>Save Changes</strong></li>
            <li>Aguarde o redeploy ficar verde (Live)</li>
            <li>Volte ao chat com o Claude e avise que terminou</li>
          </ol>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('[CALLBACK] Erro:', err);
    res.status(500).send(`
      <h1>Erro interno</h1>
      <pre>${err.message}\n\n${err.stack}</pre>
    `);
  }
});

// =========================================================
// Start
// =========================================================

app.listen(PORT, () => {
  console.log(`Girassol Shopee Sync rodando na porta ${PORT}`);
  console.log(`Partner ID: ${SHOPEE_PARTNER_ID ? SHOPEE_PARTNER_ID : 'NAO CONFIGURADO'}`);
  console.log(`Partner Key: ${SHOPEE_PARTNER_KEY ? 'CONFIGURADA' : 'NAO CONFIGURADA'}`);
  console.log(`Host: ${SHOPEE_HOST}`);
  console.log(`Base URL: ${BASE_URL}`);
});
