const PROVIDER = "MovieBox";
const VERSION = "1.0.0";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const WEB_HOSTS = [
  "https://moviebox.ph",
  "https://moviebox.pk",
  "https://moviebox.ng",
  "https://filmboom.top"
];
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

function fetchText(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("HTTP " + (res ? res.status : "unknown") + " " + url);
    }
    return res.text();
  });
}

function fetchJson(url, options) {
  return fetchText(url, options).then(function (text) {
    return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  });
}

function commonHeaders(extra) {
  var headers = {
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "X-Client-Info": "{\"timezone\":\"Asia/Kuala_Lumpur\"}",
    "User-Agent": USER_AGENT
  };
  Object.keys(extra || {}).forEach(function (key) {
    headers[key] = extra[key];
  });
  return headers;
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYear(value) {
  var m = String(value || "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}

function uniqueStrings(values) {
  var seen = {};
  var out = [];
  (values || []).forEach(function (value) {
    var clean = String(value || "").trim();
    var key = normalizeTitle(clean);
    if (!clean || !key || seen[key]) return;
    seen[key] = true;
    out.push(clean);
  });
  return out;
}

function getTmdbDetails(tmdbId, mediaType) {
  var path = mediaType === "tv" ? "tv" : "movie";
  var url = TMDB_BASE + "/" + path + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY + "&language=en-US";
  return fetchJson(url, { headers: { "Accept": "application/json" } });
}

function tmdbInfo(details, mediaType) {
  var isTv = mediaType === "tv";
  var title = isTv ? details.name : details.title;
  var original = isTv ? details.original_name : details.original_title;
  var date = isTv ? details.first_air_date : details.release_date;
  return {
    title: String(title || original || "").trim(),
    titles: uniqueStrings([title, original]),
    year: parseYear(date),
    type: mediaType
  };
}

function itemMatches(item, info) {
  if (!item) return false;
  var subjectType = Number(item.subjectType || 0);
  if (info.type === "movie" && subjectType !== 1) return false;
  if (info.type === "tv" && subjectType !== 2) return false;

  var itemTitle = normalizeTitle(item.title);
  var titleMatch = info.titles.some(function (title) {
    return normalizeTitle(title) === itemTitle;
  });
  if (!titleMatch) return false;

  var itemYear = parseYear(item.releaseDate);
  if (info.year && itemYear && Math.abs(info.year - itemYear) > 1) return false;
  return true;
}

function chooseBest(items, info) {
  var matched = (items || []).filter(function (item) {
    return itemMatches(item, info);
  });
  if (!matched.length) return null;

  matched.sort(function (a, b) {
    var ay = parseYear(a.releaseDate);
    var by = parseYear(b.releaseDate);
    var ad = info.year && ay ? Math.abs(info.year - ay) : 99;
    var bd = info.year && by ? Math.abs(info.year - by) : 99;
    return ad - bd;
  });
  return matched[0];
}

function searchOnHost(host, query) {
  var body = JSON.stringify({
    keyword: String(query || "").trim(),
    page: 1,
    perPage: 24,
    subjectType: 0
  });
  return fetchJson(host + "/wefeed-h5-bff/web/subject/search", {
    method: "POST",
    headers: commonHeaders({
      "Content-Type": "application/json",
      "Referer": host + "/"
    }),
    body: body
  }).then(function (json) {
    return json && json.data && Array.isArray(json.data.items) ? json.data.items : [];
  });
}

function findSubject(info) {
  var queries = info.titles.length ? info.titles : [info.title];

  function tryHost(hostIndex) {
    if (hostIndex >= WEB_HOSTS.length) return Promise.resolve(null);
    var host = WEB_HOSTS[hostIndex];

    function tryQuery(queryIndex) {
      if (queryIndex >= queries.length) return tryHost(hostIndex + 1);
      var query = queries[queryIndex];
      return searchOnHost(host, query)
        .then(function (items) {
          var selected = chooseBest(items, info);
          console.log("[MovieBox] search host=" + host + " query='" + query + "' items=" + items.length + " match=" + (selected ? "yes" : "no"));
          if (selected) {
            return { host: host, item: selected };
          }
          return tryQuery(queryIndex + 1);
        })
        .catch(function (error) {
          console.log("[MovieBox] search fail host=" + host + " error=" + (error && error.message ? error.message : String(error)));
          return tryHost(hostIndex + 1);
        });
    }

    return tryQuery(0);
  }

  return tryHost(0);
}

function buildPlayReferer(host, item) {
  var detailPath = String(item && item.detailPath || "").trim();
  var id = String(item && item.subjectId || "").trim();
  if (!detailPath) return host + "/";
  return host + "/spa/videoPlayPage/movies/" + detailPath + "?id=" + encodeURIComponent(id) + "&type=/movie/detail&lang=en";
}

function loadStreamsFromHost(host, item, mediaType, season, episode) {
  var subjectId = String(item && item.subjectId || "").trim();
  if (!subjectId) return Promise.resolve([]);

  var se = mediaType === "tv" ? Number(season || 1) : 0;
  var ep = mediaType === "tv" ? Number(episode || 1) : 0;
  var referer = buildPlayReferer(host, item);
  var url = host + "/wefeed-h5-bff/web/subject/play?subjectId=" + encodeURIComponent(subjectId) + "&se=" + se + "&ep=" + ep;

  return fetchJson(url, {
    headers: commonHeaders({ "Referer": referer })
  }).then(function (json) {
    var streams = json && json.data && Array.isArray(json.data.streams) ? json.data.streams : [];
    streams = streams.filter(function (stream) {
      return stream && /^https?:\/\//i.test(String(stream.url || ""));
    });
    console.log("[MovieBox] play host=" + host + " streams=" + streams.length);
    return streams.map(function (stream) {
      return { host: host, referer: referer, stream: stream };
    });
  });
}

function loadPlayable(result, mediaType, season, episode) {
  var ordered = [result.host].concat(WEB_HOSTS.filter(function (host) {
    return host !== result.host;
  }));

  function tryHost(index) {
    if (index >= ordered.length) return Promise.resolve([]);
    var host = ordered[index];
    return loadStreamsFromHost(host, result.item, mediaType, season, episode)
      .then(function (streams) {
        if (streams.length) return streams;
        return tryHost(index + 1);
      })
      .catch(function (error) {
        console.log("[MovieBox] play fail host=" + host + " error=" + (error && error.message ? error.message : String(error)));
        return tryHost(index + 1);
      });
  }

  return tryHost(0);
}

function qualityOf(value) {
  var text = String(value || "").toLowerCase();
  var m = text.match(/(2160|1440|1080|720|480|360)/);
  if (m) return m[1] + "p";
  if (/4k/.test(text)) return "2160p";
  return "Auto";
}

function streamFormat(stream) {
  var value = String(stream && stream.format || "").trim().toUpperCase();
  if (value) return value;
  var url = String(stream && stream.url || "");
  if (/\.m3u8(?:$|\?)/i.test(url)) return "HLS";
  if (/\.mp4(?:$|\?)/i.test(url)) return "MP4";
  return "Stream";
}

function formatResults(resolved) {
  var seen = {};
  var out = [];

  (resolved || []).forEach(function (entry) {
    var source = entry.stream || {};
    var url = String(source.url || "").trim();
    if (!url || seen[url]) return;
    seen[url] = true;

    var quality = qualityOf(source.resolutions || url);
    out.push({
      name: PROVIDER,
      title: "MovieBox • " + quality + " • " + streamFormat(source),
      url: url,
      quality: quality,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Referer": entry.referer
      }
    });
  });

  out.sort(function (a, b) {
    return Number(String(b.quality).replace(/[^0-9]/g, "") || 0) - Number(String(a.quality).replace(/[^0-9]/g, "") || 0);
  });
  return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);

  console.log("[MovieBox] TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : ""));

  return getTmdbDetails(tmdbId, mediaType)
    .then(function (details) {
      var info = tmdbInfo(details || {}, mediaType);
      console.log("[MovieBox] title='" + info.title + "' year=" + info.year);
      if (!info.title) return null;
      return findSubject(info);
    })
    .then(function (result) {
      if (!result || !result.item) {
        console.log("[MovieBox] title not found");
        return null;
      }
      console.log("[MovieBox] matched title='" + String(result.item.title || "") + "' year=" + parseYear(result.item.releaseDate) + " id=" + String(result.item.subjectId || "") + " host=" + result.host);
      return loadPlayable(result, mediaType, season, episode);
    })
    .then(function (resolved) {
      if (!resolved) return [];
      var streams = formatResults(resolved);
      console.log("[MovieBox] v" + VERSION + " playable sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[MovieBox] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
