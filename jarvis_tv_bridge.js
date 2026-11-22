const http = require('http');

const TV_IPS = {
  willian: process.env.TV_WILLIAN_IP || '192.168.1.6',
  mae: process.env.TV_MAE_IP || '192.168.1.11'
};

const APP_IDS = {
  dev: 'dev',
  hub: 'dev',
  streamhub: 'dev',
  twitch: 'dev',
  youtube: '837',
  netflix: '12',
  prime: '13',
  disney: '291097',
  globoplay: '549654',
  spotify: '22297',
  pluto: '74519'
};

let activeJarvisAlert = {
  willian: null,
  mae: null
};

function sendRokuEcp(ip, method, pathStr) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: ip,
      port: 8060,
      path: pathStr,
      method: method || 'POST',
      timeout: 3000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('TV timeout (desligada ou inacessível)')); });
    req.on('error', reject);
    req.end();
  });
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (_) { resolve({}); }
    });
  });
}

function getJarvisAlert(tvKey) {
  const key = tvKey === 'mae' ? 'mae' : 'willian';
  const alert = activeJarvisAlert[key];
  if (!alert) return null;
  if (Date.now() > alert.expiresAt) {
    activeJarvisAlert[key] = null;
    return null;
  }
  return alert;
}

function setJarvisAlert(tvTarget, title, text, durationMs) {
  const alert = {
    id: Date.now(),
    title: title || 'JARVIS • MOTO G60',
    text: text || '',
    expiresAt: Date.now() + (durationMs || 18000)
  };
  if (tvTarget === 'both') {
    activeJarvisAlert.willian = alert;
    activeJarvisAlert.mae = alert;
  } else if (tvTarget === 'mae') {
    activeJarvisAlert.mae = alert;
  } else {
    activeJarvisAlert.willian = alert;
  }
  return alert;
}

async function handleJarvisTvRoutes(req, res, urlObj) {
  const pathname = urlObj.pathname;

  // 1. Health & Runtime Info
  if (pathname === '/api/health' && req.method === 'GET') {
    const isTermux = Boolean(process.env.TERMUX_VERSION || (process.env.PREFIX && process.env.PREFIX.includes('com.termux')));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      ok: true,
      service: 'stream-hub-pro',
      version: '3.0.0',
      runtime: isTermux ? 'motog60-termux' : (process.env.RENDER ? 'render-cloud' : 'node-local'),
      uptimeSec: Math.floor(process.uptime()),
      tvs: TV_IPS
    }));
    return true;
  }

  // 2. Jarvis Notification Banner on TV screen
  if (pathname === '/api/jarvis/notify' && req.method === 'POST') {
    const data = await readJsonBody(req);
    const alert = setJarvisAlert(data.tv || 'willian', data.title || 'JARVIS • MOTO G60', data.text || data.message || 'Notificação do Jarvis', data.durationMs || 20000);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, alert }));
    return true;
  }

  // 3. Send Remote Control Key via ECP (e.g. VolumeUp, VolumeDown, VolumeMute, PowerOff, PowerOn, Home, Play, Back)
  if (pathname === '/api/tv/key' && req.method === 'POST') {
    const data = await readJsonBody(req);
    const tvKey = data.tv === 'mae' ? 'mae' : 'willian';
    const ip = data.ip || TV_IPS[tvKey];
    const key = (data.key || 'Home').replace(/[^a-zA-Z0-9_]/g, '');
    const repeat = Math.min(Math.max(parseInt(data.repeat || '1', 10), 1), 15);
    try {
      for (let i = 0; i < repeat; i++) {
        await sendRokuEcp(ip, 'POST', `/keypress/${key}`);
        if (repeat > 1) await new Promise(r => setTimeout(r, 120));
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, tv: tvKey, ip, key, repeat }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, tv: tvKey, ip, error: e.message }));
    }
    return true;
  }

  // 4. Launch App on TV via ECP (dev / youtube / netflix / prime / etc.)
  if (pathname === '/api/tv/launch' && req.method === 'POST') {
    const data = await readJsonBody(req);
    const tvKey = data.tv === 'mae' ? 'mae' : 'willian';
    const ip = data.ip || TV_IPS[tvKey];
    const rawApp = (data.app || 'dev').toLowerCase();
    const appId = APP_IDS[rawApp] || rawApp.replace(/[^a-zA-Z0-9]/g, '');
    try {
      await sendRokuEcp(ip, 'POST', `/launch/${appId}`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, tv: tvKey, ip, appId }));
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, tv: tvKey, ip, error: e.message }));
    }
    return true;
  }

  // 5. Query TV Status via ECP
  if (pathname === '/api/tv/status' && req.method === 'GET') {
    const tvKey = urlObj.searchParams.get('tv') === 'mae' ? 'mae' : 'willian';
    const ip = urlObj.searchParams.get('ip') || TV_IPS[tvKey];
    try {
      const info = await sendRokuEcp(ip, 'GET', '/query/device-info');
      const active = await sendRokuEcp(ip, 'GET', '/query/active-app');
      const nameM = info.body.match(/<friendly-device-name>([^<]+)</);
      const powerM = info.body.match(/<power-mode>([^<]+)</);
      const appM = active.body.match(/<app[^>]*>([^<]+)</);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        ok: true,
        tv: tvKey,
        ip,
        deviceName: nameM ? nameM[1] : 'Roku TV',
        powerMode: powerM ? powerM[1] : 'Unknown',
        activeApp: appM ? appM[1] : 'Home'
      }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, tv: tvKey, ip, online: false, error: e.message }));
    }
    return true;
  }

  return false;
}

module.exports = {
  handleJarvisTvRoutes,
  getJarvisAlert,
  setJarvisAlert
};
