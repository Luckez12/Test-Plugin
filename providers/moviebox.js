const PROVIDER = "MovieBox";
const VERSION = "1.0.1";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const CryptoJS = require("crypto-js");

const API_HOSTS = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com"
];

const PATH_SEARCH = "/wefeed-mobile-bff/subject-api/search";
const PATH_RESOURCE = "/wefeed-mobile-bff/subject-api/resource";
const PATH_BOOTSTRAP = "/wefeed-mobile-bff/tab-operating";
const SECRET_KEY_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const VERSION_CODE = 50020044;
const VERSION_NAME = "3.0.03.0529.03";
const MOBILE_UA = "com.community.oneroom/" + VERSION_CODE + " (Linux; U; Android 13; en_US; 23078RKD5C; Build/TQ2A.230405.003; Cronet/135.0.7012.3)";

var SESSION = {
  token: null,
  deviceId: randomHex(32),
  gaid: randomUuid()
};

function randomHex(length) {
  var out = "";
  while (out.length < length) out += Math.floor(Math.random() * 0x100000000).toString(16);
  return out.slice(0, length);
}

function randomUuid() {
  var h = randomHex(32);
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
}

function fetchJsonSimple(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "unknown") + " " + url);
    return res.text();
  }).then(function (text) {
    return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  });
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();
  try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
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
  return fetchJsonSimple(url, { headers: { "Accept": "application/json" } });
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

function makeClientInfo() {
  return JSON.stringify({
    package_name: "com.community.oneroom",
    version_name: VERSION_NAME,
    version_code: VERSION_CODE,
    os: "android",
    os_version: "13",
    install_ch: "ps",
    device_id: SESSION.deviceId,
    install_store: "ps",
    gaid: SESSION.gaid,
    brand: "Redmi",
    model: "23078RKD5C",
    system_language: "en",
    net: "NETWORK_WIFI",
    region: "US",
    timezone: "America/New_York",
    sp_code: "40401",
    "X-Play-Mode": "2"
  });
}

function paddedBase64(value) {
  var s = String(value || "");
  while (s.length % 4) s += "=";
  return s;
}

function sortedQueryString(url) {
  var query = String(url || "").split("?")[1] || "";
  if (!query) return "";
  var parts = query.split("&").filter(Boolean).map(function (piece) {
    var i = piece.indexOf("=");
    var key = i >= 0 ? piece.slice(0, i) : piece;
    var value = i >= 0 ? piece.slice(i + 1) : "";
    try { key = decodeURIComponent(key); } catch (_) {}
    try { value = decodeURIComponent(value); } catch (_) {}
    return [key, value];
  });
  parts.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return parts.map(function (p) { return p[0] + "=" + p[1]; }).join("&");
}

function pathnameOf(url) {
  var s = String(url || "").replace(/^https?:\/\/[^/]+/i, "");
  return (s.split("?")[0] || "/");
}

function buildSignedHeaders(method, url, body, authToken) {
  var accept = "application/json";
  var contentType = body !== null ? "application/json; charset=utf-8" : "application/json";
  var ts = Date.now();
  var tsStr = String(ts);
  var clientToken = tsStr + "," + CryptoJS.MD5(tsStr.split("").reverse().join("")).toString(CryptoJS.enc.Hex);

  var bodyLength = "";
  var bodyHash = "";
  if (body !== null) {
    var bodyStr = String(body);
    bodyLength = String(unescape(encodeURIComponent(bodyStr)).length);
    bodyHash = CryptoJS.MD5(bodyStr).toString(CryptoJS.enc.Hex);
  }

  var query = sortedQueryString(url);
  var canonicalUrl = pathnameOf(url) + (query ? "?" + query : "");
  var canonical = [String(method).toUpperCase(), accept, contentType, bodyLength, ts, bodyHash, canonicalUrl].join("\n");
  var key = CryptoJS.enc.Base64.parse(paddedBase64(SECRET_KEY_B64));
  var mac = CryptoJS.HmacMD5(canonical, key);
  var signature = tsStr + "|2|" + CryptoJS.enc.Base64.stringify(mac);

  var headers = {
    "User-Agent": MOBILE_UA,
    "Accept": accept,
    "Content-Type": contentType,
    "X-Client-Token": clientToken,
    "x-tr-signature": signature,
    "X-Client-Info": makeClientInfo(),
    "X-Client-Status": "0",
    "X-Play-Mode": "2",
    "Cache-Control": "no-cache"
  };
  if (authToken) headers.Authorization = "Bearer " + authToken;
  return headers;
}

function makeUrl(host, path, params) {
  var pairs = [];
  Object.keys(params || {}).forEach(function (key) {
    pairs.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])));
  });
  return host + path + (pairs.length ? "?" + pairs.join("&") : "");
}

function extractXUserToken(res) {
  try {
    var raw = res && res.headers && res.headers.get ? res.headers.get("x-user") : null;
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.token ? String(parsed.token) : null;
  } catch (_) {
    return null;
  }
}

function signedAttempt(host, path, method, params, bodyObj, token) {
  var url = makeUrl(host, path, params || {});
  var body = bodyObj ? JSON.stringify(bodyObj) : null;
  var headers = buildSignedHeaders(method, url, body, token || null);
  return fetch(url, {
    method: method,
    headers: headers,
    body: body === null ? undefined : body
  }).then(function (res) {
    var freshToken = extractXUserToken(res);
    return res.text().then(function (text) {
      var json = null;
      try { json = JSON.parse(String(text || "").replace(/^\uFEFF/, "")); } catch (_) {}
      return {
        status: res.status,
        ok: !!res.ok,
        token: freshToken,
        json: json,
        url: url
      };
    });
  });
}

function bootstrapToken() {
  if (SESSION.token) return Promise.resolve(SESSION.token);

  function tryHost(i) {
    if (i >= API_HOSTS.length) return Promise.resolve(null);
    var host = API_HOSTS[i];
    return signedAttempt(host, PATH_BOOTSTRAP, "GET", { page: 1, tabId: 0, version: "" }, null, null)
      .then(function (result) {
        if (result.token) {
          SESSION.token = result.token;
          console.log("[MovieBox] auth bootstrap host=" + host + " status=" + result.status + " token=yes");
          return SESSION.token;
        }
        console.log("[MovieBox] auth bootstrap host=" + host + " status=" + result.status + " token=no");
        return tryHost(i + 1);
      })
      .catch(function (error) {
        console.log("[MovieBox] auth bootstrap fail host=" + host + " error=" + (error && error.message ? error.message : String(error)));
        return tryHost(i + 1);
      });
  }

  return tryHost(0);
}

function apiCall(path, method, params, bodyObj) {
  return bootstrapToken().then(function (token) {
    if (!token) throw new Error("auth bootstrap failed");

    function tryHost(i) {
      if (i >= API_HOSTS.length) return Promise.resolve(null);
      var host = API_HOSTS[i];
      return signedAttempt(host, path, method, params, bodyObj, SESSION.token)
        .then(function (result) {
          if (result.token) SESSION.token = result.token;
          var payload = result.json || {};
          if (result.ok && Number(payload.code) === 0) {
            return { host: host, data: payload.data || null };
          }
          console.log("[MovieBox] api fail host=" + host + " path=" + path + " status=" + result.status + " code=" + String(payload.code == null ? "?" : payload.code));
          return tryHost(i + 1);
        })
        .catch(function (error) {
          console.log("[MovieBox] api error host=" + host + " path=" + path + " error=" + (error && error.message ? error.message : String(error)));
          return tryHost(i + 1);
        });
    }

    return tryHost(0);
  });
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
  var matched = (items || []).filter(function (item) { return itemMatches(item, info); });
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

function findSubject(info) {
  var queries = info.titles.length ? info.titles : [info.title];

  function tryQuery(i) {
    if (i >= queries.length) return Promise.resolve(null);
    var query = queries[i];
    return apiCall(PATH_SEARCH, "POST", null, {
      keyword: query,
      page: 1,
      perPage: 20,
      subjectType: 0
    }).then(function (result) {
      var data = result && result.data ? result.data : {};
      var items = Array.isArray(data.items) ? data.items : [];
      var selected = chooseBest(items, info);
      console.log("[MovieBox] mobile search host=" + (result ? result.host : "none") + " query='" + query + "' items=" + items.length + " match=" + (selected ? "yes" : "no"));
      if (selected) return selected;
      return tryQuery(i + 1);
    });
  }

  return tryQuery(0);
}

function fetchResolution(subjectId, mediaType, season, episode, resolution) {
  var se = mediaType === "tv" ? Number(season || 1) : 0;
  var ep = mediaType === "tv" ? Number(episode || 1) : 0;
  return apiCall(PATH_RESOURCE, "GET", {
    subjectId: subjectId,
    se: se,
    ep: ep,
    resolution: resolution,
    page: 1,
    perPage: 10
  }, null).then(function (result) {
    var data = result && result.data ? result.data : {};
    var list = Array.isArray(data.list) ? data.list : [];
    if (mediaType === "tv") {
      list = list.filter(function (item) {
        return Number(item.se) === se && Number(item.ep) === ep;
      });
    }
    console.log("[MovieBox] resource " + resolution + "p host=" + (result ? result.host : "none") + " items=" + list.length);
    return list;
  }).catch(function (error) {
    console.log("[MovieBox] resource " + resolution + "p error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function loadStreams(item, mediaType, season, episode) {
  var subjectId = String(item && item.subjectId || "").trim();
  if (!subjectId) return Promise.resolve([]);
  return Promise.all([
    fetchResolution(subjectId, mediaType, season, episode, 1080),
    fetchResolution(subjectId, mediaType, season, episode, 720),
    fetchResolution(subjectId, mediaType, season, episode, 480),
    fetchResolution(subjectId, mediaType, season, episode, 360)
  ]).then(function (groups) {
    var out = [];
    groups.forEach(function (group) {
      (group || []).forEach(function (entry) { out.push(entry); });
    });
    return out;
  });
}

function formatResults(items) {
  var seenUrl = {};
  var seenQuality = {};
  var sorted = (items || []).slice().sort(function (a, b) {
    return Number(b.resolution || 0) - Number(a.resolution || 0);
  });
  var out = [];

  sorted.forEach(function (item) {
    var url = String(item.resourceLink || item.url || "").trim();
    var resolution = Number(item.resolution || 0);
    var quality = resolution ? resolution + "p" : "Auto";
    if (!/^https?:\/\//i.test(url) || seenUrl[url] || seenQuality[quality]) return;
    seenUrl[url] = true;
    seenQuality[quality] = true;
    out.push({
      name: PROVIDER,
      title: "MovieBox • " + quality + " • MP4",
      url: url,
      quality: quality,
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept": "*/*"
      }
    });
  });
  return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);
  console.log("[MovieBox] TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : ""));

  var info = null;
  return getTmdbDetails(tmdbId, mediaType)
    .then(function (details) {
      info = tmdbInfo(details || {}, mediaType);
      console.log("[MovieBox] title='" + info.title + "' year=" + info.year);
      if (!info.title) return null;
      return findSubject(info);
    })
    .then(function (item) {
      if (!item) {
        console.log("[MovieBox] title not found");
        return null;
      }
      console.log("[MovieBox] matched title='" + String(item.title || "") + "' year=" + parseYear(item.releaseDate) + " id=" + String(item.subjectId || ""));
      return loadStreams(item, mediaType, season, episode);
    })
    .then(function (items) {
      if (!items) return [];
      var streams = formatResults(items);
      console.log("[MovieBox] v" + VERSION + " playable sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[MovieBox] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
