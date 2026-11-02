const https = require('https');

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
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
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testTwitch(channel) {
  const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  
  // Test different player types used by adblockers:
  // 'embed', 'picture-by-picture', 'autoplay', 'site'
  for (const pType of ['picture-by-picture', 'embed', 'site']) {
    const query = `{ streamPlaybackAccessToken(channelName: "${channel}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "${pType}"}) { value signature } }`;
    const r = await fetchUrl('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const tok = JSON.parse(r.body)?.data?.streamPlaybackAccessToken;
    if (!tok) {
      console.log(pType, 'NO TOKEN');
      continue;
    }
    const usherUrl = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?client_id=${TWITCH_CLIENT_ID}&token=${encodeURIComponent(tok.value)}&sig=${tok.signature}&allow_source=true&fast_bread=true`;
    const r2 = await fetchUrl(usherUrl);
    console.log(pType, 'Usher status:', r2.status, 'has m3u8:', r2.body.includes('#EXTM3U'));
    
    // Check if token mentions ads
    const tokVal = JSON.parse(tok.value);
    console.log(pType, 'token platform:', tokVal.platform, 'adblock:', tokVal.adblock, 'exempt:', tokVal.ad_properties);
  }
}

testTwitch('alanzoka');

async function inspectMedia(channel) {
  const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
  const query = `{ streamPlaybackAccessToken(channelName: "${channel}", params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`;
  const r = await fetchUrl('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const tok = JSON.parse(r.body)?.data?.streamPlaybackAccessToken;
  const usherUrl = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?client_id=${TWITCH_CLIENT_ID}&token=${encodeURIComponent(tok.value)}&sig=${tok.signature}&allow_source=true`;
  const master = await fetchUrl(usherUrl);
  const lines = master.body.split('\n');
  const firstUrl = lines.find(l => l.startsWith('http'));
  if (firstUrl) {
    const media = await fetchUrl(firstUrl);
    console.log('--- MEDIA PLAYLIST SAMPLE ---');
    console.log(media.body.split('\n').filter(l => !l.startsWith('http') || l.includes('ad')).slice(0, 30).join('\n'));
  }
}

inspectMedia('gaules');
