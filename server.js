const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { handlePcGamerRoutes, ensureStandbyHls } = require('./pc_gamer');
const { buildM3u } = require('./playlist_builder');
const { handleXtreamApi, findStreamById } = require('./xtream_api');
const { handlePanelRoutes } = require('./panel_handler');
const { handleHlsRequest } = require('./hls_remuxer');

const PORT = process.env.PORT || 8080;
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const HLS_DIR = path.join(__dirname, 'live_hls');

if (!fs.existsSync(HLS_DIR)) {
  fs.mkdirSync(HLS_DIR, { recursive: true });
}

let activeFfmpeg = null;
let currentStreamSource = '';

function stopActiveFfmpeg() {
  if (activeFfmpeg) {
    try { activeFfmpeg.kill('SIGKILL'); } catch (e) {}
    activeFfmpeg = null;
  }
}

function cleanHlsDir() {
  try {
    const files = fs.readdirSync(HLS_DIR);
    for (const f of files) {
      try { fs.unlinkSync(path.join(HLS_DIR, f)); } catch (e) {}
    }
  } catch (e) {}
}

function getFfmpegHeadersForUrl(sourceUrl) {
  if (!sourceUrl) return 'User-Agent: Mozilla/5.0\r\n';
  if (sourceUrl.includes('domhsd.com') || sourceUrl.includes('streamtp')) {
    return 'Referer: https://streamtp99a.sbs/\r\nUser-Agent: Mozilla/5.0\r\n';
  }
  if (sourceUrl.includes('cloudfront-net.lat') || sourceUrl.includes('embedtv')) {
    return 'Referer: https://ww0.embedtv.cc/\r\nUser-Agent: Mozilla/5.0\r\n';
  }
  return 'User-Agent: Mozilla/5.0\r\n';
}

function startHlsTranscode(sourceUrl) {
  return new Promise((resolve) => {
    if (!sourceUrl) return resolve(false);
    const m3u8Path = path.join(HLS_DIR, 'index.m3u8');
    if (activeFfmpeg && currentStreamSource === sourceUrl && fs.existsSync(m3u8Path)) {
      return resolve(true);
    }

    stopActiveFfmpeg();
    cleanHlsDir();
    currentStreamSource = sourceUrl;

    const args = [
      '-y',
      '-headers', getFfmpegHeadersForUrl(sourceUrl),
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', sourceUrl,
      '-vf', 'scale=1280:720',
      '-r', '30',
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', '1800k',
      '-maxrate', '2000k',
      '-bufsize', '3600k',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+independent_segments',
      m3u8Path
    ];

    console.log('[FFMPEG-HLS] Starting transcode for:', sourceUrl);
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    activeFfmpeg = proc;

    proc.on('exit', () => {
      if (activeFfmpeg === proc) {
        activeFfmpeg = null;
      }
    });

    let waited = 0;
    const timer = setInterval(() => {
      waited += 250;
      if (fs.existsSync(m3u8Path)) {
        try {
          const stat = fs.statSync(m3u8Path);
          if (stat.size > 20) {
            clearInterval(timer);
            return resolve(true);
          }
        } catch (e) {}
      }
      if (waited >= 6500 || activeFfmpeg !== proc) {
        clearInterval(timer);
        return resolve(fs.existsSync(m3u8Path));
      }
    }, 250);
  });
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'okhttp/4.12.0',
        'Accept': 'application/json, text/plain, */*',
        ...(options.headers || {})
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return fetchUrl(nextUrl, options).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getTwitchStreams(lang) {
  const langOpt = lang ? `, options: {broadcasterLanguages: [${lang}]}` : '';
  const query = `{ streams(first: 24${langOpt}) { edges { node { broadcaster { login displayName } title viewersCount game { name } previewImageURL(width: 320, height: 180) } } } }`;
  const r = await fetchUrl('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = JSON.parse(r.body);
  const edges = (json && json.data && json.data.streams && json.data.streams.edges) || [];
  return edges.map(e => {
    const n = e.node;
    return {
      platform: 'twitch',
      login: n.broadcaster.login,
      displayName: n.broadcaster.displayName,
      title: n.title || '',
      game: (n.game && n.game.name) || 'Ao Vivo',
      viewers: n.viewersCount || 0,
      thumb: n.previewImageURL || ''
    };
  });
}

async function searchTwitch(qStr) {
  const clean = qStr.replace(/"/g, '').trim();
  const query = `{ user(login: "${clean.toLowerCase()}") { login displayName broadcastSettings { title } stream { viewersCount game { name } previewImageURL(width: 320, height: 180) } } searchFor(userQuery: "${clean}", platform: "web") { channels { edges { item { ... on User { login displayName broadcastSettings { title } stream { viewersCount game { name } previewImageURL(width: 320, height: 180) } } } } } } }`;
  const r = await fetchUrl('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = JSON.parse(r.body);
  const list = [];
  const seen = {};
  function addU(u) {
    if (!u || !u.login || seen[u.login]) return;
    seen[u.login] = true;
    list.push({
      platform: 'twitch',
      login: u.login,
      displayName: u.displayName || u.login,
      title: (u.broadcastSettings && u.broadcastSettings.title) || '',
      game: (u.stream && u.stream.game && u.stream.game.name) || (u.stream ? 'Ao Vivo' : 'Offline'),
      viewers: (u.stream && u.stream.viewersCount) || 0,
      thumb: (u.stream && u.stream.previewImageURL) || ''
    });
  }
  if (json && json.data) {
    if (json.data.user) addU(json.data.user);
    if (json.data.searchFor && json.data.searchFor.channels && json.data.searchFor.channels.edges) {
      json.data.searchFor.channels.edges.forEach(e => addU(e.item));
    }
  }
  return list;
}

async function getKickStreams() {
  const r = await fetchUrl('https://kick.com/stream/featured-livestreams/pt');
  const json = JSON.parse(r.body);
  const data = (json && json.data) || [];
  return data.map(st => ({
    platform: 'kick',
    login: st.channel ? st.channel.slug : '',
    displayName: (st.channel && st.channel.user && st.channel.user.username) || (st.channel && st.channel.slug) || 'Kick',
    title: st.session_title || '',
    game: (st.categories && st.categories[0] && st.categories[0].name) || 'Kick Live',
    viewers: st.viewer_count || 0,
    thumb: (st.thumbnail && st.thumbnail.src) || '',
    playbackUrl: (st.channel && st.channel.playback_url) || ''
  }));
}

function extractIframeSrc(raw) {
  if (!raw) return '';
  const m1 = raw.match(/src='([^']+)'/i);
  if (m1) return m1[1];
  const m2 = raw.match(/src="([^"]+)"/i);
  if (m2) return m2[1];
  return String(raw).trim();
}

function guessEmbedTvChannel(title, category, sourcesStr) {
  const s = (sourcesStr || '').toLowerCase();
  const c = (category || '').toLowerCase();
  const t = (title || '').toLowerCase();
  if (s.includes('sportynet') || s.includes('spnet')) return 'sportynet';
  if (s.includes('/xsp') || s.includes('xsports')) return 'xsports';
  if (s.includes('/pre1') || s.includes('premiere1')) return 'premiere';
  if (s.includes('/pre2') || s.includes('premiere2')) return 'premiere2';
  if (s.includes('/pre3') || s.includes('premiere3')) return 'premiere3';
  if (s.includes('/spo1') || s.includes('sportv1')) return 'sportv';
  if (s.includes('/spo2') || s.includes('sportv2')) return 'sportv2';
  if (s.includes('/spo3') || s.includes('sportv3')) return 'sportv3';
  if (s.includes('espn6')) return 'espn6';
  if (s.includes('espn5')) return 'espn5';
  if (s.includes('espn4')) return 'espn4';
  if (s.includes('espn3')) return 'espn3';
  if (s.includes('espn2')) return 'espn2';
  if (s.includes('espn')) return 'espn';
  if (s.includes('tnt') || s.includes('max')) return 'tnt';
  if (s.includes('caze')) return 'sportv';
  if (s.includes('globo')) return 'globosp';

  if (c.includes('série a') || c.includes('serie a')) return 'premiere';
  if (c.includes('série b') || c.includes('serie b')) return 'premiere';
  if (c.includes('russo')) return 'xsports';
  if (c.includes('italiano')) return 'sportynet';
  if (c.includes('inglês') || c.includes('ingles')) return 'espn';
  if (c.includes('espanhol 2')) return 'espn4';
  if (c.includes('espanhol') || c.includes('português') || c.includes('portugues')) return 'espn2';
  if (t.includes('santos') || t.includes('flamengo') || t.includes('corinthians') || t.includes('palmeiras')) return 'premiere';
  return 'sportv';
}

async function getPartidasStreams() {
  const items = [];
  let pdh = null;
  try {
    const r1 = await fetchUrl('https://novocapitulo.site/AM_BIBO_CONF27/PDH27.json');
    pdh = JSON.parse(r1.body);
  } catch (e) {}

  if (!pdh || !Array.isArray(pdh.channels) || pdh.channels.length === 0) {
    try {
      const r2 = await fetchUrl('https://minodobola.xyz/AM_BIBO_CONF27/PDH27.json');
      pdh = JSON.parse(r2.body);
    } catch (e) {}
  }

  if (pdh && Array.isArray(pdh.channels)) {
    pdh.channels.forEach(ch => {
      const title = ch.title || 'Partida de Hoje';
      const cat = ch.category || 'Futebol Ao Vivo';
      const img = ch.image || 'https://i.ibb.co/23FwLv3K/par27.png';
      const srcs = [];
      for (let i = 1; i <= 9; i++) {
        const s = extractIframeSrc(ch['source' + i]);
        if (s) srcs.push(s);
      }
      const joined = srcs.join('|');
      const fallbackCh = guessEmbedTvChannel(title, cat, joined);
      const payload = joined
        ? `${joined}|embedtv:${fallbackCh}|embedtv:premiere|embedtv:sportv|embedtv:espn`
        : `embedtv:${fallbackCh}|embedtv:premiere|embedtv:sportv|embedtv:espn`;
      const isLiveNow = srcs.length > 0;

      items.push({
        platform: 'partidas',
        login: Buffer.from(payload, 'utf8').toString('base64'),
        displayName: (isLiveNow ? '🟢 ' : '📅 ') + title,
        title: isLiveNow ? `AO VIVO AGORA (${cat}) - ${srcs.length} opções` : `Jogo de Hoje (${cat}) - Canal: ${fallbackCh.toUpperCase()}`,
        game: cat,
        viewers: isLiveNow ? 1850 : 0,
        thumb: img
      });
    });
  }

  const liveChannels = [
    { id: 'premiere', name: 'Premiere Clubes (24h)', desc: 'Brasileirão Série A e B Ao Vivo' },
    { id: 'sportv', name: 'SporTV 1 HD', desc: 'Futebol e Esportes Ao Vivo' },
    { id: 'sportv2', name: 'SporTV 2 HD', desc: 'Transmissões Ao Vivo' },
    { id: 'sportv3', name: 'SporTV 3 HD', desc: 'Transmissões Ao Vivo' },
    { id: 'espn', name: 'ESPN 1 HD', desc: 'Premier League, LaLiga, Série A Italiana' },
    { id: 'espn2', name: 'ESPN 2 HD', desc: 'Futebol Internacional Ao Vivo' },
    { id: 'espn3', name: 'ESPN 3 HD', desc: 'Esportes e Futebol Ao Vivo' },
    { id: 'espn4', name: 'ESPN 4 HD', desc: 'Futebol Europeu e Sul-Americano' },
    { id: 'espn5', name: 'ESPN 5 HD', desc: 'Futebol Internacional e Esportes' },
    { id: 'espn6', name: 'ESPN 6 HD', desc: 'Transmissões Exclusivas ESPN' },
    { id: 'sportynet', name: 'SportyNet HD', desc: 'Campeonato Italiano e Futebol Ao Vivo' },
    { id: 'tnt', name: 'TNT Sports / Max', desc: 'Champions League e Futebol Ao Vivo' },
    { id: 'globosp', name: 'TV Globo SP', desc: 'Futebol na Globo São Paulo Ao Vivo' },
    { id: 'globorj', name: 'TV Globo RJ', desc: 'Futebol na Globo Rio Ao Vivo' },
    { id: 'globomg', name: 'TV Globo MG', desc: 'Futebol na Globo Minas Ao Vivo' },
    { id: 'sbt', name: 'SBT Esporte', desc: 'Champions e Sul-Americana Ao Vivo' },
    { id: 'band', name: 'Band Esporte', desc: 'Futebol Ao Vivo na Band' },
    { id: 'bandsports', name: 'BandSports HD', desc: 'Futebol e Esportes 24h Ao Vivo' },
    { id: 'record', name: 'Record TV', desc: 'Brasileirão e Estaduais Ao Vivo' },
    { id: 'xsports', name: 'XSports HD', desc: 'Jogos Internacionais Ao Vivo' },
    { id: 'combate', name: 'Combate HD', desc: 'UFC e Lutas Ao Vivo 24h' },
    { id: 'premiere2', name: 'Premiere 2', desc: 'Brasileirão Série A e B Ao Vivo' },
    { id: 'premiere3', name: 'Premiere 3', desc: 'Brasileirão Série A e B Ao Vivo' },
    { id: 'premiere4', name: 'Premiere 4', desc: 'Jogos Exclusivos Ao Vivo' },
    { id: 'premiere5', name: 'Premiere 5', desc: 'Jogos Exclusivos Ao Vivo' }
  ];

  liveChannels.forEach(lc => {
    items.push({
      platform: 'partidas',
      login: Buffer.from('embedtv:' + lc.id, 'utf8').toString('base64'),
      displayName: '📺 ' + lc.name,
      title: lc.desc,
      game: 'Canal 24h Ao Vivo',
      viewers: 2500,
      thumb: `https://img.faz-o-eli.online/${lc.id}.prev.png`
    });
  });

  return items;
}

function getFilmesTvStreams() {
  const movieChannels = [
    { id: 'telecinepremium', name: 'Telecine Premium HD', cat: 'Filmes 24h', desc: 'Lançamentos e grandes sucessos do cinema ao vivo' },
    { id: 'telecineaction', name: 'Telecine Action HD', cat: 'Filmes 24h', desc: 'Filmes de ação, suspense e adrenalina 24h' },
    { id: 'telecinepipoca', name: 'Telecine Pipoca HD', cat: 'Filmes 24h', desc: 'Blockbusters e diversão para toda a família 24h' },
    { id: 'telecinefun', name: 'Telecine Fun HD', cat: 'Filmes 24h', desc: 'Comédias e animações 24h ao vivo' },
    { id: 'telecinetouch', name: 'Telecine Touch HD', cat: 'Filmes 24h', desc: 'Dramas e romances emocionantes 24h' },
    { id: 'telecinecult', name: 'Telecine Cult HD', cat: 'Filmes 24h', desc: 'Clássicos e cinema premiado 24h' },
    { id: 'hbo', name: 'HBO HD', cat: 'Filmes & Séries', desc: 'Séries originais HBO e grandes filmes ao vivo' },
    { id: 'hbo2', name: 'HBO 2 HD', cat: 'Filmes & Séries', desc: 'Filmes e séries dublados 24h ao vivo' },
    { id: 'hboplus', name: 'HBO Plus HD', cat: 'Filmes & Séries', desc: 'Sucessos de bilheteria e séries HBO ao vivo' },
    { id: 'hbofamily', name: 'HBO Family HD', cat: 'Filmes & Família', desc: 'Filmes para toda a família 24h' },
    { id: 'hboxtreme', name: 'HBO Xtreme HD', cat: 'Filmes & Ação', desc: 'Ação intensa, ficção e aventura 24h' },
    { id: 'megapix', name: 'Megapix HD', cat: 'Filmes 24h', desc: 'Os maiores sucessos do cinema dublados 24h' },
    { id: 'space', name: 'Space HD', cat: 'Filmes & Séries', desc: 'Cinema de ação, terror, ficção e lutas ao vivo' },
    { id: 'cinemax', name: 'Cinemax HD', cat: 'Filmes & Séries', desc: 'Filmes e séries de sucesso 24h ao vivo' },
    { id: 'tntseries', name: 'TNT Séries HD', cat: 'Séries 24h', desc: 'Maratonas de séries policiais e de ação 24h' },
    { id: 'tntnovelas', name: 'TNT Novelas HD', cat: 'Novelas 24h', desc: 'Grandes novelas e dramas internacionais 24h' },
    { id: 'amc', name: 'AMC HD', cat: 'Filmes & Séries', desc: 'Séries exclusivas e filmes de ação ao vivo' },
    { id: 'axn', name: 'AXN HD', cat: 'Séries 24h', desc: 'Séries de investigação criminal e ação 24h' },
    { id: 'cartoonnetwork', name: 'Cartoon Network HD', cat: 'Desenhos 24h', desc: 'Desenhos e animações ao vivo 24h' },
    { id: 'adultswim', name: 'Adult Swim HD', cat: 'Animação & Geek', desc: 'Rick and Morty, animes e animações adultas 24h' },
    { id: 'discoverykids', name: 'Discovery Kids HD', cat: 'Infantil 24h', desc: 'Desenhos educativos e infantis 24h' },
    { id: 'gloob', name: 'Gloob HD', cat: 'Infantil 24h', desc: 'Miraculous, Detetives do Prédio Azul e desenhos 24h' },
    { id: 'multishow', name: 'Multishow HD', cat: 'Variedades & Humor', desc: 'Shows ao vivo, humor e realities 24h' },
    { id: 'bis', name: 'Canal BIS HD', cat: 'Música & Shows', desc: 'Shows internacionais e música ao vivo 24h' },
    { id: 'gnt', name: 'GNT HD', cat: 'Variedades', desc: 'Gastronomia, entrevistas e estilo de vida 24h' },
    { id: 'off', name: 'Canal OFF HD', cat: 'Aventura & Surf', desc: 'Esportes radicais, surf e natureza em HD 24h' },
    { id: 'history', name: 'History Channel HD', cat: 'Documentários', desc: 'Trato Feito, história, mistérios e documentários 24h' },
    { id: 'history2', name: 'History 2 (H2) HD', cat: 'Documentários', desc: 'História profunda, ciência e civilizações 24h' },
    { id: 'animalplanet', name: 'Animal Planet HD', cat: 'Natureza 24h', desc: 'Vida selvagem e natureza em alta definição 24h' },
    { id: 'discoveryworld', name: 'Discovery World HD', cat: 'Documentários', desc: 'Viagens, cultura mundial e documentários em HD' },
    { id: 'discoveryscience', name: 'Discovery Science HD', cat: 'Ciência & Espaço', desc: 'Tecnologia, universo, engenharia e ciência 24h' },
    { id: 'globonews', name: 'GloboNews HD', cat: 'Notícias 24h', desc: 'Jornalismo e notícias ao vivo 24 horas' },
    { id: 'cnnbrasil', name: 'CNN Brasil HD', cat: 'Notícias 24h', desc: 'Notícias do Brasil e do mundo ao vivo 24h' },
    { id: 'recordnews', name: 'Record News HD', cat: 'Notícias 24h', desc: 'Jornalismo e informação ao vivo 24h' },
    { id: 'cultura', name: 'TV Cultura HD', cat: 'TV Aberta', desc: 'Programação cultural, jornalismo e infantil ao vivo' },
    { id: 'redetv', name: 'RedeTV! HD', cat: 'TV Aberta', desc: 'Entretenimento, esportes e jornalismo ao vivo' },
    { id: 'aparecida', name: 'TV Aparecida HD', cat: 'TV Aberta', desc: 'Programação ao vivo 24 horas' }
  ];

  return movieChannels.map(mc => ({
    platform: 'partidas',
    login: Buffer.from('embedtv:' + mc.id, 'utf8').toString('base64'),
    displayName: '🎬 ' + mc.name,
    title: mc.desc,
    game: mc.cat,
    viewers: 3200,
    thumb: `https://img.faz-o-eli.online/${mc.id}.prev.png`
  }));
}

async function isValidHlsUrl(hlsUrl, referer) {
  if (!hlsUrl) return false;
  try {
    const r = await fetchUrl(hlsUrl, {
      headers: {
        'Referer': referer || 'https://ww0.embedtv.cc/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return r.status === 200 && r.body && r.body.includes('#EXTM3U');
  } catch (e) {
    return false;
  }
}

async function resolveSinglePartidasUrl(srcUrl) {
  if (!srcUrl) return null;
  try {
    if (srcUrl.startsWith('embedtv:')) {
      const chId = srcUrl.slice(8);
      const r = await fetchUrl(`https://ww0.embedtv.cc/${chId}`, {
        headers: {
          'Referer': 'https://skyflowmino.space/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'
        }
      });
      const m = r.body.match(/const\s+src\s*=\s*"([^"]+)"/);
      if (m && await isValidHlsUrl(m[1], 'https://ww0.embedtv.cc/')) {
        return { hlsUrl: m[1], embedUrl: `https://ww0.embedtv.cc/${chId}` };
      }
    }
    if (srcUrl.includes('embedtv?id=')) {
      const chId = srcUrl.split('embedtv?id=')[1].split('&')[0];
      const r = await fetchUrl(`https://ww0.embedtv.cc/${chId}`, {
        headers: {
          'Referer': 'https://skyflowmino.space/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'
        }
      });
      const m = r.body.match(/const\s+src\s*=\s*"([^"]+)"/);
      if (m && await isValidHlsUrl(m[1], 'https://ww0.embedtv.cc/')) {
        return { hlsUrl: m[1], embedUrl: `https://ww0.embedtv.cc/${chId}` };
      }
    }
    if (srcUrl.includes('streamtp') || srcUrl.includes('global1.php')) {
      const r = await fetchUrl(srcUrl, {
        headers: {
          'Referer': 'https://skyflowmino.space/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
          'X-App-Token': 'PARTIDAS2026',
          'X-Requested-With': 'com.partidas25.futeboldahoraaovivo'
        }
      });
      const m = r.body.match(/var\s+playbackURL\s*=\s*"([^"]+)"/);
      if (m) {
        const cleanPb = m[1].replace(/\\\//g, '/');
        if (await isValidHlsUrl(cleanPb, 'https://streamtp99a.sbs/')) {
          return { hlsUrl: cleanPb, embedUrl: srcUrl };
        }
      }
    }
    if (srcUrl.includes('.m3u8')) {
      if (await isValidHlsUrl(srcUrl, 'https://skyflowmino.space/')) {
        return { hlsUrl: srcUrl, embedUrl: srcUrl };
      }
    }
  } catch (e) {}
  return null;
}

async function resolveStreamHls(platform, login) {
  if (platform === 'partidas') {
    let raw = login;
    if (!login.includes('embedtv') && !login.includes('http')) {
      try {
        raw = Buffer.from(login, 'base64').toString('utf8');
      } catch (e) {}
    }
    const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (p.includes('embedtv')) {
        const res = await resolveSinglePartidasUrl(p);
        if (res && res.hlsUrl) return res;
      }
    }
    for (const p of parts) {
      if (!p.includes('embedtv')) {
        const res = await resolveSinglePartidasUrl(p);
        if (res && res.hlsUrl) return res;
      }
    }
    return { hlsUrl: '', embedUrl: parts[0] || '' };
  }
  if (platform === 'kick') {
    const r = await fetchUrl(`https://kick.com/api/v1/channels/${encodeURIComponent(login)}`);
    const d = JSON.parse(r.body);
    return { hlsUrl: (d && d.playback_url) || '', embedUrl: `https://player.kick.com/${encodeURIComponent(login)}?autoplay=true` };
  }
  const query = `{ streamPlaybackAccessToken(channelName: "${login}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "embed"}) { value signature } }`;
  const r = await fetchUrl('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = JSON.parse(r.body);
  const tok = json && json.data && json.data.streamPlaybackAccessToken;
  if (tok && tok.value && tok.signature) {
    return {
      hlsUrl: `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?client_id=${TWITCH_CLIENT_ID}&token=${encodeURIComponent(tok.value)}&sig=${tok.signature}&allow_source=true&allow_audio_only=true&fast_bread=true`,
      embedUrl: ''
    };
  }
  return { hlsUrl: '', embedUrl: '' };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSsrPage(tab, sectionTitle, channels, watchInfo, hostHeader) {
  let cardsHtml = '';
  if (!channels || channels.length === 0) {
    cardsHtml = '<div style="padding:30px;color:#adadb8;font-size:18px;">Nenhum canal encontrado nesta aba no momento.</div>';
  } else {
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      const badgeColor = ch.platform === 'kick' ? '#53fc18;color:#000' : (ch.platform === 'partidas' ? '#00e676;color:#000' : '#eb0400;color:#fff');
      const badgeLabel = ch.platform === 'kick' ? 'KICK' : (ch.platform === 'partidas' ? 'FUTEBOL' : 'TWITCH');
      const watchHref = `/?tab=${encodeURIComponent(tab)}&watch=${encodeURIComponent(ch.login)}&plat=${encodeURIComponent(ch.platform)}&name=${encodeURIComponent(ch.displayName)}`;
      const thumbImg = ch.thumb
        ? `<img src="${escapeHtml(ch.thumb)}" style="width:100%;height:140px;display:block;object-fit:cover;background:#09090b;" alt="" />`
        : `<div style="width:100%;height:140px;background:#09090b;line-height:140px;text-align:center;color:#9146ff;font-weight:bold;font-size:22px;">${badgeLabel}</div>`;

      cardsHtml += `
        <a class="card tv-nav-card" data-card-idx="${i}" tabindex="0" href="${watchHref}">
          <div class="thumb-box">
            ${thumbImg}
            <span class="pill-plat" style="background:${badgeColor}">${badgeLabel}</span>
            <span class="pill-view">${ch.viewers > 0 ? ch.viewers + ' assistindo' : escapeHtml(ch.game)}</span>
          </div>
          <div class="card-info">
            <div class="c-name">${escapeHtml(ch.displayName)}</div>
            <div class="c-game">${escapeHtml(ch.game)}</div>
            <div class="c-title">${escapeHtml(ch.title)}</div>
          </div>
        </a>`;
    }
  }

  let playerModalHtml = '';
  if (watchInfo && watchInfo.login) {
    const mode = watchInfo.mode || 'hls';
    const baseWatchUrl = `/?tab=${encodeURIComponent(tab)}&watch=${encodeURIComponent(watchInfo.login)}&plat=${encodeURIComponent(watchInfo.platform)}&name=${encodeURIComponent(watchInfo.name)}`;
    const pureHostname = (hostHeader || 'localhost').split(':')[0];
    const ts = Date.now();

    let playerBody = '';
    if (mode === 'mp4') {
      playerBody = `
        <video id="tvVideo" src="/stream.mp4?t=${ts}" type="video/mp4" controls autoplay playsinline style="width:100%;height:86%;background:#000;"></video>
        <script>
          (function() {
            var v = document.getElementById('tvVideo');
            if (v && v.play) { try { v.play(); } catch(e) {} }
          })();
        </script>`;
    } else if (mode === 'mjpeg') {
      playerBody = `
        <div style="width:100%;height:86%;background:#000;text-align:center;position:relative;">
          <img src="/stream.mjpeg?t=${ts}" style="width:100%;height:90%;object-fit:contain;background:#000;display:block;" alt="Transmissao Ao Vivo" />
          <audio id="tvAudio" src="/stream.mp3?t=${ts}" controls autoplay style="width:80%;height:40px;margin-top:4px;"></audio>
        </div>
        <script>
          (function() {
            var a = document.getElementById('tvAudio');
            if (a && a.play) { try { a.play(); } catch(e) {} }
          })();
        </script>`;
    } else if (mode === 'embed') {
      let embedUrl = watchInfo.embedUrl || '';
      if (!embedUrl) {
        embedUrl = watchInfo.platform === 'kick'
          ? `https://player.kick.com/${encodeURIComponent(watchInfo.login)}?autoplay=true`
          : `https://player.twitch.tv/?channel=${encodeURIComponent(watchInfo.login)}&parent=${encodeURIComponent(pureHostname)}&autoplay=true`;
      }
      playerBody = `<iframe src="${escapeHtml(embedUrl)}" style="width:100%;height:86%;border:0;background:#000;" allowfullscreen allow="autoplay; fullscreen; encrypted-media"></iframe>`;
    } else {
      playerBody = `
        <video id="tvVideo" controls autoplay playsinline style="width:100%;height:86%;background:#000;"></video>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@1.4.12/dist/hls.min.js"></script>
        <script>
          (function() {
            var v = document.getElementById('tvVideo');
            var hlsUrl = "/live_hls/index.m3u8?t=${ts}";
            var mp4Url = "/stream.mp4?t=${ts}";
            var triedMp4 = false;
            if (!v) return;

            function fallbackMp4() {
              if (triedMp4) {
                window.location.href = "${baseWatchUrl}&mode=mjpeg";
                return;
              }
              triedMp4 = true;
              v.src = mp4Url;
              v.load();
              try { v.play(); } catch (e) {}
            }

            v.onerror = function() {
              fallbackMp4();
            };

            if (v.canPlayType('application/vnd.apple.mpegurl')) {
              v.src = hlsUrl;
              try { v.play(); } catch (e) {}
            } else if (window.Hls && Hls.isSupported()) {
              var hls = new Hls({ enableWorker: false, lowLatencyMode: false });
              hls.on(Hls.Events.ERROR, function(event, data) {
                if (data && data.fatal) {
                  try { hls.destroy(); } catch (e) {}
                  fallbackMp4();
                }
              });
              hls.loadSource(hlsUrl);
              hls.attachMedia(v);
              hls.on(Hls.Events.MANIFEST_PARSED, function() {
                try { v.play(); } catch (e) {}
              });
            } else {
              fallbackMp4();
            }
          })();
        </script>`;
    }

    let zapPrevHref = '';
    let zapNextHref = '';
    if (channels && channels.length > 1) {
      let cIdx = -1;
      for (let i = 0; i < channels.length; i++) {
        if (channels[i].login === watchInfo.login) {
          cIdx = i;
          break;
        }
      }
      if (cIdx === -1) cIdx = 0;
      const prevIdx = (cIdx - 1 + channels.length) % channels.length;
      const nextIdx = (cIdx + 1) % channels.length;
      const pCh = channels[prevIdx];
      const nCh = channels[nextIdx];
      zapPrevHref = `/?tab=${encodeURIComponent(tab)}&watch=${encodeURIComponent(pCh.login)}&plat=${encodeURIComponent(pCh.platform)}&name=${encodeURIComponent(pCh.displayName)}&mode=${encodeURIComponent(mode)}`;
      zapNextHref = `/?tab=${encodeURIComponent(tab)}&watch=${encodeURIComponent(nCh.login)}&plat=${encodeURIComponent(nCh.platform)}&name=${encodeURIComponent(nCh.displayName)}&mode=${encodeURIComponent(mode)}`;
    }

    const zapButtonsHtml = (zapPrevHref && zapNextHref)
      ? `<a class="top-btn tv-nav-modal" tabindex="0" href="${zapPrevHref}" id="prevChBtn" style="background:#f59e0b;color:#000;">▲ [2] Canal Ant.</a>
         <a class="top-btn tv-nav-modal" tabindex="0" href="${zapNextHref}" id="nextChBtn" style="background:#f59e0b;color:#000;">▼ [8] Próx. Canal</a>`
      : '';

    playerModalHtml = `
      <div class="player-modal" id="playerModal">
        <div class="player-bar">
          <span style="font-size:15px;font-weight:bold;color:#fff;">▶ ${escapeHtml(watchInfo.name)} <span style="font-size:12px;color:#53fc18;margin-left:6px;">(▲/▼ Troca Canal | [0] Voltar)</span></span>
          <div>
            <a class="top-btn tv-nav-modal" tabindex="0" href="/?tab=${encodeURIComponent(tab)}&stop=1" id="closeBtn" style="background:#eb0400;color:#fff;">✖ [0] Voltar</a>
            ${zapButtonsHtml}
            <a class="top-btn tv-nav-modal" tabindex="0" href="${baseWatchUrl}&mode=hls" style="background:#00e676;color:#000;">[1] HLS TV</a>
            <a class="top-btn tv-nav-modal" tabindex="0" href="${baseWatchUrl}&mode=mp4" style="background:#38bdf8;color:#000;">[2] MP4</a>
            <a class="top-btn tv-nav-modal" tabindex="0" href="${baseWatchUrl}&mode=mjpeg" style="background:#facc15;color:#000;">[3] Anti-Falha</a>
            <a class="top-btn tv-nav-modal" tabindex="0" href="${baseWatchUrl}&mode=embed" style="background:#9146ff;color:#fff;">[4] Web</a>
          </div>
        </div>
        ${playerBody}
      </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AOC Smart Hub Turbo</title>
  <style>
    *, html, body, a, button, input, div {
      cursor: none !important;
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background-color: #0e0e10;
      color: #efeff1;
      font-family: Arial, Helvetica, sans-serif;
      overflow-x: hidden;
    }
    .header {
      background-color: #18181b;
      border-bottom: 3px solid #9146ff;
      padding: 10px 20px;
      overflow: hidden;
    }
    .brand {
      float: left;
      font-size: 20px;
      font-weight: bold;
      color: #ffffff;
    }
    .logo-t {
      display: inline-block;
      background-color: #9146ff;
      color: #fff;
      padding: 2px 9px;
      border-radius: 4px;
      margin-right: 4px;
    }
    .logo-k {
      display: inline-block;
      background-color: #53fc18;
      color: #000;
      padding: 2px 9px;
      border-radius: 4px;
      margin-right: 8px;
    }
    .menu-bar {
      background-color: #141417;
      padding: 10px 16px;
      border-bottom: 1px solid #26262c;
    }
    .nav-link {
      display: inline-block;
      background-color: #26262c;
      color: #ffffff;
      text-decoration: none;
      font-size: 15px;
      font-weight: bold;
      padding: 9px 14px;
      margin: 3px;
      border-radius: 6px;
      border: 4px solid transparent;
      transition: transform 0.1s;
    }
    .nav-link.active {
      background-color: #3a3a44;
      border-color: #9146ff;
    }
    .nav-link.kick.active {
      background-color: #1e3a15;
      border-color: #53fc18;
    }
    .nav-link.fut.active {
      background-color: #0f3823;
      border-color: #00e676;
    }
    .search-box {
      padding: 10px 20px;
      background-color: #18181b;
      border-bottom: 1px solid #26262c;
    }
    .search-input {
      background-color: #0e0e10;
      color: #ffffff;
      border: 3px solid #53535f;
      padding: 8px 12px;
      font-size: 15px;
      width: 260px;
      border-radius: 4px;
    }
    .search-btn {
      background-color: #9146ff;
      color: #ffffff;
      border: 3px solid transparent;
      padding: 8px 14px;
      font-size: 15px;
      font-weight: bold;
      border-radius: 4px;
      margin-left: 4px;
    }
    .content {
      padding: 14px 20px 80px 20px;
    }
    .sec-title {
      font-size: 19px;
      font-weight: bold;
      margin-bottom: 12px;
      color: #ffffff;
    }
    .card {
      display: inline-block;
      vertical-align: top;
      width: 23%;
      min-width: 240px;
      margin: 0.8%;
      background-color: #18181b;
      border: 4px solid #26262c;
      border-radius: 10px;
      text-decoration: none;
      color: #ffffff;
      overflow: hidden;
      transition: transform 0.12s;
    }
    /* YouTube-TV High Visibility Selection Highlight */
    .tv-focused, .card:focus, .nav-link:focus, .top-btn:focus, .search-input:focus, .search-btn:focus {
      border-color: #53fc18 !important;
      background-color: #272730 !important;
      box-shadow: 0 0 22px rgba(83, 252, 24, 0.85) !important;
      transform: scale(1.04);
      outline: none !important;
      z-index: 50;
      position: relative;
    }
    .thumb-box {
      position: relative;
      width: 100%;
      height: 140px;
      background-color: #09090b;
    }
    .pill-plat {
      position: absolute;
      top: 6px;
      left: 6px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: bold;
      border-radius: 3px;
    }
    .pill-view {
      position: absolute;
      bottom: 6px;
      left: 6px;
      background-color: rgba(0,0,0,0.85);
      color: #ffffff;
      padding: 2px 7px;
      font-size: 12px;
      font-weight: bold;
      border-radius: 3px;
    }
    .card-info {
      padding: 10px;
    }
    .c-name {
      font-size: 15px;
      font-weight: bold;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .c-game {
      font-size: 13px;
      font-weight: bold;
      color: #bf94ff;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .c-title {
      font-size: 12px;
      color: #adadb8;
      margin-top: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .player-modal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: #000000;
      z-index: 9999;
    }
    .player-bar {
      height: 56px;
      line-height: 56px;
      background-color: #18181b;
      padding: 0 14px;
      border-bottom: 2px solid #9146ff;
      overflow: hidden;
    }
    .player-bar div {
      float: right;
    }
    .top-btn {
      display: inline-block;
      line-height: normal;
      padding: 7px 11px;
      margin-left: 5px;
      text-decoration: none;
      font-weight: bold;
      font-size: 13px;
      border-radius: 4px;
      border: 3px solid transparent;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <span class="logo-t">T</span><span class="logo-k">K</span> AOC SMART HUB TURBO (MODO CONTROLE / YOUTUBE TV)
    </div>
    <div style="float:right;color:#53fc18;font-size:13px;font-weight:bold;line-height:26px;">
      🎮 Setas ◀▲▼▶ + OK | Ou Teclado Numérico: [2]=Cima [8]=Baixo [4]=Esq [6]=Dir [5]=OK [0]=Voltar
    </div>
  </div>

  <div class="menu-bar">
    <a class="nav-link tv-nav-menu ${tab === 'twitch_pt' ? 'active' : ''}" tabindex="0" href="/?tab=twitch_pt">🟣 Twitch Brasil</a>
    <a class="nav-link kick tv-nav-menu ${tab === 'kick_pt' ? 'active' : ''}" tabindex="0" href="/?tab=kick_pt">🟢 Kick Brasil</a>
    <a class="nav-link fut tv-nav-menu ${tab === 'partidas' ? 'active' : ''}" tabindex="0" href="/?tab=partidas">⚽ Partidas de Hoje</a>
    <a class="nav-link tv-nav-menu ${tab === 'filmes_tv' ? 'active' : ''}" style="${tab === 'filmes_tv' ? 'border-color:#facc15;background:#3b3210;' : ''}" tabindex="0" href="/?tab=filmes_tv">🎬 Filmes & TV 24h</a>
    <a class="nav-link tv-nav-menu ${tab === 'twitch_global' ? 'active' : ''}" tabindex="0" href="/?tab=twitch_global">🌎 Twitch Global</a>
    <a class="nav-link tv-nav-menu ${tab === 'favorites' ? 'active' : ''}" tabindex="0" href="/?tab=favorites">⭐ Favoritos</a>
    <a class="nav-link tv-nav-menu" tabindex="0" href="/?tab=${encodeURIComponent(tab)}">🔄 Atualizar</a>
  </div>

  <div class="search-box">
    <form method="GET" action="/" style="display:inline;">
      <input type="hidden" name="tab" value="search" />
      <input type="text" name="q" id="searchInput" tabindex="0" class="search-input tv-nav-search" placeholder="Nome do canal (ex: gaules, coringa)..." />
      <button type="submit" name="plat" value="twitch" tabindex="0" class="search-btn tv-nav-search">Buscar Twitch</button>
      <button type="submit" name="plat" value="kick" tabindex="0" class="search-btn tv-nav-search" style="background-color:#53fc18;color:#000;">Abrir na Kick</button>
    </form>
  </div>

  <div class="content">
    <div class="sec-title">${escapeHtml(sectionTitle)} (${channels ? channels.length : 0} transmissões disponíveis)</div>
    <div id="cardsGrid">
      ${cardsHtml}
    </div>
  </div>

  ${playerModalHtml}

  <script>
    (function() {
      var modal = document.getElementById('playerModal');
      var modalBtns = Array.prototype.slice.call(document.querySelectorAll('.tv-nav-modal'));
      var menuItems = Array.prototype.slice.call(document.querySelectorAll('.tv-nav-menu'));
      var searchItems = Array.prototype.slice.call(document.querySelectorAll('.tv-nav-search'));
      var cardItems = Array.prototype.slice.call(document.querySelectorAll('.tv-nav-card'));

      // Zone: 'modal', 'menu', 'search', 'cards'
      var currentZone = modal ? 'modal' : (cardItems.length > 0 ? 'cards' : 'menu');
      var currentIdx = 0;

      if (currentZone === 'menu') {
        for (var m = 0; m < menuItems.length; m++) {
          if (menuItems[m].className.indexOf('active') !== -1) {
            currentIdx = m;
            break;
          }
        }
      }

      function getColumnsCount() {
        if (cardItems.length < 2) return 1;
        var top0 = cardItems[0].getBoundingClientRect().top;
        var cols = 0;
        for (var i = 0; i < cardItems.length; i++) {
          if (Math.abs(cardItems[i].getBoundingClientRect().top - top0) < 30) {
            cols++;
          } else {
            break;
          }
        }
        return cols > 0 ? cols : 4;
      }

      function clearAllFocus() {
        var all = document.querySelectorAll('.tv-focused');
        for (var i = 0; i < all.length; i++) {
          all[i].className = all[i].className.replace(/\\btv-focused\\b/g, '').trim();
        }
      }

      function applyFocus() {
        clearAllFocus();
        var list = currentZone === 'modal' ? modalBtns : (currentZone === 'menu' ? menuItems : (currentZone === 'search' ? searchItems : cardItems));
        if (!list || list.length === 0) return;
        if (currentIdx < 0) currentIdx = 0;
        if (currentIdx >= list.length) currentIdx = list.length - 1;
        var el = list[currentIdx];
        if (!el) return;
        if (el.className.indexOf('tv-focused') === -1) {
          el.className += ' tv-focused';
        }
        try { el.focus(); } catch (e) {}
        if (currentZone !== 'modal') {
          try {
            var rect = el.getBoundingClientRect();
            var viewH = window.innerHeight || document.documentElement.clientHeight || 720;
            if (rect.bottom > viewH - 60 || rect.top < 80) {
              window.scrollBy(0, rect.top - (viewH / 2) + (rect.height / 2));
            }
          } catch (e) {}
        }
      }

      function activateFocused() {
        var list = currentZone === 'modal' ? modalBtns : (currentZone === 'menu' ? menuItems : (currentZone === 'search' ? searchItems : cardItems));
        var el = list && list[currentIdx];
        if (!el) return;
        var href = el.getAttribute('href');
        if (href) {
          window.location.href = href;
        } else if (el.click) {
          el.click();
        }
      }

      function moveFocus(dir) {
        if (currentZone === 'modal') {
          if (dir === 'left') currentIdx = Math.max(0, currentIdx - 1);
          if (dir === 'right') currentIdx = Math.min(modalBtns.length - 1, currentIdx + 1);
          if (dir === 'up') {
            var prevEl = document.getElementById('prevChBtn');
            if (prevEl) { window.location.href = prevEl.getAttribute('href'); return; }
          }
          if (dir === 'down') {
            var nextEl = document.getElementById('nextChBtn');
            if (nextEl) { window.location.href = nextEl.getAttribute('href'); return; }
          }
          applyFocus();
          return;
        }

        if (currentZone === 'menu') {
          if (dir === 'left') currentIdx = Math.max(0, currentIdx - 1);
          else if (dir === 'right') currentIdx = Math.min(menuItems.length - 1, currentIdx + 1);
          else if (dir === 'down') {
            if (cardItems.length > 0) {
              currentZone = 'cards';
              currentIdx = 0;
            } else if (searchItems.length > 0) {
              currentZone = 'search';
              currentIdx = 0;
            }
          }
          applyFocus();
          return;
        }

        if (currentZone === 'search') {
          if (dir === 'left') currentIdx = Math.max(0, currentIdx - 1);
          else if (dir === 'right') currentIdx = Math.min(searchItems.length - 1, currentIdx + 1);
          else if (dir === 'up') {
            currentZone = 'menu';
            currentIdx = 0;
          } else if (dir === 'down' && cardItems.length > 0) {
            currentZone = 'cards';
            currentIdx = 0;
          }
          applyFocus();
          return;
        }

        if (currentZone === 'cards') {
          var cols = getColumnsCount();
          if (dir === 'left') {
            if (currentIdx > 0) currentIdx--;
          } else if (dir === 'right') {
            if (currentIdx < cardItems.length - 1) currentIdx++;
          } else if (dir === 'up') {
            if (currentIdx - cols >= 0) {
              currentIdx -= cols;
            } else {
              currentZone = 'menu';
              currentIdx = 0;
            }
          } else if (dir === 'down') {
            if (currentIdx + cols < cardItems.length) {
              currentIdx += cols;
            } else {
              currentIdx = cardItems.length - 1;
            }
          }
          applyFocus();
        }
      }

      document.addEventListener('keydown', function(e) {
        var activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        var isTyping = (activeTag === 'input' && document.activeElement.type === 'text');
        var k = e.keyCode || e.which;

        // Back / Return / Escape / Digit 0 closes modal
        if (k === 27 || k === 461 || k === 10009 || (!isTyping && (k === 8 || k === 48 || k === 96))) {
          if (modal) {
            e.preventDefault();
            var closeEl = document.getElementById('closeBtn');
            if (closeEl) window.location.href = closeEl.getAttribute('href');
            return;
          }
        }

        if (isTyping) {
          if (k === 40) { // Down arrow exits search input to cards
            e.preventDefault();
            document.activeElement.blur();
            currentZone = cardItems.length > 0 ? 'cards' : 'menu';
            currentIdx = 0;
            applyFocus();
          }
          return;
        }

        // Standard D-Pad Arrow Keys (37=Left, 38=Up, 39=Right, 40=Down) + Number D-Pad (4=Left, 2=Up, 6=Right, 8=Down)
        if (k === 37 || k === 52 || k === 100) {
          e.preventDefault();
          moveFocus('left');
        } else if (k === 39 || k === 54 || k === 102) {
          e.preventDefault();
          moveFocus('right');
        } else if (k === 38 || k === 50 || k === 98) {
          e.preventDefault();
          moveFocus('up');
        } else if (k === 40 || k === 56 || k === 104) {
          e.preventDefault();
          moveFocus('down');
        } else if (k === 13 || k === 53 || k === 101) { // Enter / OK / Digit 5
          e.preventDefault();
          activateFocused();
        } else if (modal && (k === 49 || k === 97)) { // In Modal: [1] HLS
          if (modalBtns[1]) window.location.href = modalBtns[1].getAttribute('href');
        } else if (modal && (k === 51 || k === 99)) { // In Modal: [3] Anti-Falha
          if (modalBtns[3]) window.location.href = modalBtns[3].getAttribute('href');
        } else if (k === 403) { // Red button -> Twitch
          window.location.href = '/?tab=twitch_pt';
        } else if (k === 404) { // Green button -> Kick
          window.location.href = '/?tab=kick_pt';
        } else if (k === 405) { // Yellow button -> Partidas de Hoje
          window.location.href = '/?tab=partidas';
        } else if (k === 406) { // Blue button -> Refresh
          window.location.reload();
        }
      }, true);

      setTimeout(applyFocus, 100);
    })();
  </script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  console.log(`[REQ ${new Date().toISOString().slice(11,19)}] ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'timer-management-immediate-kodak.trycloudflare.com';

  if (handleXtreamApi(req, res, urlObj, host)) {
    return;
  }

  if (handlePanelRoutes(req, res, urlObj)) {
    return;
  }

  if (pathname.startsWith('/hls/')) {
    return handleHlsRequest(req, res, pathname);
  }

  if (pathname.startsWith('/live_hls/')) {
    const fileName = path.basename(pathname);
    const filePath = path.join(HLS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const stat = fs.statSync(filePath);
    const isM3u8 = fileName.endsWith('.m3u8');
    res.writeHead(200, {
      'Content-Type': isM3u8 ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  if (handlePcGamerRoutes(req, res, pathname, ffmpegPath)) {
    return;
  }

  if (pathname === '/playlist.m3u' || pathname === '/lista.m3u' || pathname === '/get.php') {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'timer-management-immediate-kodak.trycloudflare.com';
    const m3u = buildM3u(host);
    res.writeHead(200, {
      'Content-Type': 'application/x-mpegurl; charset=utf-8',
      'Content-Disposition': 'inline; filename="lista.m3u"',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(m3u);
  }

  if (pathname.startsWith('/live/')) {
    const parts = pathname.replace('/live/', '').split('/');
    const lastPart = parts[parts.length - 1].replace(/\.(m3u8|ts)$/i, '');
    let slug = lastPart;
    const streamObj = findStreamById(lastPart);
    if (streamObj) {
      if (streamObj.direct_url) {
        res.writeHead(302, { 'Location': streamObj.direct_url, 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }
      if (streamObj.slug) slug = streamObj.slug;
    }

    try {
      const page = await fetchUrl('https://ww0.embedtv.cc/' + slug, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://skyflowmino.space/'
        }
      });
      const m = page.body.match(/const\s+src\s*=\s*"([^"]+)"/);
      if (m && m[1]) {
        const m3u8Res = await fetchUrl(m[1], {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://ww0.embedtv.cc/'
          }
        });
        if (m3u8Res.status === 200 && m3u8Res.body.includes('#EXTM3U')) {
          const proto = req.headers['x-forwarded-proto'] || 'https';
          const rewritten = m3u8Res.body.replace(/(https?:\/\/[^\s#]+)/g, (match) => {
            return `${proto}://${host}/proxy-ts?url=${encodeURIComponent(match)}`;
          });
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache, no-store'
          });
          return res.end(rewritten);
        }
      }
    } catch (e) {
      console.error('Error proxying channel:', slug, e.message);
    }
    res.writeHead(404);
    return res.end('Channel not found');
  }

  if (pathname === '/proxy-ts') {
    const targetUrl = urlObj.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400);
      return res.end('Missing url');
    }
    try {
      const mod = targetUrl.startsWith('https') ? https : http;
      const proxyReq = mod.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://ww0.embedtv.cc/'
        },
        timeout: 10000
      }, proxyRes => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          const next = proxyRes.headers.location.startsWith('http')
            ? proxyRes.headers.location
            : new URL(proxyRes.headers.location, targetUrl).toString();
          res.writeHead(302, { 'Location': `/proxy-ts?url=${encodeURIComponent(next)}` });
          return res.end();
        }
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=30'
        });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', err => {
        if (!res.headersSent) res.writeHead(502);
        res.end('Proxy error: ' + err.message);
      });
      return;
    } catch (e) {
      res.writeHead(500);
      return res.end(e.message);
    }
  }

  if (pathname === '/stream.mp4') {
    if (!currentStreamSource) {
      res.writeHead(404);
      return res.end('No active stream');
    }
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive'
    });
    const proc = spawn(ffmpegPath, [
      '-headers', getFfmpegHeadersForUrl(currentStreamSource),
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-i', currentStreamSource,
      '-vf', 'scale=1280:720',
      '-r', '30',
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', '1800k',
      '-pix_fmt', 'yuv420p',
      '-g', '30',
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    proc.stdout.pipe(res);
    req.on('close', () => {
      try { proc.kill('SIGKILL'); } catch (e) {}
    });
    return;
  }

  if (pathname === '/stream.mjpeg') {
    if (!currentStreamSource) {
      res.writeHead(404);
      return res.end('No active stream');
    }
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive'
    });
    const proc = spawn(ffmpegPath, [
      '-headers', getFfmpegHeadersForUrl(currentStreamSource),
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-i', currentStreamSource,
      '-vf', 'scale=960:540',
      '-r', '15',
      '-q:v', '5',
      '-an',
      '-f', 'mpjpeg',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    proc.stdout.pipe(res);
    req.on('close', () => {
      try { proc.kill('SIGKILL'); } catch (e) {}
    });
    return;
  }

  if (pathname === '/stream.mp3') {
    if (!currentStreamSource) {
      res.writeHead(404);
      return res.end('No active stream');
    }
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive'
    });
    const proc = spawn(ffmpegPath, [
      '-headers', getFfmpegHeadersForUrl(currentStreamSource),
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-i', currentStreamSource,
      '-vn',
      '-c:a', 'libmp3lame',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      '-f', 'mp3',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    proc.stdout.pipe(res);
    req.on('close', () => {
      try { proc.kill('SIGKILL'); } catch (e) {}
    });
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    const tab = urlObj.searchParams.get('tab') || 'twitch_pt';
    const watchLogin = urlObj.searchParams.get('watch');
    const watchPlat = urlObj.searchParams.get('plat') || 'twitch';
    const watchName = urlObj.searchParams.get('name') || watchLogin || '';
    const watchMode = urlObj.searchParams.get('mode') || 'hls';
    const q = urlObj.searchParams.get('q') || '';
    const stopFlag = urlObj.searchParams.get('stop');

    if (stopFlag) {
      stopActiveFfmpeg();
      currentStreamSource = '';
    }

    let channels = [];
    let sectionTitle = 'TWITCH: TOP BRASIL (AO VIVO)';

    try {
      if (tab === 'kick_pt') {
        sectionTitle = 'KICK: TOP BRASIL (AO VIVO)';
        channels = await getKickStreams();
      } else if (tab === 'partidas') {
        sectionTitle = 'PARTIDAS DE HOJE & CANAIS DE FUTEBOL AO VIVO';
        channels = await getPartidasStreams();
      } else if (tab === 'filmes_tv') {
        sectionTitle = 'FILMES, SÉRIES, DESENHOS & TV FECHADA 24H (AO VIVO)';
        channels = getFilmesTvStreams();
      } else if (tab === 'twitch_global') {
        sectionTitle = 'TWITCH: TOP GLOBAL (AO VIVO)';
        channels = await getTwitchStreams('');
      } else if (tab === 'favorites') {
        sectionTitle = 'MEUS FAVORITOS (TWITCH & KICK)';
        channels = [
          { platform: 'twitch', login: 'gaules', displayName: 'Gaules', game: 'Twitch', title: 'Clique em OK para assistir ao vivo', viewers: 0, thumb: '' },
          { platform: 'twitch', login: 'alanzoka', displayName: 'alanzoka', game: 'Twitch', title: 'Clique em OK para assistir ao vivo', viewers: 0, thumb: '' },
          { platform: 'twitch', login: 'loud_coringa', displayName: 'loud_coringa', game: 'Twitch', title: 'Clique em OK para assistir ao vivo', viewers: 0, thumb: '' },
          { platform: 'kick', login: 'coringa', displayName: 'coringa (Kick)', game: 'Kick', title: 'Clique em OK para assistir ao vivo', viewers: 0, thumb: '' },
          { platform: 'kick', login: 'cerol', displayName: 'cerol (Kick)', game: 'Kick', title: 'Clique em OK para assistir ao vivo', viewers: 0, thumb: '' },
          { platform: 'kick', login: 'paulinholokobr', displayName: 'paulinholokobr (Kick)', game: 'Kick', title: 'Clique em OK para assistir ao vivo', viewers: 0, thumb: '' }
        ];
      } else if (tab === 'search' && q) {
        if (watchPlat === 'kick') {
          const slug = q.toLowerCase().trim().replace(/\s+/g, '-');
          const resolved = await resolveStreamHls('kick', slug).catch(() => ({ hlsUrl: '', embedUrl: '' }));
          if (resolved.hlsUrl) {
            currentStreamSource = resolved.hlsUrl;
            if (watchMode === 'hls') await startHlsTranscode(resolved.hlsUrl);
          }
          const html = renderSsrPage('kick_pt', 'KICK: ' + slug.toUpperCase(), [], {
            login: slug,
            platform: 'kick',
            name: slug,
            hlsUrl: resolved.hlsUrl,
            embedUrl: resolved.embedUrl,
            mode: watchMode
          }, req.headers.host);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(html);
        } else {
          sectionTitle = 'BUSCA NA TWITCH: ' + q.toUpperCase();
          channels = await searchTwitch(q);
        }
      } else {
        channels = await getTwitchStreams('PT');
      }
    } catch (e) {
      console.error('SSR Fetch error:', e.message);
    }

    let watchInfo = null;
    if (watchLogin) {
      let resolved = { hlsUrl: '', embedUrl: '' };
      try {
        resolved = await resolveStreamHls(watchPlat, watchLogin);
      } catch (e) {}
      if (resolved.hlsUrl) {
        currentStreamSource = resolved.hlsUrl;
        if (watchMode === 'hls') {
          await startHlsTranscode(resolved.hlsUrl);
        } else {
          stopActiveFfmpeg();
        }
      }
      watchInfo = {
        login: watchLogin,
        platform: watchPlat,
        name: watchName,
        hlsUrl: resolved.hlsUrl,
        embedUrl: resolved.embedUrl,
        mode: watchMode
      };
    }

    const html = renderSsrPage(tab, sectionTitle, channels, watchInfo, req.headers.host);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  ensureStandbyHls(ffmpegPath);
  console.log(`AOC Smart Hub SSR Server running on http://0.0.0.0:${PORT}`);
});
