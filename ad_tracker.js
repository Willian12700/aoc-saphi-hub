const https = require('https');

class TwitchAdTracker {
  constructor() {
    this.cachedStatus = new Map(); // channel -> { isAd, position, count, remainingSeconds, expiresAt }
    this.manualTestAd = null;
    this.clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  }

  fetchUrl(url, options = {}) {
    return new Promise((resolve) => {
      try {
        const u = new URL(url);
        const req = https.request({
          hostname: u.hostname,
          port: 443,
          path: u.pathname + u.search,
          method: options.method || 'GET',
          headers: options.headers || {}
        }, res => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', () => resolve({ status: 500, body: '' }));
        req.setTimeout(4000, () => { req.destroy(); resolve({ status: 504, body: '' }); });
        if (options.body) req.write(options.body);
        req.end();
      } catch (e) {
        resolve({ status: 500, body: '' });
      }
    });
  }

  async checkChannel(channel) {
    if (this.manualTestAd && Date.now() < this.manualTestAd.expiresAt) {
      const rem = Math.ceil((this.manualTestAd.expiresAt - Date.now()) / 1000);
      return {
        isAd: true,
        adPosition: this.manualTestAd.adPosition,
        adCount: this.manualTestAd.adCount,
        remainingSeconds: rem > 0 ? rem : 0,
        message: `Anúncio ${this.manualTestAd.adPosition} de ${this.manualTestAd.adCount}`
      };
    }

    const cleanChan = (channel || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanChan) return { isAd: false };

    // Check recent cache (valid for 3 seconds)
    const cached = this.cachedStatus.get(cleanChan);
    if (cached && Date.now() < cached.cacheExpires) {
      return cached.data;
    }

    try {
      // 1. Get playback token
      const query = `{ streamPlaybackAccessToken(channelName: "${cleanChan}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "embed"}) { value signature } }`;
      const r1 = await this.fetchUrl('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-ID': this.clientId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const tok = JSON.parse(r1.body)?.data?.streamPlaybackAccessToken;
      if (!tok) return { isAd: false };

      // 2. Fetch master usher
      const usherUrl = `https://usher.ttvnw.net/api/channel/hls/${cleanChan}.m3u8?client_id=${this.clientId}&token=${encodeURIComponent(tok.value)}&sig=${tok.signature}&allow_source=true&fast_bread=true`;
      const r2 = await this.fetchUrl(usherUrl);
      if (r2.status !== 200) return { isAd: false };

      // 3. Find media variant
      const lines = r2.body.split('\n');
      const mediaUrl = lines.find(l => l.startsWith('http'));
      if (!mediaUrl) return { isAd: false };

      // 4. Fetch media variant playlist
      const r3 = await this.fetchUrl(mediaUrl);
      const playlist = r3.body;

      // 5. Parse Ad tags
      const isAd = playlist.includes('twitch-stitched-ad') || playlist.includes('X-TV-TWITCH-STREAM-SOURCE="ad"');
      if (isAd) {
        const posMatch = playlist.match(/X-TV-TWITCH-AD-POSITION=(\d+)/);
        const countMatch = playlist.match(/X-TV-TWITCH-AD-COUNT=(\d+)/);
        const durMatch = playlist.match(/DURATION=([0-9.]+)/) || playlist.match(/PLANNED-DURATION=([0-9.]+)/);

        const adPosition = posMatch ? parseInt(posMatch[1], 10) : 1;
        const adCount = countMatch ? parseInt(countMatch[1], 10) : 1;
        const duration = durMatch ? parseFloat(durMatch[1]) : 30;

        // Approximate remaining time
        const remainingSeconds = Math.max(1, Math.round(duration));

        const resData = {
          isAd: true,
          adPosition,
          adCount,
          remainingSeconds,
          message: `Anúncio ${adPosition} de ${adCount}`
        };

        this.cachedStatus.set(cleanChan, {
          data: resData,
          cacheExpires: Date.now() + 3000
        });

        return resData;
      }

      const notAdData = { isAd: false };
      this.cachedStatus.set(cleanChan, {
        data: notAdData,
        cacheExpires: Date.now() + 4000
      });
      return notAdData;

    } catch (e) {
      return { isAd: false };
    }
  }

  triggerTest(position, count, seconds) {
    const sec = parseInt(seconds, 10) || 25;
    this.manualTestAd = {
      adPosition: parseInt(position, 10) || 1,
      adCount: parseInt(count, 10) || 3,
      expiresAt: Date.now() + (sec * 1000)
    };
    return {
      ok: true,
      adPosition: this.manualTestAd.adPosition,
      adCount: this.manualTestAd.adCount,
      remainingSeconds: sec
    };
  }
}

const adTracker = new TwitchAdTracker();

module.exports = {
  adTracker
};
