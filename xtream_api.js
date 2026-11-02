const { channels } = require('./playlist_builder');

const categoryMap = {
  "Infantil & Desenhos": "1",
  "Filmes & Series": "2",
  "Futebol & Esportes": "3",
  "Variedades & Shows": "4",
  "Documentarios": "5",
  "TV Aberta & Noticias": "6"
};

const categories = Object.entries(categoryMap).map(([name, id]) => ({
  category_id: id,
  category_name: name,
  parent_id: 0
}));

// Build stream entries
const streams = channels.map((c, idx) => {
  const streamId = 1000 + idx + 1;
  let slug = '';
  if (c.url.includes('embedtv.cc/')) {
    slug = c.url.split('embedtv.cc/')[1];
  }
  return {
    num: idx + 1,
    name: c.name,
    stream_type: "live",
    stream_id: streamId,
    slug: slug,
    direct_url: !slug ? c.url : '',
    stream_icon: "",
    epg_channel_id: null,
    added: "1600000000",
    category_id: categoryMap[c.group] || "2",
    custom_sid: null,
    tv_archive: 0,
    direct_source: "",
    tv_archive_duration: 0
  };
});

function handleXtreamApi(req, res, urlObj, host) {
  const pathname = urlObj.pathname;

  // 1. /player_api.php
  if (pathname === '/player_api.php') {
    const action = urlObj.searchParams.get('action');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!action) {
      // Auth response
      return res.end(JSON.stringify({
        user_info: {
          username: urlObj.searchParams.get('username') || "aoc",
          password: urlObj.searchParams.get('password') || "tv",
          message: "Active subscription",
          auth: 1,
          status: "Active",
          exp_date: "1999999999",
          is_trial: "0",
          active_cons: "0",
          created_at: "1600000000",
          max_connections: "10",
          allowed_output_formats: ["m3u8", "ts"]
        },
        server_info: {
          url: host,
          port: "80",
          https_port: "443",
          server_protocol: "https",
          rtmp_port: "8880",
          timezone: "America/Sao_Paulo",
          time_now: new Date().toISOString().replace('T', ' ').slice(0, 19)
        }
      }));
    }

    if (action === 'get_live_categories') {
      return res.end(JSON.stringify(categories));
    }

    if (action === 'get_live_streams') {
      const catId = urlObj.searchParams.get('category_id');
      const filtered = catId ? streams.filter(s => s.category_id === catId) : streams;
      return res.end(JSON.stringify(filtered));
    }

    if (action === 'get_vod_categories' || action === 'get_series_categories' || action === 'get_vod_streams' || action === 'get_series') {
      return res.end(JSON.stringify([]));
    }

    return res.end(JSON.stringify([]));
  }

  return false;
}

function findStreamById(id) {
  const numId = parseInt(id, 10);
  return streams.find(s => s.stream_id === numId);
}

module.exports = {
  handleXtreamApi,
  findStreamById,
  streams,
  categories
};
