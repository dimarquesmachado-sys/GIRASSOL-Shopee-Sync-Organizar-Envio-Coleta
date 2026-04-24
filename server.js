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

function signWithKey(keyBufferOrString, apiPath, timestamp) {
  const baseString = `${SHOPEE_PARTNER_ID}${apiPath}${timestamp}`;
  return crypto.createHmac('sha256', keyBufferOrString).update(baseString).digest('hex');
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function isHex(s) {
  return /^[a-f0-9]+$/i.test(s);
}

function checkConfig(res) {
  if (!SHOPEE_PARTNER_ID || !SHOPEE_PARTNER_KEY) {
    res.status(500).json({ error: 'Configuracao incompleta' });
    return false;
  }
  return true;
}

// =========================================================
// Sign usando variante configurada
// =========================================================
function getSigningKey() {
  const variant = process.env.SHOPEE_KEY_VARIANT || 'full';
  const key = SHOPEE_PARTNER_KEY || '';
  const noPrefix = key.startsWith('shpk') ? key.substring(4) : key;

  switch (variant) {
    case 'no_prefix':
      return noPrefix;
    case 'hex_bytes':
      return Buffer.from(noPrefix, 'hex');
    case 'full_hex_bytes':
      // Improvável mas possível
      return Buffer.from(key, 'hex');
    case 'full':
    default:
      return key;
  }
}

function signPublic(apiPath, timestamp) {
  return signWithKey(getSigningKey(), apiPath, timestamp);
}

// =========================================================
// Rotas basicas
// =========================================================

app.get('/', (req, res) => {
  res.json({
    service: 'Girassol Shopee NFe Sync',
    version: '0.5.0',
    key_variant: process.env.SHOPEE_KEY_VARIANT || 'full (default)',
    actions: {
      test_sign_v2: `${BASE_URL}/shopee/test-sign-v2`,
      start_auth: `${BASE_URL}/shopee/auth`
    }
  });
});

app.get('/status', (req, res) => {
  res.json({
    config: {
      partner_id: SHOPEE_PARTNER_ID || 'NAO_CONFIGURADO',
      partner_key: SHOPEE_PARTNER_KEY ? 'CONFIGURADA' : 'NAO_CONFIGURADA',
      key_variant: process.env.SHOPEE_KEY_VARIANT || 'full (default)',
      shop_id: process.env.SHOPEE_SHOP_ID || 'NAO_AUTORIZADA',
      access_token: process.env.SHOPEE_ACCESS_TOKEN ? 'OK' : 'NAO_CONFIGURADO'
    }
  });
});

// =========================================================
// TESTE AVANCADO - 4 variantes de chave
// =========================================================

app.get('/shopee/test-sign-v2', async (req, res) => {
  if (!checkConfig(res)) return;

  const apiPath = '/api/v2/public/get_shops_by_partner';
  const timestamp = nowTs();
  const key = SHOPEE_PARTNER_KEY;
  const noPrefix = key.startsWith('shpk') ? key.substring(4) : key;

  const variants = [
    {
      name: 'A_full_string',
      description: 'Chave inteira como string UTF-8 (incluindo prefixo shpk)',
      info: { length: key.length, first4: key.substring(0, 4) },
      keyForSign: key
    },
    {
      name: 'B_no_prefix_string',
      description: 'Chave sem prefixo shpk como string UTF-8',
      info: { length: noPrefix.length, first4: noPrefix.substring(0, 4), isHex: isHex(noPrefix) },
      keyForSign: noPrefix
    },
    {
      name: 'C_no_prefix_hex_bytes',
      description: 'Chave sem prefixo convertida de hex para bytes binarios',
      info: {
        isHex: isHex(noPrefix),
        bytesLength: isHex(noPrefix) ? noPrefix.length / 2 : 'nao_eh_hex'
      },
      keyForSign: isHex(noPrefix) ? Buffer.from(noPrefix, 'hex') : null
    },
    {
      name: 'D_full_as_hex_bytes',
      description: 'Chave inteira tentada como hex (provavelmente falha pq shpk nao eh hex)',
      info: { isHex: isHex(key) },
      keyForSign: isHex(key) ? Buffer.from(key, 'hex') : null
    }
  ];

  const results = [];

  for (const v of variants) {
    if (!v.keyForSign) {
      results.push({
        variant: v.name,
        description: v.description,
        info: v.info,
        skipped: true,
        reason: 'Chave incompativel com este formato'
      });
      continue;
    }

    const sign = signWithKey(v.keyForSign, apiPath, timestamp);
    const url = `${SHOPEE_HOST}${apiPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}&page_size=10&page_no=1`;

    let response;
    try {
      const r = await fetch(url);
      response = await r.json();
    } catch (e) {
      response = { fetch_error: e.message };
    }

    results.push({
      variant: v.name,
      description: v.description,
      info: v.info,
      sign_first_12: sign.substring(0, 12),
      response: response,
      works: response && !response.error
    });
  }

  const winner = results.find(r => r.works);
  let recommendation;
  if (winner) {
    const variantToUse = winner.variant.includes('A_full') ? 'full' :
                         winner.variant.includes('B_no_prefix_string') ? 'no_prefix' :
                         winner.variant.includes('C_no_prefix_hex_bytes') ? 'hex_bytes' :
                         'full_hex_bytes';
    recommendation = `FUNCIONOU! Variante: ${winner.variant}. No Render, adicione/altere a env var SHOPEE_KEY_VARIANT=${variantToUse}`;
  } else {
    recommendation = 'Nenhuma variante funcionou. Proximos passos: (1) resetar a chave no Shopee Open Platform ou (2) investigar se precisa ativar Go-Live primeiro.';
  }

  res.json({
    endpoint_tested: apiPath,
    base_string: `${SHOPEE_PARTNER_ID}${apiPath}${timestamp}`,
    timestamp: timestamp,
    results: results,
    recommendation: recommendation
  });
});

// =========================================================
// OAuth (usa getSigningKey configurada)
// =========================================================

app.get('/shopee/auth', (req, res) => {
  if (!checkConfig(res)) return;
  const apiPath = '/api/v2/shop/auth_partner';
  const timestamp = nowTs();
  const sign = signPublic(apiPath, timestamp);
  const redirectUrl = `${BASE_URL}/shopee/callback`;
  const authUrl = `${SHOPEE_HOST}${apiPath}?partner_id=${SHOPEE_PARTNER_ID}&timestamp=${timestamp}&sign=${sign}&redirect=${encodeURIComponent(redirectUrl)}`;

  res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Autorizar</title>
    <style>body{font-family:sans-serif;max-width:700px;margin:60px auto;padding:20px}.btn{display:inline-block;background:#ee4d2d;color:white;padding:15px 30px;text-decoration:none;border-radius:8px;font-weight:bold}</style>
    </head><body><h1>Autorizar Shopee</h1>
    <p>Variante: <strong>${process.env.SHOPEE_KEY_VARIANT || 'full (default)'}</strong></p>
    <a class="btn" href="${authUrl}">Autorizar com Shopee</a>
    </body></html>
  `);
});

app.get('/shopee/callback', async (req, res) => {
  if (!checkConfig(res)) return;
  const { code, shop_id } = req.query;
  if (!code || !shop_id) {
    return res.status(400).send(`<pre>${JSON.stringify(req.query, null, 2)}</pre>`);
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
      return res.status(500).send(`<h1>Erro</h1><pre>${JSON.stringify(data, null, 2)}</pre>`);
    }
    res.send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:900px;margin:40px auto;padding:20px">
      <h1 style="color:#ee4d2d">Tokens Gerados!</h1>
      <div style="background:#e6f7e6;border:2px solid #4caf50;padding:20px;border-radius:8px">Shop ID: ${shop_id} | Expira em ${Math.round(data.expire_in/3600)}h</div>
      <h3>SHOPEE_SHOP_ID</h3><code style="background:#fff;padding:10px;display:block;word-break:break-all;border:1px solid #ccc">${shop_id}</code>
      <h3>SHOPEE_ACCESS_TOKEN</h3><code style="background:#fff;padding:10px;display:block;word-break:break-all;border:1px solid #ccc">${data.access_token}</code>
      <h3>SHOPEE_REFRESH_TOKEN</h3><code style="background:#fff;padding:10px;display:block;word-break:break-all;border:1px solid #ccc">${data.refresh_token}</code>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`<pre>${err.message}</pre>`);
  }
});

app.listen(PORT, () => {
  console.log(`Girassol Shopee Sync porta ${PORT} | variant: ${process.env.SHOPEE_KEY_VARIANT || 'full'}`);
});
