const { spawn, execSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

let ffmpegPath = 'ffmpeg';
try {
  const sys = execSync('which ffmpeg 2>/dev/null || where ffmpeg 2>nul').toString().trim().split(/\r?\n/)[0];
  if (sys && fs.existsSync(sys)) {
    ffmpegPath = sys;
  } else {
    ffmpegPath = require('ffmpeg-static');
    try { fs.chmodSync(ffmpegPath, 0o755); } catch (_) {}
  }
} catch (_) {
  try {
    ffmpegPath = require('ffmpeg-static');
    try { fs.chmodSync(ffmpegPath, 0o755); } catch (_) {}
  } catch (_) {
    ffmpegPath = 'ffmpeg';
  }
}

const CACHE_BASE = path.join(__dirname, 'hls_cache');
if (!fs.existsSync(CACHE_BASE)) fs.mkdirSync(CACHE_BASE, { recursive: true });

const activeStreams = new Map();

function fetchHtml(url, referer) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Referer': referer || 'https://skyflowmino.space/'
      },
      timeout: 8000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

function getRefererForUrl(url) {
  if (!url) return 'Referer: https://skyflowmino.space/\r\n';
  if (url.includes('domhsd.com') || url.includes('streamtp')) {
    return 'Referer: https://streamtp99a.sbs/\r\n';
  }
  return 'Referer: https://ww0.embedtv.cc/\r\n';
}

async function resolveStreamtp(channel) {
  let streamName = channel.toLowerCase();
  if (streamName === 'premiere' || streamName === 'premiereclubes' || streamName === 'premiere_clubes') {
    streamName = 'premiere1';
  }
  try {
    const res = await fetchHtml(`https://streamtp99a.sbs/global1.php?stream=${streamName}`, 'https://skyflowmino.space/');
    const m = res.body.match(/playbackURL\s*=\s*"([^"]+)"/);
    if (m && m[1]) {
      return m[1].replace(/\\\//g, '/');
    }
  } catch (e) {}
  return null;
}

async function resolveEmbedSrc(channel) {
  let ch = channel.toLowerCase();

  // 1. Prioritize streamtp for sports/premiere (most reliable CDN with zero geoblock on cloud)
  if (['premiere', 'premiere1', 'premiere2', 'premiere3', 'premiereclubes', 'sportv', 'sportv1', 'sportv2', 'sportv3', 'espn', 'espn2', 'espn3', 'espn4', 'espn5', 'espn6'].includes(ch)) {
    const stp = await resolveStreamtp(ch);
    if (stp) {
      console.log(`[HLS-REMUX] Streamtp resolved for ${ch}:`, stp);
      return stp;
    }
  }

  // 2. Globo regional feed
  if (['globorn', 'globo-rn', 'intertv', 'cabugi', 'intertvcabugi', 'globonatal'].includes(ch)) {
    try {
      const resTest = await fetchHtml(`https://ww0.embedtv.cc/${ch}`, 'https://skyflowmino.space/');
      const mTest = resTest.body.match(/const\s+src\s*=\s*["']([^"']+)["']/);
      if (mTest && mTest[1]) {
        const headTest = await fetchHtml(mTest[1], 'https://ww0.embedtv.cc/');
        if (headTest.body.includes('#EXTM3U')) {
          console.log(`[HLS-REMUX] Direct ${ch} feed active!`);
          return mTest[1];
        }
      }
    } catch (_) {}
    console.log(`[HLS-REMUX] ${ch} routed to Rede Globo feed (globorj)...`);
    ch = 'globorj';
  }

  // 3. Fallback to embedtv
  const res = await fetchHtml(`https://ww0.embedtv.cc/${ch}`, 'https://skyflowmino.space/');
  if (res.status === 200) {
    const m = res.body.match(/const\s+src\s*=\s*["']([^"']+)["']/);
    if (m && m[1] && !m[1].includes('error.txt')) return m[1];
  }

  // 4. Fallback retry streamtp
  const retryStp = await resolveStreamtp(ch);
  if (retryStp) return retryStp;

  throw new Error(`Could not resolve active stream source for ${ch}`);
}

async function getOrStartStream(channel, overrideSrc = null) {
  let stream = activeStreams.get(channel);
  if (stream && stream.alive) {
    stream.lastAccess = Date.now();
    return stream;
  }

  const channelDir = path.join(CACHE_BASE, channel);
  if (fs.existsSync(channelDir)) {
    try { fs.rmSync(channelDir, { recursive: true, force: true }); } catch (_) {}
  }
  fs.mkdirSync(channelDir, { recursive: true });

  const srcUrl = overrideSrc || await resolveEmbedSrc(channel);
  console.log(`[HLS-REMUX] Starting stream for ${channel} from ${srcUrl} using ffmpeg: ${ffmpegPath}`);

  const playlistFile = path.join(channelDir, 'live.m3u8');
  let lastStderr = '';

  const ff = spawn(ffmpegPath, [
    '-headers', getRefererForUrl(srcUrl),
    '-i', srcUrl,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-ar', '48000',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments',
    playlistFile
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  stream = {
    channel,
    dir: channelDir,
    process: ff,
    alive: true,
    lastAccess: Date.now(),
    getStderr: () => lastStderr
  };

  ff.on('error', (err) => {
    console.error(`[HLS-REMUX] Failed to spawn ffmpeg:`, err);
    lastStderr += '\nSpawn err: ' + err.message;
  });

  ff.on('exit', (code) => {
    console.log(`[HLS-REMUX] Stream ${channel} exited with code ${code}`);
    stream.alive = false;
    activeStreams.delete(channel);
  });

  ff.stderr.on('data', d => {
    lastStderr = (lastStderr + d.toString()).slice(-2000);
  });

  activeStreams.set(channel, stream);

  // Wait until live.m3u8 is written and has at least one segment
  const startTime = Date.now();
  while (Date.now() - startTime < 10000) {
    if (fs.existsSync(playlistFile)) {
      const content = fs.readFileSync(playlistFile, 'utf8');
      if (content.includes('.ts')) {
        console.log(`[HLS-REMUX] ${channel} ready in ${Date.now() - startTime}ms`);
        return stream;
      }
    }
    if (!stream.alive) {
      throw new Error(`FFmpeg exited prematurely for ${channel}. Stderr: ${lastStderr}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  throw new Error(`Timeout waiting for ${channel} stream initialization. Stderr: ${lastStderr}`);
}

// Cleanup inactive streams every 15s
setInterval(() => {
  const now = Date.now();
  for (const [channel, stream] of activeStreams.entries()) {
    if (now - stream.lastAccess > 35000) {
      console.log(`[HLS-REMUX] Stopping inactive stream for ${channel}`);
      try { stream.process.kill(); } catch (_) {}
      stream.alive = false;
      activeStreams.delete(channel);
      try { fs.rmSync(stream.dir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}, 15000);

async function handleHlsRequest(req, res, pathname) {
  const parts = pathname.replace(/^\/hls\//, '').split('/');
  if (parts.length === 0) return false;

  let channel = parts[0].replace(/\.m3u8$/, '');
  const file = parts.length > 1 ? parts[1].split('?')[0] : 'live.m3u8';
  const urlObj = new URL(req.url, 'http://localhost');
  const overrideSrc = urlObj.searchParams.get('src');

  try {
    const stream = await getOrStartStream(channel, overrideSrc);
    stream.lastAccess = Date.now();

    const filePath = path.join(stream.dir, file);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      return res.end('File not found yet');
    }

    if (file.endsWith('.m3u8')) {
      const content = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store'
      });
      return res.end(content);
    } else if (file.endsWith('.ts')) {
      res.writeHead(200, {
        'Content-Type': 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=10'
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  } catch (e) {
    console.error(`[HLS-REMUX] Error for ${pathname}:`, e.message);
    res.writeHead(500, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(e.message);
  }

  return false;
}

module.exports = { handleHlsRequest, getOrStartStream };
