const fs = require('fs');
const path = require('path');
const { chatService } = require('./chat_service');
const { goalService } = require('./goal_service');
const { adTracker } = require('./ad_tracker');

const THEME_FILE = path.join(__dirname, 'theme.json');
const WALLPAPERS_DIR = path.join(__dirname, 'wallpapers');

const DEFAULT_THEMES = {
  willian: {
    activeWallpaper: "cyberpunk",
    wallpaperUrl: "/wallpapers/active_willian.jpg",
    wallpaperOpacity: 0.45,
    accentColor: "0x9146FFFF",
    accentHex: "#9146FF",
    themeName: "Cyberpunk Purple",
    updatedAt: Date.now()
  },
  mae: {
    activeWallpaper: "space",
    wallpaperUrl: "/wallpapers/active_mae.jpg",
    wallpaperOpacity: 0.50,
    accentColor: "0x00E5FFFF",
    accentHex: "#00E5FF",
    themeName: "Deep Nebula Cyan",
    updatedAt: Date.now()
  }
};

function getThemes() {
  try {
    if (fs.existsSync(THEME_FILE)) {
      const data = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
      if (data.willian && data.mae) {
        return data;
      }
      // Migrate old single theme
      return {
        willian: { ...DEFAULT_THEMES.willian, ...data, wallpaperUrl: "/wallpapers/active_willian.jpg" },
        mae: { ...DEFAULT_THEMES.mae }
      };
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_THEMES));
}

function saveThemes(themes) {
  fs.writeFileSync(THEME_FILE, JSON.stringify(themes, null, 2), 'utf8');
}

function resolveTvKey(paramTv, paramIp, remoteAddress) {
  if (paramTv === 'mae' || paramTv === 'quarto_mae') return 'mae';
  if (paramTv === 'willian' || paramTv === 'quarto_willian') return 'willian';
  if (paramTv === 'both') return 'both';

  const checkStr = `${paramIp || ''} ${remoteAddress || ''}`;
  if (checkStr.includes('.11')) return 'mae';
  if (checkStr.includes('.8')) return 'willian';

  return 'willian';
}

function renderPanelHtml(themes, host) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Central de Visual - Roku TV Hub</title>
  <style>
    * { box-sizing: border-box; margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: #09090b; color: #f4f4f5; padding: 24px; min-height: 100vh; }
    .container { max-width: 1120px; margin: 0 auto; }
    
    /* Header */
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-badge { width: 44px; height: 44px; border-radius: 12px; background: #9146FF; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 22px; color: #000; box-shadow: 0 0 20px #9146FF66; transition: background 0.2s, box-shadow 0.2s; }
    .brand h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .brand p { font-size: 13px; color: #a1a1aa; }
    .status-pill { display: flex; align-items: center; gap: 8px; background: #18181b; border: 1px solid #27272a; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e; }

    /* TV Selection Bar */
    .tv-selector-card { background: #121215; border: 1px solid #27272a; border-radius: 14px; padding: 14px 18px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px; }
    .tv-selector-title { font-size: 13px; font-weight: 700; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
    .tv-tabs { display: flex; gap: 10px; flex-wrap: wrap; }
    .tv-tab { display: flex; align-items: center; gap: 10px; background: #18181b; border: 2px solid #27272a; padding: 8px 16px; border-radius: 10px; cursor: pointer; transition: 0.15s; }
    .tv-tab:hover { border-color: #52525b; transform: translateY(-1px); }
    .tv-tab.active { border-color: #9146FF; background: #201a2e; box-shadow: 0 0 16px rgba(145, 70, 255, 0.25); }
    .tv-tab-icon { font-size: 20px; }
    .tv-tab-name { font-size: 14px; font-weight: 800; color: #fff; }
    .tv-tab-sub { font-size: 11px; color: #a1a1aa; }

    /* Layout Grid */
    .grid { display: grid; grid-template-columns: 1fr 420px; gap: 28px; align-items: start; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }

    /* Cards */
    .card { background: #121215; border: 1px solid #27272a; border-radius: 14px; padding: 22px; margin-bottom: 24px; }
    .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
    .card-title span { color: #a1a1aa; font-size: 13px; font-weight: 400; }
    .card-target-badge { font-size: 11px; font-weight: 700; background: #27272a; padding: 3px 10px; border-radius: 20px; color: #fff; }

    /* TV Preview */
    .tv-bezel { position: relative; width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; border: 2px solid #3f3f46; box-shadow: 0 20px 40px rgba(0,0,0,0.8); }
    .tv-wallpaper { position: absolute; inset: 0; background-size: cover; background-position: center; transition: all 0.3s ease; }
    .tv-overlay { position: absolute; inset: 0; background: rgba(9, 9, 11, 0.55); transition: background 0.2s; }
    .tv-ui { position: absolute; inset: 0; display: flex; flex-direction: column; padding: 12px; z-index: 2; pointer-events: none; }
    .tv-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 8px; margin-bottom: 12px; }
    .tv-title { font-size: 12px; font-weight: 800; display: flex; align-items: center; gap: 6px; }
    .tv-accent-dot { width: 8px; height: 8px; border-radius: 2px; background: #9146FF; }
    .tv-clock { font-size: 11px; font-weight: 700; color: #a1a1aa; }
    .tv-body { display: grid; grid-template-columns: 90px 1fr 120px; gap: 10px; flex: 1; }
    .tv-nav { display: flex; flex-direction: column; gap: 4px; }
    .tv-nav-item { height: 16px; border-radius: 4px; background: rgba(255,255,255,0.06); font-size: 8px; display: flex; align-items: center; padding-left: 6px; color: #a1a1aa; font-weight: 600; }
    .tv-nav-item.active { background: #9146FF; color: #000; font-weight: 800; }
    .tv-list { display: flex; flex-direction: column; gap: 5px; }
    .tv-list-item { height: 20px; border-radius: 4px; background: rgba(255,255,255,0.06); font-size: 9px; display: flex; align-items: center; padding: 0 8px; justify-content: space-between; font-weight: 600; border-left: 2px solid transparent; }
    .tv-list-item.active { border-left-color: #9146FF; background: rgba(255,255,255,0.12); }
    .tv-preview-card { border-radius: 6px; background: rgba(0,0,0,0.65); border: 1px solid rgba(255,255,255,0.1); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .tv-mock-thumb { height: 50px; border-radius: 4px; background: #27272a; border-top: 2px solid #9146FF; }

    /* Wallpaper Presets */
    .preset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
    .preset-card { position: relative; border-radius: 10px; overflow: hidden; border: 2px solid #27272a; aspect-ratio: 16/9; cursor: pointer; transition: 0.15s; }
    .preset-card img { width: 100%; height: 100%; object-fit: cover; }
    .preset-card:hover { transform: translateY(-2px); border-color: #71717a; }
    .preset-card.active { border-color: #9146FF; box-shadow: 0 0 15px rgba(145, 70, 255, 0.5); }
    .preset-label { position: absolute; bottom: 0; inset-inline: 0; background: linear-gradient(to top, rgba(0,0,0,0.9), transparent); font-size: 11px; font-weight: 700; padding: 12px 6px 4px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Accent Swatches */
    .color-swatches { display: flex; gap: 12px; flex-wrap: wrap; }
    .swatch { width: 44px; height: 44px; border-radius: 10px; cursor: pointer; border: 3px solid #27272a; transition: 0.15s; }
    .swatch:hover { transform: scale(1.08); }
    .swatch.active { border-color: #fff; transform: scale(1.12); box-shadow: 0 0 16px rgba(255,255,255,0.4); }

    /* Upload Area */
    .upload-zone { border: 2px dashed #3f3f46; border-radius: 12px; padding: 24px; text-align: center; cursor: pointer; background: #18181b; transition: 0.15s; }
    .upload-zone:hover { border-color: #9146FF; background: #202024; }
    .upload-zone p { font-size: 14px; color: #a1a1aa; margin-top: 6px; }
    .upload-zone strong { color: #fff; }

    /* Sliders & Inputs */
    .form-group { margin-bottom: 18px; }
    .form-label { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: #d4d4d8; }
    .slider { width: 100%; height: 6px; border-radius: 3px; background: #27272a; outline: none; -webkit-appearance: none; }
    .slider::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #9146FF; cursor: pointer; box-shadow: 0 0 10px #9146FF; }
    .input-text { width: 100%; background: #18181b; border: 1px solid #3f3f46; border-radius: 8px; padding: 10px 14px; color: #fff; font-size: 14px; outline: none; }
    .input-text:focus { border-color: #9146FF; }

    /* Action Button */
    .btn-apply { width: 100%; background: #9146FF; color: #000; border: none; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 800; cursor: pointer; transition: 0.15s; letter-spacing: 0.5px; box-shadow: 0 10px 25px rgba(145, 70, 255, 0.3); }
    .btn-apply:hover { filter: brightness(1.1); transform: translateY(-2px); }
    .btn-apply:active { transform: translateY(0); }

    /* Toast */
    #toast { position: fixed; bottom: 24px; right: 24px; background: #22c55e; color: #000; font-weight: 800; padding: 14px 24px; border-radius: 10px; font-size: 14px; display: none; box-shadow: 0 10px 30px rgba(34,197,94,0.4); z-index: 100; }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="brand">
        <div class="brand-badge" id="brandBadge">⚡</div>
        <div>
          <h1>Central de Visual • Roku TV</h1>
          <p>Personalize o fundo, tema e cores das TVs dos quartos de forma independente</p>
        </div>
      </div>
      <div class="status-pill">
        <div class="status-dot"></div>
        <span>Servidor Ativo • 192.168.1.7</span>
      </div>
    </header>

    <!-- TV Selector Bar -->
    <div class="tv-selector-card">
      <div class="tv-selector-title">
        <span>🎯 Escolha qual TV personalizar:</span>
      </div>
      <div class="tv-tabs">
        <div class="tv-tab active" id="tab-willian" onclick="switchTv('willian')">
          <div class="tv-tab-icon">🛏️</div>
          <div>
            <div class="tv-tab-name">Quarto Willian</div>
            <div class="tv-tab-sub">AOC Roku TV • 192.168.1.8</div>
          </div>
        </div>
        <div class="tv-tab" id="tab-mae" onclick="switchTv('mae')">
          <div class="tv-tab-icon">🌸</div>
          <div>
            <div class="tv-tab-name">Quarto Mãe</div>
            <div class="tv-tab-sub">AOC Roku TV • 192.168.1.11</div>
          </div>
        </div>
        <div class="tv-tab" id="tab-both" onclick="switchTv('both')">
          <div class="tv-tab-icon">⚡</div>
          <div>
            <div class="tv-tab-name">Ambas as TVs</div>
            <div class="tv-tab-sub">Aplicar mesmo visual nos dois quartos</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid">
      <!-- Left Column: Controls -->
      <div>
        <!-- Wallpapers Presets -->
        <div class="card">
          <div class="card-title">
            🖼️ Wallpapers de Alta Resolução <span>(Selecione um preset)</span>
            <span class="card-target-badge" id="badgePresetTarget">Quarto Willian</span>
          </div>
          <div class="preset-grid">
            <div class="preset-card" id="preset-cyberpunk" onclick="selectPreset('cyberpunk', '/wallpapers/cyberpunk.jpg', 'Cyberpunk Night City')">
              <img src="/wallpapers/cyberpunk.jpg" alt="Cyberpunk" />
              <div class="preset-label">Cyberpunk City</div>
            </div>
            <div class="preset-card" id="preset-space" onclick="selectPreset('space', '/wallpapers/space.jpg', 'Deep Space Nebula')">
              <img src="/wallpapers/space.jpg" alt="Space" />
              <div class="preset-label">Nebula Espacial</div>
            </div>
            <div class="preset-card" id="preset-mountain" onclick="selectPreset('mountain', '/wallpapers/mountain.jpg', 'Minimalist Peaks')">
              <img src="/wallpapers/mountain.jpg" alt="Peaks" />
              <div class="preset-label">Picos Dark</div>
            </div>
            <div class="preset-card" id="preset-synthwave" onclick="selectPreset('synthwave', '/wallpapers/synthwave.jpg', 'Neon Synthwave')">
              <img src="/wallpapers/synthwave.jpg" alt="Synthwave" />
              <div class="preset-label">Neon Retro</div>
            </div>
            <div class="preset-card" id="preset-gamer" onclick="selectPreset('gamer', '/wallpapers/gamer.jpg', 'Battlestation Dark')">
              <img src="/wallpapers/gamer.jpg" alt="Gamer" />
              <div class="preset-label">Quarto Gamer</div>
            </div>
          </div>
        </div>

        <!-- Custom Upload & URL -->
        <div class="card">
          <div class="card-title">
            📁 Enviar Imagem do seu PC ou Link da Internet
            <span class="card-target-badge" id="badgeUploadTarget">Quarto Willian</span>
          </div>
          <div class="upload-zone" onclick="document.getElementById('fileInput').click()">
            <input type="file" id="fileInput" accept="image/*" style="display:none" onchange="handleFileUpload(event)" />
            <div style="font-size:28px;">📤</div>
            <p><strong>Clique aqui para escolher uma foto do seu PC</strong> (JPG ou PNG)</p>
            <p style="font-size:12px;color:#71717a;" id="uploadDesc">A imagem será salva como wallpaper oficial da TV selecionada</p>
          </div>
          <div style="margin-top:14px;">
            <label class="form-label"><span>Ou cole o link direto de uma imagem (Pinterest, Twitter, etc):</span></label>
            <div style="display:flex;gap:8px;">
              <input type="url" id="imageUrlInput" class="input-text" placeholder="https://exemplo.com/minha-imagem.jpg" />
              <button onclick="applyImageUrl()" style="padding:0 18px;background:#27272a;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Testar</button>
            </div>
          </div>
        </div>

        <!-- Accent Colors -->
        <div class="card">
          <div class="card-title">
            🎨 Cor de Destaque da TV (Tema)
            <span class="card-target-badge" id="badgeColorTarget">Quarto Willian</span>
          </div>
          <div class="color-swatches">
            <div class="swatch" data-hex="#9146FF" style="background:#9146FF" onclick="selectColor('#9146FF', '0x9146FFFF', 'Twitch Purple')" title="Twitch Purple"></div>
            <div class="swatch" data-hex="#53FC18" style="background:#53FC18" onclick="selectColor('#53FC18', '0x53FC18FF', 'Kick Toxic Green')" title="Kick Neon Green"></div>
            <div class="swatch" data-hex="#00E5FF" style="background:#00E5FF" onclick="selectColor('#00E5FF', '0x00E5FFFF', 'Cyberpunk Cyan')" title="Cyberpunk Cyan"></div>
            <div class="swatch" data-hex="#E50914" style="background:#E50914" onclick="selectColor('#E50914', '0xE50914FF', 'Crimson Red')" title="Crimson Red"></div>
            <div class="swatch" data-hex="#F59E0B" style="background:#F59E0B" onclick="selectColor('#F59E0B', '0xF59E0BFF', 'Cyber Gold')" title="Cyber Gold"></div>
            <div class="swatch" data-hex="#F1F5F9" style="background:#F1F5F9" onclick="selectColor('#F1F5F9', '0xF1F5F9FF', 'Diamond White')" title="Diamond White"></div>
          </div>
        </div>

        <!-- Live Goal Alert Test Card -->
        <div class="card">
          <div class="card-title">
            ⚽ Notificação de Gol na TV <span>(Ao Vivo &amp; Teste)</span>
          </div>
          <p style="font-size:13px;color:#a1a1aa;margin-bottom:14px;">Quando acontece um gol no futebol ao vivo, um banner surge no topo da TV. Se você apertar <strong>[OK]</strong> no controle, a TV troca pro jogo na hora!</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button onclick="testGoal('Flamengo', 'Vasco', '1 x 0')" style="background:#22c55e;color:#000;border:none;padding:10px 16px;border-radius:8px;font-weight:800;cursor:pointer;">⚽ Disparar Gol Flamengo (1x0)</button>
            <button onclick="testGoal('Real Madrid', 'Barcelona', '2 x 1')" style="background:#00E5FF;color:#000;border:none;padding:10px 16px;border-radius:8px;font-weight:800;cursor:pointer;">⚽ Disparar Gol Real Madrid (2x1)</button>
            <button onclick="testGoal('Palmeiras', 'Corinthians', '1 x 0')" style="background:#53fc18;color:#000;border:none;padding:10px 16px;border-radius:8px;font-weight:800;cursor:pointer;">⚽ Disparar Gol Palmeiras (1x0)</button>
          </div>
        </div>

        <!-- Twitch Ad Shield Card -->
        <div class="card">
          <div class="card-title">
            🛡️ Escudo &amp; Contador de Anúncios da Twitch
          </div>
          <p style="font-size:13px;color:#a1a1aa;margin-bottom:14px;">Monitora a transmissão e exibe na tela da TV quantos anúncios estão passando e a contagem regressiva de segundos até a live voltar:</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button onclick="testAd(1, 3, 25)" style="background:#f59e0b;color:#000;border:none;padding:10px 16px;border-radius:8px;font-weight:800;cursor:pointer;">🛡️ Testar Aviso (1 de 3 • 25s)</button>
            <button onclick="testAd(2, 4, 15)" style="background:#f97316;color:#000;border:none;padding:10px 16px;border-radius:8px;font-weight:800;cursor:pointer;">🛡️ Testar Aviso (2 de 4 • 15s)</button>
          </div>
        </div>
      </div>

      <!-- Right Column: Live TV Preview & Save -->
      <div>
        <div class="card" style="position:sticky;top:24px;">
          <div class="card-title">
            📺 Prévia em Tempo Real
            <span class="card-target-badge" id="previewTargetName">TV Quarto Willian</span>
          </div>
          
          <div class="tv-bezel">
            <div class="tv-wallpaper" id="tvWallpaper"></div>
            <div class="tv-overlay" id="tvOverlay"></div>
            
            <div class="tv-ui">
              <div class="tv-header">
                <div class="tv-title">
                  <div class="tv-accent-dot" id="previewAccentDot"></div>
                  <span id="previewAppTitle">TV QUARTO WILLIAN</span>
                </div>
                <div class="tv-clock">20:55 • ONLINE</div>
              </div>

              <div class="tv-body">
                <div class="tv-nav">
                  <div class="tv-nav-item active" id="previewNavItem">Futebol Ao Vivo</div>
                  <div class="tv-nav-item">Filmes & TV 24h</div>
                  <div class="tv-nav-item">Twitch Brasil</div>
                  <div class="tv-nav-item">Kick Brasil</div>
                </div>

                <div class="tv-list">
                  <div class="tv-list-item active" id="previewListItem">
                    <span>Telecine Premium HD</span>
                    <span style="font-size:7px;color:#22c55e;">AO VIVO</span>
                  </div>
                  <div class="tv-list-item"><span>HBO HD</span></div>
                  <div class="tv-list-item"><span>Premiere Clubes HD</span></div>
                  <div class="tv-list-item"><span>SporTV HD</span></div>
                  <div class="tv-list-item"><span>Cartoon Network HD</span></div>
                </div>

                <div class="tv-preview-card">
                  <div class="tv-mock-thumb" id="previewThumbBorder"></div>
                  <div style="font-size:8px;font-weight:700;color:#fff;">Oppenheimer (2023)</div>
                  <div style="font-size:7px;color:#a1a1aa;">Telecine • 1080p HD</div>
                </div>
              </div>
            </div>
          </div>

          <div style="margin-top:20px;">
            <div class="form-group">
              <div class="form-label">
                <span>Brilho do Fundo na TV</span>
                <span id="opacityLabel">45%</span>
              </div>
              <input type="range" class="slider" id="opacitySlider" min="15" max="85" value="45" oninput="updateOpacity(this.value)" />
            </div>

            <button class="btn-apply" id="btnApply" onclick="saveAndApply()">⚡ APLICAR NA TV AGORA</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast">✓ Visual atualizado na TV com sucesso!</div>

  <script>
    const themesData = ${JSON.stringify(themes)};
    let activeTv = 'willian';

    function getActiveTheme() {
      if (activeTv === 'both') {
        return themesData['willian'];
      }
      return themesData[activeTv] || themesData['willian'];
    }

    function switchTv(tvKey) {
      activeTv = tvKey;
      
      // Update Tab styling
      document.querySelectorAll('.tv-tab').forEach(t => t.classList.remove('active'));
      const activeTab = document.getElementById('tab-' + tvKey);
      if (activeTab) activeTab.classList.add('active');

      const tvLabel = tvKey === 'willian' ? 'Quarto Willian' : (tvKey === 'mae' ? 'Quarto Mãe' : 'Ambas as TVs');
      document.getElementById('badgePresetTarget').textContent = tvLabel;
      document.getElementById('badgeUploadTarget').textContent = tvLabel;
      document.getElementById('badgeColorTarget').textContent = tvLabel;
      document.getElementById('previewTargetName').textContent = tvKey === 'both' ? 'Ambas as TVs' : 'TV ' + tvLabel;
      document.getElementById('previewAppTitle').textContent = ('TV ' + tvLabel).toUpperCase();
      document.getElementById('btnApply').textContent = '⚡ APLICAR NA TV ' + tvLabel.toUpperCase();

      refreshUiForTheme();
    }

    function refreshUiForTheme() {
      const theme = getActiveTheme();

      // Wallpaper
      document.getElementById('tvWallpaper').style.backgroundImage = 'url(' + theme.wallpaperUrl + ')';
      
      // Presets active state
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      const presetEl = document.getElementById('preset-' + theme.activeWallpaper);
      if (presetEl) presetEl.classList.add('active');

      // Opacity
      const op = Math.round(theme.wallpaperOpacity * 100);
      document.getElementById('opacitySlider').value = op;
      document.getElementById('opacityLabel').textContent = op + '%';
      document.getElementById('tvOverlay').style.background = 'rgba(9,9,11,' + (1 - theme.wallpaperOpacity) + ')';

      // Accent color
      applyColorToPreview(theme.accentHex);
      document.querySelectorAll('.swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.hex.toLowerCase() === theme.accentHex.toLowerCase());
      });
    }

    function applyColorToPreview(hex) {
      document.getElementById('brandBadge').style.background = hex;
      document.getElementById('brandBadge').style.boxShadow = '0 0 20px ' + hex + '66';
      document.getElementById('previewAccentDot').style.background = hex;
      document.getElementById('previewNavItem').style.background = hex;
      document.getElementById('previewListItem').style.borderLeftColor = hex;
      document.getElementById('previewThumbBorder').style.borderTopColor = hex;
      document.getElementById('btnApply').style.background = hex;
      document.getElementById('btnApply').style.boxShadow = '0 10px 25px ' + hex + '44';
      
      // Update tab active glow
      const activeTab = document.querySelector('.tv-tab.active');
      if (activeTab) {
        activeTab.style.borderColor = hex;
      }
    }

    function updateOpacity(val) {
      const opacity = val / 100;
      if (activeTv === 'both') {
        themesData.willian.wallpaperOpacity = opacity;
        themesData.mae.wallpaperOpacity = opacity;
      } else {
        themesData[activeTv].wallpaperOpacity = opacity;
      }
      document.getElementById('opacityLabel').textContent = val + '%';
      document.getElementById('tvOverlay').style.background = 'rgba(9,9,11,' + (1 - opacity) + ')';
    }

    function selectPreset(id, url, name) {
      if (activeTv === 'both') {
        themesData.willian.activeWallpaper = id;
        themesData.willian.wallpaperUrl = url;
        themesData.willian.themeName = name;
        themesData.mae.activeWallpaper = id;
        themesData.mae.wallpaperUrl = url;
        themesData.mae.themeName = name;
      } else {
        themesData[activeTv].activeWallpaper = id;
        themesData[activeTv].wallpaperUrl = url;
        themesData[activeTv].themeName = name;
      }
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      const card = document.getElementById('preset-' + id);
      if (card) card.classList.add('active');
      document.getElementById('tvWallpaper').style.backgroundImage = 'url(' + url + ')';
    }

    function selectColor(hex, rokuCode, name) {
      if (activeTv === 'both') {
        themesData.willian.accentHex = hex;
        themesData.willian.accentColor = rokuCode;
        themesData.mae.accentHex = hex;
        themesData.mae.accentColor = rokuCode;
      } else {
        themesData[activeTv].accentHex = hex;
        themesData[activeTv].accentColor = rokuCode;
      }
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      event.currentTarget.classList.add('active');
      applyColorToPreview(hex);
    }

    function applyImageUrl() {
      const url = document.getElementById('imageUrlInput').value.trim();
      if (!url) return alert('Cole uma URL válida de imagem');
      if (activeTv === 'both') {
        themesData.willian.activeWallpaper = 'custom_url';
        themesData.willian.wallpaperUrl = url;
        themesData.mae.activeWallpaper = 'custom_url';
        themesData.mae.wallpaperUrl = url;
      } else {
        themesData[activeTv].activeWallpaper = 'custom_url';
        themesData[activeTv].wallpaperUrl = url;
      }
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      document.getElementById('tvWallpaper').style.backgroundImage = 'url(' + url + ')';
      showToast('URL da imagem carregada na prévia!');
    }

    async function handleFileUpload(e) {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('wallpaper', file);

      showToast('Enviando imagem do PC para a TV...');
      try {
        const res = await fetch('/api/upload-wallpaper?tv=' + activeTv, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.ok) {
          const freshUrl = data.url + '?t=' + Date.now();
          if (activeTv === 'both') {
            themesData.willian.activeWallpaper = 'uploaded';
            themesData.willian.wallpaperUrl = '/wallpapers/active_willian.jpg';
            themesData.mae.activeWallpaper = 'uploaded';
            themesData.mae.wallpaperUrl = '/wallpapers/active_mae.jpg';
          } else {
            themesData[activeTv].activeWallpaper = 'uploaded';
            themesData[activeTv].wallpaperUrl = data.url;
          }
          document.getElementById('tvWallpaper').style.backgroundImage = 'url(' + freshUrl + ')';
          document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
          showToast('✓ Imagem enviada para a TV com sucesso!');
        }
      } catch (err) {
        alert('Erro ao enviar imagem: ' + err.message);
      }
    }

    async function saveAndApply() {
      const btn = document.getElementById('btnApply');
      const prevText = btn.textContent;
      btn.textContent = 'Salvando e enviando...';

      const payload = {
        tv: activeTv,
        ...(activeTv === 'both' ? themesData.willian : themesData[activeTv])
      };

      try {
        const res = await fetch('/api/theme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const d = await res.json();
        btn.textContent = prevText;
        const targetLabel = activeTv === 'willian' ? 'Quarto Willian' : (activeTv === 'mae' ? 'Quarto Mãe' : 'Ambas as TVs');
        showToast('✓ Aplicado com sucesso na TV: ' + targetLabel + '!');
      } catch (e) {
        btn.textContent = prevText;
        alert('Erro ao salvar: ' + e.message);
      }
    }

    async function testGoal(team, opp, score) {
      try {
        const res = await fetch('/api/trigger-goal-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team, opp, score })
        });
        const d = await res.json();
        showToast('⚽ ' + d.alert.text + ' disparado para a TV!');
      } catch (e) {
        alert('Erro ao disparar: ' + e.message);
      }
    }

    async function testAd(position, count, seconds) {
      try {
        const res = await fetch('/api/trigger-test-ad', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position, count, seconds })
        });
        const d = await res.json();
        showToast('🛡️ Contador de Anúncio (' + position + '/' + count + ' • ' + seconds + 's) disparado na TV!');
      } catch (e) {
        alert('Erro: ' + e.message);
      }
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 3500);
    }

    // Initialize UI on load
    switchTv('willian');
  </script>
</body>
</html>`;
}

function handlePanelRoutes(req, res, urlObj) {
  const pathname = urlObj.pathname;

  // 1. /painel
  if (pathname === '/painel') {
    const themes = getThemes();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPanelHtml(themes, req.headers.host));
    return true;
  }

  // 2. /api/theme (GET)
  if (pathname === '/api/theme' && req.method === 'GET') {
    const themes = getThemes();
    const queryTv = urlObj.searchParams.get('tv');
    const queryIp = urlObj.searchParams.get('ip');
    const returnAll = urlObj.searchParams.get('all') === '1';

    if (returnAll) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(themes));
      return true;
    }

    const targetKey = resolveTvKey(queryTv, queryIp, req.socket.remoteAddress);
    const theme = themes[targetKey] || themes.willian;
    const host = req.headers['x-forwarded-host'] || req.headers.host || '192.168.1.7:8080';
    const proto = req.headers['x-forwarded-proto'] || (host.includes('trycloudflare') ? 'https' : 'http');
    
    let fullWallpaperUrl = theme.wallpaperUrl;
    if (fullWallpaperUrl.startsWith('/')) {
      fullWallpaperUrl = `${proto}://${host}${fullWallpaperUrl}?t=${theme.updatedAt || Date.now()}`;
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      ...theme,
      targetKey,
      fullWallpaperUrl,
      goalAlert: goalService.getActiveAlert()
    }));
    return true;
  }

  // 2b. /api/chat (GET)
  if (pathname === '/api/chat' && req.method === 'GET') {
    const channel = urlObj.searchParams.get('channel') || 'alanzoka';
    const messages = chatService.getMessages(channel);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(messages));
    return true;
  }

  // 2c. /api/goal-alert (GET)
  if (pathname === '/api/goal-alert' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(goalService.getActiveAlert() || { active: false }));
    return true;
  }

  // 2d. /api/trigger-goal-test (POST)
  if (pathname === '/api/trigger-goal-test' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const alert = goalService.triggerManualTest(data.team, data.opp, data.score);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, alert }));
      } catch (e) {
        const alert = goalService.triggerManualTest('Flamengo', 'Vasco', '1 x 0');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, alert }));
      }
    });
    return true;
  }

  // 2e. /api/ad-status (GET)
  if (pathname === '/api/ad-status' && req.method === 'GET') {
    const channel = urlObj.searchParams.get('channel') || 'alanzoka';
    adTracker.checkChannel(channel).then(status => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(status));
    }).catch(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ isAd: false }));
    });
    return true;
  }

  // 2f. /api/trigger-test-ad (POST)
  if (pathname === '/api/trigger-test-ad' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let data = {};
      try { data = body ? JSON.parse(body) : {}; } catch (e) {}
      const result = adTracker.triggerTest(data.position || 1, data.count || 3, data.seconds || 25);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    });
    return true;
  }

  // 3. /api/theme (POST)
  if (pathname === '/api/theme' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const themes = getThemes();
        const targetTv = data.tv || 'willian';
        const now = Date.now();

        const targets = targetTv === 'both' ? ['willian', 'mae'] : [targetTv === 'mae' ? 'mae' : 'willian'];

        for (const key of targets) {
          const current = themes[key] || DEFAULT_THEMES[key];
          const updated = { ...current, ...data, updatedAt: now };
          delete updated.tv;

          // If preset, copy to active_${key}.jpg
          if (data.activeWallpaper && data.activeWallpaper !== 'uploaded' && data.activeWallpaper !== 'custom_url') {
            const presetPath = path.join(WALLPAPERS_DIR, `${data.activeWallpaper}.jpg`);
            const targetPath = path.join(WALLPAPERS_DIR, `active_${key}.jpg`);
            if (fs.existsSync(presetPath)) {
              fs.copyFileSync(presetPath, targetPath);
              updated.wallpaperUrl = `/wallpapers/active_${key}.jpg`;
            }
          }
          themes[key] = updated;
        }

        saveThemes(themes);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, themes }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return true;
  }

  // 4. /api/upload-wallpaper (POST)
  if (pathname === '/api/upload-wallpaper' && req.method === 'POST') {
    const targetTv = urlObj.searchParams.get('tv') || 'willian';
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      let rawImage = buf;

      // Simple multipart/binary handler
      const boundaryMatch = (req.headers['content-type'] || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const str = buf.toString('latin1');
        const headerEnd = str.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const bodyStart = headerEnd + 4;
          const bodyEnd = str.lastIndexOf('--' + boundary);
          if (bodyEnd > bodyStart) {
            rawImage = buf.subarray(bodyStart, bodyEnd - 2);
          }
        }
      }

      const targets = targetTv === 'both' ? ['willian', 'mae'] : [targetTv === 'mae' ? 'mae' : 'willian'];
      const themes = getThemes();
      const now = Date.now();

      for (const key of targets) {
        const targetPath = path.join(WALLPAPERS_DIR, `active_${key}.jpg`);
        fs.writeFileSync(targetPath, rawImage);
        themes[key] = {
          ...themes[key],
          activeWallpaper: 'uploaded',
          wallpaperUrl: `/wallpapers/active_${key}.jpg`,
          updatedAt: now
        };
      }

      saveThemes(themes);
      const url = targetTv === 'mae' ? '/wallpapers/active_mae.jpg' : '/wallpapers/active_willian.jpg';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true, url, targetTv }));
    });
    return true;
  }

  // 5. /wallpapers/:file
  if (pathname.startsWith('/wallpapers/')) {
    const file = path.basename(pathname).split('?')[0];
    const filePath = path.join(WALLPAPERS_DIR, file);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }
  }

  return false;
}

module.exports = {
  handlePanelRoutes,
  getThemes
};
