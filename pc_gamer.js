const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PC_HLS_DIR = path.join(__dirname, 'pc_hls');
if (!fs.existsSync(PC_HLS_DIR)) {
  fs.mkdirSync(PC_HLS_DIR, { recursive: true });
}

let standbyProc = null;
let webCaptureProc = null;
let lastWebChunkTime = 0;
let inputQueue = [];

function isExternalCaptureActive() {
  if (webCaptureProc && (Date.now() - lastWebChunkTime < 8000)) {
    return true;
  }
  const flagFile = path.join(PC_HLS_DIR, 'desktop_capture.lock');
  if (fs.existsSync(flagFile)) {
    try {
      const st = fs.statSync(flagFile);
      if (Date.now() - st.mtimeMs < 10000) return true;
    } catch (e) {}
  }
  return false;
}

function stopStandbyProc() {
  if (standbyProc) {
    try { standbyProc.kill('SIGKILL'); } catch (e) {}
    standbyProc = null;
  }
}

function ensureStandbyHls(ffmpegPath) {
  if (isExternalCaptureActive()) {
    stopStandbyProc();
    return;
  }
  if (standbyProc) return;

  const m3u8Path = path.join(PC_HLS_DIR, 'stream.m3u8');
  standbyProc = spawn(ffmpegPath, [
    '-hide_banner',
    '-re',
    '-f', 'lavfi',
    '-i', 'testsrc=size=1280x720:rate=30',
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-g', '30',
    '-b:v', '1800k',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+omit_endlist',
    m3u8Path
  ], { stdio: 'ignore' });

  standbyProc.on('exit', () => {
    standbyProc = null;
  });
}

function startWebCaptureFfmpeg(ffmpegPath) {
  stopStandbyProc();
  if (webCaptureProc) {
    try { webCaptureProc.kill('SIGKILL'); } catch (e) {}
    webCaptureProc = null;
  }
  const m3u8Path = path.join(PC_HLS_DIR, 'stream.m3u8');
  webCaptureProc = spawn(ffmpegPath, [
    '-hide_banner',
    '-probesize', '32768',
    '-analyzeduration', '0',
    '-fflags', '+genpts+nobuffer+flush_packets',
    '-flags', 'low_delay',
    '-i', 'pipe:0',
    '-vf', 'scale=1280:720',
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-g', '15',
    '-keyint_min', '15',
    '-sc_threshold', '0',
    '-b:v', '2200k',
    '-maxrate', '2500k',
    '-bufsize', '1200k',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+omit_endlist+split_by_time',
    m3u8Path
  ], { stdio: ['pipe', 'ignore', 'ignore'] });

  webCaptureProc.on('exit', () => {
    webCaptureProc = null;
  });
  lastWebChunkTime = Date.now();
}

function renderPcTransmitterPage(hostHeader) {
  const controlUrl = `https://timer-management-immediate-kodak.trycloudflare.com/controle`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>PC Gamer na TV - Transmissor Ao Vivo</title>
  <style>
    body { margin:0; background:#09090b; color:#efeff1; font-family:'Segoe UI',system-ui,sans-serif; padding:30px; text-align:center; }
    .box { max-width:780px; margin:0 auto; background:#18181b; border:2px solid #38bdf8; border-radius:16px; padding:30px; box-shadow:0 15px 40px rgba(0,0,0,0.6); }
    h1 { color:#38bdf8; margin-top:0; font-size:28px; }
    .btn-main { background:#00e676; color:#000; border:none; padding:18px 36px; font-size:20px; font-weight:800; border-radius:12px; cursor:pointer; margin:15px 8px; transition:0.15s; }
    .btn-main:hover { transform:scale(1.03); background:#22c55e; }
    .btn-stop { background:#eb0400; color:#fff; border:none; padding:18px 28px; font-size:18px; font-weight:700; border-radius:12px; cursor:pointer; margin:15px 8px; }
    .status { font-size:18px; margin:15px 0; padding:12px; border-radius:8px; background:#0e0e10; color:#facc15; font-weight:bold; }
    video { width:100%; max-width:640px; border-radius:10px; background:#000; margin-top:15px; border:1px solid #27272a; }
    .card-info { text-align:left; background:#141417; padding:18px; border-radius:10px; margin-top:20px; border-left:4px solid #9146ff; line-height:1.6; }
    code { background:#27272a; padding:3px 8px; border-radius:5px; color:#38bdf8; font-weight:bold; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🖥️ PC Gamer na TV (Transmissor Ao Vivo + Áudio)</h1>
    <p style="color:#adadb8;font-size:16px;">Transmita qualquer Jogo, Emulador ou a Área de Trabalho inteira do seu PC direto para as TVs do Quarto e da Sala!</p>
    <div id="statusBox" class="status">⚪ Pronto para transmitir — Clique no botão verde abaixo e selecione "Tela Cheia" + "Compartilhar Áudio do Sistema"</div>
    <div>
      <button class="btn-main" onclick="startCapture()">🚀 INICIAR TRANSMISSÃO DA TELA + SOM</button>
      <button class="btn-stop" onclick="stopCapture()">⏹️ PARAR</button>
    </div>
    <video id="preview" autoplay muted playsinline></video>
    <div class="card-info">
      <div><strong>📱 Controle Gamer & Mouse no Celular (Sem Fio):</strong></div>
      <div>Abra no navegador do seu celular: <code>${controlUrl}</code></div>
      <div style="margin-top:8px;"><strong>📺 Como assistir nas TVs dos Quartos (Roku):</strong></div>
      <div>Abra o app <strong>Twitch AOC Turbo</strong> na TV &rarr; Menu esquerdo: <strong>PC Gamer na TV (Tela do PC)</strong> &rarr; Clique em <strong>[PC GAMER] Tela do Meu PC Ao Vivo</strong>!</div>
    </div>
  </div>
  <script>
    let mediaStream = null;
    let recorder = null;
    const statusBox = document.getElementById('statusBox');
    const preview = document.getElementById('preview');

    async function startCapture() {
      try {
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: true
        });
        preview.srcObject = mediaStream;
        await fetch('/pc/start-web', { method: 'POST' });

        const mime = MediaRecorder.isTypeSupported('video/webm;codecs=h264,opus')
          ? 'video/webm;codecs=h264,opus'
          : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm');

        recorder = new MediaRecorder(mediaStream, { mimeType: mime, videoBitsPerSecond: 2200000 });
        recorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0) {
            try {
              await fetch('/pc/chunk', { method: 'POST', body: e.data });
            } catch (err) {}
          }
        };
        recorder.start(100);
        statusBox.style.color = '#00e676';
        statusBox.textContent = '🟢 TRANSMITINDO AO VIVO PARA AS TVs! (Pode abrir seu jogo e ir para a cama)';
        mediaStream.getVideoTracks()[0].onended = () => stopCapture();
      } catch (err) {
        statusBox.style.color = '#eb0400';
        statusBox.textContent = '❌ Erro ao iniciar captura: ' + err.message;
      }
    }

    async function stopCapture() {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
      preview.srcObject = null;
      await fetch('/pc/stop-web', { method: 'POST' });
      statusBox.style.color = '#facc15';
      statusBox.textContent = '⚪ Transmissão encerrada.';
    }
  </script>
</body>
</html>`;
}

function renderMobileControllerPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Controle PC Gamer & Mouse</title>
  <style>
    * { box-sizing:border-box; user-select:none; -webkit-user-select:none; touch-action:manipulation; }
    body { margin:0; background:#09090b; color:#fff; font-family:system-ui,sans-serif; overflow:hidden; height:100vh; display:flex; flex-direction:column; }
    .top-bar { display:flex; background:#18181b; border-bottom:2px solid #38bdf8; padding:8px; gap:8px; justify-content:center; }
    .tab-btn { flex:1; padding:10px; border:none; border-radius:8px; background:#27272a; color:#fff; font-weight:bold; font-size:15px; }
    .tab-btn.active { background:#38bdf8; color:#000; }
    .panel { flex:1; display:none; padding:12px; flex-direction:column; justify-content:space-between; }
    .panel.active { display:flex; }
    /* Gamepad Layout */
    .shoulder-row { display:flex; justify-content:space-between; gap:12px; }
    .btn-sh { flex:1; padding:14px; background:#27272a; border:2px solid #52525b; border-radius:10px; color:#fff; font-weight:bold; font-size:16px; }
    .btn-sh:active { background:#38bdf8; color:#000; }
    .mid-row { display:flex; justify-content:space-between; align-items:center; flex:1; margin:10px 0; }
    .dpad { display:grid; grid-template-columns:repeat(3, 64px); grid-template-rows:repeat(3, 64px); gap:6px; }
    .d-btn { background:#1f1f23; border:2px solid #38bdf8; border-radius:12px; color:#fff; font-size:22px; font-weight:bold; display:flex; align-items:center; justify-content:center; }
    .d-btn:active { background:#38bdf8; color:#000; }
    .abxy { display:grid; grid-template-columns:repeat(3, 64px); grid-template-rows:repeat(3, 64px); gap:6px; }
    .act-btn { border-radius:50%; border:none; font-size:20px; font-weight:900; color:#000; display:flex; align-items:center; justify-content:center; }
    .act-btn:active { transform:scale(0.92); filter:brightness(1.3); }
    .bottom-row { display:flex; justify-content:center; gap:15px; }
    .meta-btn { padding:10px 22px; background:#27272a; border:1px solid #71717a; border-radius:20px; color:#fff; font-weight:bold; }
    /* Touchpad Layout */
    .touchpad { flex:1; background:#141417; border:2px dashed #38bdf8; border-radius:16px; display:flex; align-items:center; justify-content:center; color:#71717a; font-size:18px; font-weight:bold; text-align:center; padding:20px; margin-bottom:10px; touch-action:none; }
    .mouse-btns { display:flex; gap:8px; margin-bottom:10px; }
    .m-btn { flex:1; padding:16px 8px; background:#27272a; border:2px solid #38bdf8; border-radius:10px; color:#fff; font-weight:bold; font-size:15px; }
    .m-btn:active { background:#38bdf8; color:#000; }
    .kb-row { display:flex; gap:6px; }
    .kb-input { flex:1; padding:12px; border-radius:8px; border:1px solid #52525b; background:#18181b; color:#fff; font-size:16px; }
  </style>
</head>
<body>
  <div class="top-bar">
    <button id="tGame" class="tab-btn active" onclick="showTab('game')">🎮 Controle Gamer</button>
    <button id="tMouse" class="tab-btn" onclick="showTab('mouse')">🖱️ Mouse & Teclado</button>
  </div>

  <!-- GAMEPAD PANEL -->
  <div id="pGame" class="panel active">
    <div class="shoulder-row">
      <button class="btn-sh" ontouchstart="sendCmd({type:'click',btn:'left'})" onclick="sendCmd({type:'click',btn:'left'})">L1 (Clique Esq)</button>
      <button class="btn-sh" ontouchstart="sendCmd({type:'key',key:'ESCAPE'})" onclick="sendCmd({type:'key',key:'ESCAPE'})">ESC / Pausa</button>
      <button class="btn-sh" ontouchstart="sendCmd({type:'click',btn:'right'})" onclick="sendCmd({type:'click',btn:'right'})">R1 (Clique Dir)</button>
    </div>

    <div class="mid-row">
      <div class="dpad">
        <div></div>
        <button class="d-btn" ontouchstart="sendCmd({type:'key',key:'w'})" onclick="sendCmd({type:'key',key:'w'})">▲<br><small style="font-size:10px">W</small></button>
        <div></div>
        <button class="d-btn" ontouchstart="sendCmd({type:'key',key:'a'})" onclick="sendCmd({type:'key',key:'a'})">◄<br><small style="font-size:10px">A</small></button>
        <button class="d-btn" ontouchstart="sendCmd({type:'key',key:'s'})" onclick="sendCmd({type:'key',key:'s'})">●</button>
        <button class="d-btn" ontouchstart="sendCmd({type:'key',key:'d'})" onclick="sendCmd({type:'key',key:'d'})">►<br><small style="font-size:10px">D</small></button>
        <div></div>
        <button class="d-btn" ontouchstart="sendCmd({type:'key',key:'s'})" onclick="sendCmd({type:'key',key:'s'})">▼<br><small style="font-size:10px">S</small></button>
        <div></div>
      </div>

      <div class="abxy">
        <div></div>
        <button class="act-btn" style="background:#facc15" ontouchstart="sendCmd({type:'key',key:'e'})" onclick="sendCmd({type:'key',key:'e'})">Y<small style="font-size:11px">(E)</small></button>
        <div></div>
        <button class="act-btn" style="background:#38bdf8" ontouchstart="sendCmd({type:'key',key:'f'})" onclick="sendCmd({type:'key',key:'f'})">X<small style="font-size:11px">(F)</small></button>
        <div></div>
        <button class="act-btn" style="background:#eb0400;color:#fff" ontouchstart="sendCmd({type:'key',key:'BACKSPACE'})" onclick="sendCmd({type:'key',key:'BACKSPACE'})">B</button>
        <div></div>
        <button class="act-btn" style="background:#00e676" ontouchstart="sendCmd({type:'key',key:'SPACE'})" onclick="sendCmd({type:'key',key:'SPACE'})">A<small style="font-size:11px">(Pulo)</small></button>
        <div></div>
      </div>
    </div>

    <div class="bottom-row">
      <button class="meta-btn" onclick="sendCmd({type:'key',key:'TAB'})">SELECT (TAB)</button>
      <button class="meta-btn" onclick="sendCmd({type:'key',key:'ENTER'})">START (ENTER)</button>
      <button class="meta-btn" onclick="sendCmd({type:'key',key:'UP'})">▲</button>
      <button class="meta-btn" onclick="sendCmd({type:'key',key:'DOWN'})">▼</button>
      <button class="meta-btn" onclick="sendCmd({type:'key',key:'LEFT'})">◄</button>
      <button class="meta-btn" onclick="sendCmd({type:'key',key:'RIGHT'})">►</button>
    </div>
  </div>

  <!-- TOUCHPAD & KEYBOARD PANEL -->
  <div id="pMouse" class="panel">
    <div id="pad" class="touchpad">
      🖐️ DESLIZE O DEDO AQUI PARA MOVER O MOUSE DO PC<br><br>(Toque rápido = Clique Esquerdo)
    </div>
    <div class="mouse-btns">
      <button class="m-btn" onclick="sendCmd({type:'click',btn:'left'})">🖱️ Clique Esq</button>
      <button class="m-btn" onclick="sendCmd({type:'click',btn:'right'})">🖱️ Clique Dir</button>
      <button class="m-btn" onclick="sendCmd({type:'scroll',dir:120})">▲ Rolar</button>
      <button class="m-btn" onclick="sendCmd({type:'scroll',dir:-120})">▼ Rolar</button>
    </div>
    <div class="mouse-btns">
      <button class="meta-btn" style="flex:1" onclick="sendCmd({type:'key',key:'SPACE'})">Espaço</button>
      <button class="meta-btn" style="flex:1" onclick="sendCmd({type:'key',key:'ENTER'})">Enter</button>
      <button class="meta-btn" style="flex:1" onclick="sendCmd({type:'key',key:'BACKSPACE'})">Apagar</button>
      <button class="meta-btn" style="flex:1" onclick="sendCmd({type:'key',key:'F11'})">Tela Cheia</button>
    </div>
    <div class="kb-row">
      <input id="kbTxt" class="kb-input" type="text" placeholder="Digite aqui p/ escrever no PC..." />
      <button class="m-btn" style="flex:0 0 90px" onclick="sendText()">Enviar</button>
    </div>
  </div>

  <script>
    function showTab(t) {
      document.getElementById('tGame').classList.toggle('active', t === 'game');
      document.getElementById('tMouse').classList.toggle('active', t === 'mouse');
      document.getElementById('pGame').classList.toggle('active', t === 'game');
      document.getElementById('pMouse').classList.toggle('active', t === 'mouse');
    }

    function sendCmd(payload) {
      if (navigator.vibrate) navigator.vibrate(20);
      fetch('/pc/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }

    function sendText() {
      const inp = document.getElementById('kbTxt');
      if (inp.value) {
        sendCmd({ type: 'text', text: inp.value });
        inp.value = '';
      }
    }

    const pad = document.getElementById('pad');
    let lastX = 0, lastY = 0, touchStartTime = 0, moved = false;
    pad.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      lastX = t.clientX;
      lastY = t.clientY;
      touchStartTime = Date.now();
      moved = false;
    });
    pad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      const dx = Math.round((t.clientX - lastX) * 2.2);
      const dy = Math.round((t.clientY - lastY) * 2.2);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        moved = true;
        lastX = t.clientX;
        lastY = t.clientY;
        fetch('/pc/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'move', dx, dy })
        }).catch(() => {});
      }
    }, { passive: false });
    pad.addEventListener('touchend', () => {
      if (!moved && (Date.now() - touchStartTime < 250)) {
        sendCmd({ type: 'click', btn: 'left' });
      }
    });
  </script>
</body>
</html>`;
}

function handlePcGamerRoutes(req, res, pathname, ffmpegPath) {
  if (pathname.startsWith('/pc_hls/')) {
    const fileName = path.basename(pathname);
    if (fileName === 'stream.m3u8') {
      ensureStandbyHls(ffmpegPath);
    }
    const filePath = path.join(PC_HLS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      res.end('Not found');
      return true;
    }
    const isM3u8 = fileName.endsWith('.m3u8');
    res.writeHead(200, {
      'Content-Type': isM3u8 ? 'application/vnd.apple.mpegurl' : 'video/MP2T',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  if (pathname === '/pc') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPcTransmitterPage(req.headers.host));
    return true;
  }

  if (pathname === '/controle') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMobileControllerPage());
    return true;
  }

  if (pathname === '/pc/start-web' && req.method === 'POST') {
    startWebCaptureFfmpeg(ffmpegPath);
    res.writeHead(200);
    res.end('OK');
    return true;
  }

  if (pathname === '/pc/chunk' && req.method === 'POST') {
    lastWebChunkTime = Date.now();
    if (!webCaptureProc) startWebCaptureFfmpeg(ffmpegPath);
    req.on('data', chunk => {
      if (webCaptureProc && webCaptureProc.stdin && !webCaptureProc.stdin.destroyed) {
        try { webCaptureProc.stdin.write(chunk); } catch (e) {}
      }
    });
    req.on('end', () => {
      res.writeHead(200);
      res.end('OK');
    });
    return true;
  }

  if (pathname === '/pc/stop-web' && req.method === 'POST') {
    if (webCaptureProc) {
      try { webCaptureProc.kill('SIGKILL'); } catch (e) {}
      webCaptureProc = null;
    }
    ensureStandbyHls(ffmpegPath);
    res.writeHead(200);
    res.end('OK');
    return true;
  }

  if (pathname === '/pc/input' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const cmd = JSON.parse(body);
        inputQueue.push(cmd);
        if (inputQueue.length > 100) inputQueue.shift();
      } catch (e) {}
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
      res.end('OK');
    });
    return true;
  }

  if (pathname === '/pc/poll-input') {
    const batch = inputQueue.splice(0, inputQueue.length);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(batch));
    return true;
  }

  return false;
}

module.exports = { handlePcGamerRoutes, ensureStandbyHls };
