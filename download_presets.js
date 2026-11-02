const fs = require('fs');
const https = require('https');
const path = require('path');

const dir = 'C:\\Users\\randr\\.gemini\\antigravity\\scratch\\aoc-saphi-hub\\wallpapers';

const presets = [
  { id: 'cyberpunk', name: 'Cyberpunk Night City', url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?q=80&w=1920&auto=format&fit=crop' },
  { id: 'space', name: 'Deep Space Nebula', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=1920&auto=format&fit=crop' },
  { id: 'mountain', name: 'Minimalist Dark Peaks', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1920&auto=format&fit=crop' },
  { id: 'synthwave', name: 'Neon Synthwave Sunset', url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?q=80&w=1920&auto=format&fit=crop' },
  { id: 'gamer', name: 'Battlestation Dark Ambient', url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1920&auto=format&fit=crop' }
];

function download(url, dest) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
      } else {
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

(async () => {
  for (const p of presets) {
    const dest = path.join(dir, `${p.id}.jpg`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      console.log('Downloading preset:', p.name);
      await download(p.url, dest);
    }
  }

  // Set default active.jpg if not present
  const activePath = path.join(dir, 'active.jpg');
  const cyberpunkPath = path.join(dir, 'cyberpunk.jpg');
  if (fs.existsSync(cyberpunkPath) && !fs.existsSync(activePath)) {
    fs.copyFileSync(cyberpunkPath, activePath);
  }

  console.log('Done downloading wallpaper presets!');
})();
