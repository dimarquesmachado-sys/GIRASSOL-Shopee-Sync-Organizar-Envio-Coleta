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

function signWithKey(key, apiPath, timestamp) {
  const baseString = `${SHOPEE_PARTNER_ID}${apiPath}${timestamp}`;
  return crypto.createHmac('sha256', key).update(baseString).digest('hex');
}

function signPublic(apiPath, timestamp) {
  // Usa a chave EFETIVA - tenta sem prefixo shpk primeiro, depois com
  const effectiveKey = getEffectiveKey();
  return signWithKey(effectiveKey, apiPath, timestamp);
}

function getEffectiveKey() {
  // Prefixo "shpk" indica novo formato - a chave real pode ser sem ele
  // Se tiver sido determinado, usar a variante que funciona
  const override = process.env.SHOPEE_KEY_VARIANT; // 'full' ou 'no_prefix'
  const key = SHOPEE_PARTNER_KEY || '';
  if (override === 'no_prefix' && key.startsWith('shpk')) {
    return key.substring(4);
  }
  return key;
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
    version: '0.4.0',
    environment: NODE_ENV,
    shopee_host: SHOPEE_HOST,
    key_variant: process.env.SHOPEE_KEY_VARIANT || 'full',
    timestamp: new Date().toISOString(),
    actions: {
      start_auth: `${BASE_URL}/shopee/auth`,
      test_sign: `${BASE_URL}/shopee/test-sign`,
      debug: `${BASE_URL}/shopee/debug`,
      status: `${BASE_URL}/status`
    }
  });
});

app.get('/status', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    config: {
      environment: NODE_ENV,
      shopee_host: SHOPEE_HOST,
      partner_id: SHOPEE_PARTNER_ID || 'NAO_CONFIGURADO',
      partner_key: SHOPEE_PARTNER_KEY ? 'CONFIGURADA' : 'NAO_CONFIGURADA',
      key_variant: process.env.SHOPEE_KEY_VARIANT || 'full (default)',
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
// TESTE DE ASSINATURA - descobre qual variante da chave funciona
// =========================================================

app.get('/shopee/test-sign', async (req, res) => {
  if (!checkConfig(res)) return;

  const apiPath = '/api/v2/public/get_shops_by_partner';
  const timestamp = nowTs();
  const baseString = `${SHOPEE_PARTNER_ID}${apiPath}${timestamp}`;
  const key = SHOPEE_PARTNER_KEY;

  // Variante A: chave inteira (como esta, com prefixo shpk)
  const signA = signWithKey(key, apiPath, timestamp);

  // Variante B: chave SEM prefixo "shpk" (remove primeiros 4 chars)
  const keyNoPrefix = key.startsWith('shpk') ? key.substring(4) : key;
  const signB = signWithKey(keyNoPrefix, apiPath, timestamp);

  const urlA = `${SHOPEE_HOST}${apiPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${signA}&page_size=10&page_no=1`;
  const urlB = `${SHOPEE_HOST}${apiPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${signB}&page_size=10&page_no=1`;

  let respA = null;
  let respB = null;

  try {
    const r = await fetch(urlA);
    respA = await r.json();
  } catch (e) {
    respA = { fetch_error: e.message };
  }

  try {
    const r = await fetch(urlB);
    respB = await r.json();
  } catch (e) {
    respB = { fetch_error: e.message };
  }

  const variantAWorks = respA && !respA.error;
  const variantBWorks = respB && !respB.error;

  let recommendation;
  if (variantAWorks) {
    recommendation = 'USE variante A (chave inteira com prefixo shpk). No Render, configure SHOPEE_KEY_VARIANT=full ou nao configure (padrao).';
  } else if (variantBWorks) {
    recommendation = 'USE variante B (chave SEM prefixo shpk). No Render, adicione SHOPEE_KEY_VARIANT=no_prefix e redeploy.';
  } else {
    recommendation = 'NENHUMA variante funcionou. A chave pode estar corrompida, precisa resetar no Shopee Open Platform.';
  }

  res.json({
    endpoint_tested: apiPath,
    timestamp: timestamp,
    base_string: baseString,
    partner_id: SHOPEE_PARTNER_ID,
    variants: {
      A_full_key: {
        description: 'Chave completa (incluindo prefixo shpk)',
        key_length: key.length,
        key_first_4: key.substring(0, 4),
        sign_first_12: signA.substring(0, 12),
        response: respA,
        works: variantAWorks
      },
      B_without_prefix: {
        description: 'Chave SEM prefixo shpk',
        key_length: keyNoPrefix.length,
        key_first_4: keyNoPrefix.substring(0, 4),
        sign_first_12: signB.substring(0, 12),
        response: respB,
        works: variantBWorks
      }
    },
    recommendation: recommendation
  });
});

// =========================================================
// DEBUG - info da chave sem chamar API
// =========================================================

app.get('/shopee/debug', (req, res) => {
  if (!checkConfig(res)) return;

  const key = SHOPEE_PARTNER_KEY || '';
  res.json({
    partner_id: SHOPEE_PARTNER_ID,
    key_length: key.length,
    key_first_4: key.substring(0, 4),
    key_last_4: key.substring(key.length - 4),
    key_variant_env: process.env.SHOPEE_KEY_VARIANT || 'not_set',
    effective_key_length: getEffectiveKey().length,
    effective_key_first_4: getEffectiveKey().substring(0, 4)
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
    <html><head><meta charset="UTF-8"><title>Autorizar Shopee</title>
    <style>
      body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 60px auto; padding: 20px; }
      h1 { color: #ee4d2d; }
      .info { background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .btn { display: inline-block; background: #ee4d2d; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; }
      code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    </style></head><body>
    <h1>Autorizar Loja Shopee</h1>
    <div class="info">
      <p><strong>Ambiente:</strong> ${NODE_ENV}</p>
      <p><strong>Key Variant:</strong> <code>${process.env.SHOPEE_KEY_VARIANT || 'full (default)'}</code></p>
      <p><strong>Partner ID:</strong> <code>${SHOPEE_PARTNER_ID}</code></p>
    </div>
    <p><a class="btn" href="${authUrl}">Autorizar com Shopee</a></p>
    </body></html>
  `);
});

app.get('/shopee/callback', async (req, res) => {
  if (!checkConfig(res)) return;
  const { code, shop_id } = req.query;

  if (!code || !shop_id) {
    return res.status(400).send(`<h1>Erro</h1><pre>${JSON.stringify(req.query, null, 2)}</pre>`);
  }

  try {
    const apiPath = '/api/v2/auth/token/get';
    const timestamp = nowTs();
    const sign = signPublic(apiPath, timestamp);
    const url = `${SHOPEE_HOST}${apiPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
    const body = { code, shop_id: parseInt(shop_id, 10), partner_id: parseInt(SHOPEE_PARTNER_ID, 10) };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (data.error || !data.access_token) {
      return res.status(500).send(`<h1>Erro ao obter token</h1><pre>${JSON.stringify(data, null, 2)}</pre>`);
    }

    res.send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tokens</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; }
        h1 { color: #ee4d2d; }
        .success { background: #e6f7e6; border: 2px solid #4caf50; padding: 20px; border-radius: 8px; }
        .token-box { background: #f5f5f5; border: 1px solid #ddd; padding: 15px; border-radius: 8px; margin: 15px 0; }
        code { background: #fff; padding: 10px; display: block; word-break: break-all; border: 1px solid #ccc; font-size: 13px; }
        button { background: #ee4d2d; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer; }
      </style>
      <script>
        function copyText(id, btn) {
          navigator.clipboard.writeText(document.getElementById(id).textContent.trim());
          btn.textContent = 'Copiado!';
          setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
        }
      </script></head><body>
      <h1>Tokens Gerados</h1>
      <div class="success"><strong>Shop ID:</strong> ${shop_id} | <strong>Expira em:</strong> ${Math.round(data.expire_in/3600)}h</div>
      <div class="token-box"><strong>SHOPEE_SHOP_ID</strong> <button onclick="copyText('sid', this)">Copiar</button><code id="sid">${shop_id}</code></div>
      <div class="token-box"><strong>SHOPEE_ACCESS_TOKEN</strong> <button onclick="copyText('at', this)">Copiar</button><code id="at">${data.access_token}</code></div>
      <div class="token-box"><strong>SHOPEE_REFRESH_TOKEN</strong> <button onclick="copyText('rt', this)">Copiar</button><code id="rt">${data.refresh_token}</code></div>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`<h1>Erro</h1><pre>${err.message}</pre>`);
  }
});

app.listen(PORT, () => {
  console.log(`Girassol Shopee Sync na porta ${PORT}`);
  console.log(`Partner ID: ${SHOPEE_PARTNER_ID || 'NAO CONFIGURADO'}`);
  console.log(`Key length: ${SHOPEE_PARTNER_KEY ? SHOPEE_PARTNER_KEY.length : 0}`);
  console.log(`Key variant: ${process.env.SHOPEE_KEY_VARIANT || 'full (default)'}`);
});
