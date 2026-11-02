const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('./node_modules/ffmpeg-static');

const CACHE_BASE = path.join(__dirname, 'hls_cache');
if (!fs.existsSync(CACHE_BASE)) fs.mkdirSync(CACHE_BASE, { recursive: true });

const activeStreams = new Map();

function fetchHtml(url, referer) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': referer || 'https://skyflowmino.space/'
      },
      timeout: 6000
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function resolveEmbedSrc(channel) {
  const html = await fetchHtml(`https://ww0.embedtv.cc/${channel}`, 'https://skyflowmino.space/');
  const m = html.match(/const\s+src\s*=\s*"([^"]+)"/);
  if (!m || !m[1]) throw new Error(`Could not find src for channel ${channel}`);
  return m[1];
}

async function getOrStartStream(channel) {
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

  const srcUrl = await resolveEmbedSrc(channel);
  console.log(`[HLS-REMUX] Starting stream for ${channel} from ${srcUrl}`);

  const playlistFile = path.join(channelDir, 'live.m3u8');
  const ff = spawn(ffmpegPath, [
    '-headers', 'Referer: https://ww0.embedtv.cc/\r\n',
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
    lastAccess: Date.now()
  };

  ff.on('exit', (code) => {
    console.log(`[HLS-REMUX] Stream ${channel} exited with code ${code}`);
    stream.alive = false;
    activeStreams.delete(channel);
  });

  ff.stderr.on('data', d => {
    // console.log(`[FFMPEG ${channel}]`, d.toString().slice(0, 100));
  });

  activeStreams.set(channel, stream);

  // Wait until live.m3u8 is written and has at least one segment
  const startTime = Date.now();
  while (Date.now() - startTime < 6000) {
    if (fs.existsSync(playlistFile)) {
      const content = fs.readFileSync(playlistFile, 'utf8');
      if (content.includes('.ts')) {
        console.log(`[HLS-REMUX] ${channel} ready in ${Date.now() - startTime}ms`);
        return stream;
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  throw new Error(`Timeout waiting for ${channel} stream initialization`);
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
  // /hls/:channel/live.m3u8 or /hls/:channel.m3u8
  // /hls/:channel/liveX.ts
  const parts = pathname.replace(/^\/hls\//, '').split('/');
  if (parts.length === 0) return false;

  let channel = parts[0].replace(/\.m3u8$/, '');
  const file = parts.length > 1 ? parts[1] : 'live.m3u8';

  try {
    const stream = await getOrStartStream(channel);
    stream.lastAccess = Date.now();

    const filePath = path.join(stream.dir, file);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      return res.end('File not found yet');
    }

    if (file.endsWith('.m3u8')) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Rewrite segments relative to /hls/:channel/
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
    res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
    return res.end(e.message);
  }

  return false;
}

module.exports = { handleHlsRequest, getOrStartStream };
