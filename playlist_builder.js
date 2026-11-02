const fs = require('fs');
const path = require('path');

const channels = [
  // Desenhos & Infantis
  { name: "Cartoon Network HD", group: "Infantil & Desenhos", url: "http://45.162.64.114/CARTOON_NETWORK/tracks-v1a1/mono.ts.m3u8" },
  { name: "Discovery Kids HD", group: "Infantil & Desenhos", url: "https://ww0.embedtv.cc/discoverykids" },
  { name: "Gloob HD", group: "Infantil & Desenhos", url: "https://ww0.embedtv.cc/gloob" },
  { name: "Retro Cartoon HD", group: "Infantil & Desenhos", url: "https://stmv1.video.brstream.com.br/retrotv/retrotv/chunklist_w1069200121.m3u8" },
  { name: "Adult Swim HD", group: "Infantil & Desenhos", url: "https://ww0.embedtv.cc/adultswim" },

  // Filmes & Séries
  { name: "Telecine Premium HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/telecinepremium" },
  { name: "Telecine Action HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/telecineaction" },
  { name: "Telecine Pipoca HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/telecinepipoca" },
  { name: "Telecine Fun HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/telecinefun" },
  { name: "Telecine Touch HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/telecinetouch" },
  { name: "Telecine Cult HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/telecinecult" },
  { name: "HBO HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/hbo" },
  { name: "HBO 2 HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/hbo2" },
  { name: "HBO Plus HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/hboplus" },
  { name: "HBO Family HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/hbofamily" },
  { name: "HBO Xtreme HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/hboxtreme" },
  { name: "Megapix HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/megapix" },
  { name: "Space HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/space" },
  { name: "TNT HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/tnt" },
  { name: "TNT Series HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/tntseries" },
  { name: "TNT Novelas HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/tntnovelas" },
  { name: "Warner Channel HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/warnerchannel" },
  { name: "Studio Universal HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/studiouniversal" },
  { name: "Sony Movies HD", group: "Filmes & Series", url: "http://45.162.64.114/SONY_MOVIES/tracks-v1a1/mono.ts.m3u8" },
  { name: "AMC HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/amc" },
  { name: "AXN HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/axn" },
  { name: "A&E HD", group: "Filmes & Series", url: "https://ww0.embedtv.cc/ae" },

  // Esportes / Futebol
  { name: "Premiere Clubes HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/premiere" },
  { name: "Premiere 2 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/premiere2" },
  { name: "Premiere 3 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/premiere3" },
  { name: "Premiere 4 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/premiere4" },
  { name: "Premiere 5 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/premiere5" },
  { name: "SporTV HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/sportv" },
  { name: "SporTV 2 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/sportv2" },
  { name: "SporTV 3 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/sportv3" },
  { name: "ESPN HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/espn" },
  { name: "ESPN 2 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/espn2" },
  { name: "ESPN 3 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/espn3" },
  { name: "ESPN 4 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/espn4" },
  { name: "ESPN 5 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/espn5" },
  { name: "ESPN 6 HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/espn6" },
  { name: "BandSports HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/bandsports" },
  { name: "Combate HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/combate" },
  { name: "SportyNet HD", group: "Futebol & Esportes", url: "https://ww0.embedtv.cc/sportynet" },

  // Variedades & Documentários
  { name: "Multishow HD", group: "Variedades & Shows", url: "https://ww0.embedtv.cc/multishow" },
  { name: "Canal BIS HD", group: "Variedades & Shows", url: "https://ww0.embedtv.cc/bis" },
  { name: "MTV HD", group: "Variedades & Shows", url: "https://ww0.embedtv.cc/mtv" },
  { name: "GNT HD", group: "Variedades & Shows", url: "https://ww0.embedtv.cc/gnt" },
  { name: "Canal OFF HD", group: "Variedades & Shows", url: "https://ww0.embedtv.cc/off" },
  { name: "TLC HD", group: "Variedades & Shows", url: "https://ww0.embedtv.cc/tlc" },
  { name: "Discovery Channel HD", group: "Documentarios", url: "https://ww0.embedtv.cc/discoverychannel" },
  { name: "Discovery Turbo HD", group: "Documentarios", url: "https://ww0.embedtv.cc/discoveryturbo" },
  { name: "Discovery World HD", group: "Documentarios", url: "https://ww0.embedtv.cc/discoveryworld" },
  { name: "Discovery Science HD", group: "Documentarios", url: "https://ww0.embedtv.cc/discoveryscience" },
  { name: "History Channel HD", group: "Documentarios", url: "https://ww0.embedtv.cc/history" },
  { name: "History 2 HD", group: "Documentarios", url: "https://ww0.embedtv.cc/history2" },
  { name: "Animal Planet HD", group: "Documentarios", url: "https://ww0.embedtv.cc/animalplanet" },

  // TV Aberta & Notícias
  { name: "Globo SP HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/globosp" },
  { name: "Globo RJ HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/globorj" },
  { name: "Globo Minas HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/globomg" },
  { name: "SBT HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/sbt" },
  { name: "Record TV HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/record" },
  { name: "Band HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/band" },
  { name: "TV Cultura HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/cultura" },
  { name: "RedeTV! HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/redetv" },
  { name: "TV Aparecida HD", group: "TV Aberta & Noticias", url: "http://45.162.64.114/TV_APARECIDA/tracks-v1a1/mono.ts.m3u8" },
  { name: "GloboNews HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/globonews" },
  { name: "CNN Brasil HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/cnnbrasil" },
  { name: "Record News HD", group: "TV Aberta & Noticias", url: "https://ww0.embedtv.cc/recordnews" }
];

function buildM3u(baseHost) {
  let lines = ['#EXTM3U'];
  for (const c of channels) {
    let playUrl = c.url;
    if (c.url.includes('embedtv.cc/')) {
      const slug = c.url.split('embedtv.cc/')[1];
      playUrl = `https://${baseHost}/live/${slug}.m3u8`;
    }
    lines.push(`#EXTINF:-1 group-title="${c.group}" tvg-name="${c.name}",${c.name}`);
    lines.push(playUrl);
  }
  return lines.join('\n');
}

module.exports = { buildM3u, channels };
