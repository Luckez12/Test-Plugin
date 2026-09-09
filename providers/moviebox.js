const PROVIDER = "MovieBox";
const VERSION = "1.1.3";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var CryptoJS = null;

function getCryptoJS() {
  if (!CryptoJS) CryptoJS = require("crypto-js");
  return CryptoJS;
}

const API_HOSTS = [
  "https://api.inmoviebox.com",
  "https://apii.inmoviebox.com",
  "https://i-api.aoneroom.com",
  "https://api.aoneroom.com",
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com"
];

const PATH_SEARCH = "/wefeed-mobile-bff/subject-api/search";
const PATH_RESOURCE = "/wefeed-mobile-bff/subject-api/resource";
const PATH_PLAY_INFO = "/wefeed-mobile-bff/subject-api/play-info";
const PATH_BOOTSTRAP = "/wefeed-mobile-bff/tab-operating";
const SECRET_KEY_B64 = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const VERSION_CODE = 50020044;
const VERSION_NAME = "3.0.03.0529.03";
const MOBILE_UA = "com.community.oneroom/" + VERSION_CODE + " (Linux; U; Android 13; en_US; 23078RKD5C; Build/TQ2A.230405.003; Cronet/135.0.7012.3)";
const FORWARDED_IP = "";

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
    sp_code: "90101",
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
  var CryptoJS = getCryptoJS();
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
  if (FORWARDED_IP) headers["X-Forwarded-For"] = FORWARDED_IP;
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
  var targetSe = mediaType === "tv" ? Number(season || 1) : 0;
  var targetEp = mediaType === "tv" ? Number(episode || 1) : 0;

  function fetchPage(page, acc) {
    // Current MovieBox Android API is most reliable when se=0&ep=0 is used
    // to fetch the resource pack, then the requested TV episode is filtered locally.
    return apiCall(PATH_RESOURCE, "GET", {
      subjectId: subjectId,
      se: 0,
      ep: 0,
      resolution: resolution,
      page: page,
      perPage: 10
    }, null).then(function (result) {
      var data = result && result.data ? result.data : {};
      var list = Array.isArray(data.list) ? data.list : [];
      list.forEach(function (item) {
        item._requestedResolution = resolution;
        item._apiHost = result ? result.host : "";
        if (!Number(item.resolution)) item.resolution = resolution;
        acc.push(item);
      });
      var hasMore = !!(data.pager && data.pager.hasMore);
      if (hasMore && page < 20) return fetchPage(page + 1, acc);
      return { host: result ? result.host : "none", items: acc };
    });
  }

  return fetchPage(1, []).then(function (result) {
    var list = result.items || [];
    if (mediaType === "tv") {
      list = list.filter(function (item) {
        return Number(item.se) === targetSe && Number(item.ep) === targetEp;
      });
    }
    console.log("[MovieBox] resource " + resolution + "p host=" + result.host + " items=" + list.length + " region=US sp=90101");
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

function candidateDuration(item) {
  var n = Number(item && item.duration || 0);
  return isFinite(n) && n > 0 ? n : 0;
}

function candidateSize(item) {
  var raw = String(item && item.size || "").trim();
  var n = parseInt(raw, 10);
  return isFinite(n) && n > 0 ? n : 0;
}

function isNoticeCandidate(item) {
  var text = String(item && item.title || "").toLowerCase();
  return /install(?:ation)?|official\s*notice|update\s*(?:the\s*)?app|download\s*(?:the\s*)?(?:latest\s*)?(?:version|app)|uninstall/.test(text);
}

function candidateScore(item) {
  var score = 0;
  if (isNoticeCandidate(item)) score -= 1000000000000;
  score += candidateDuration(item) * 1000000;
  score += candidateSize(item);
  return score;
}

function parseTotalBytesFromHeaders(res) {
  try {
    if (!res || !res.headers || !res.headers.get) return 0;
    var cr = String(res.headers.get("content-range") || "");
    var m = cr.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]) || 0;
    var cl = Number(res.headers.get("content-length") || 0);
    return isFinite(cl) && cl > 0 ? cl : 0;
  } catch (_) {
    return 0;
  }
}

function probeCandidate(item, index) {
  var url = String(item && (item.resourceLink || item.url) || "").trim();
  if (!/^https?:\/\//i.test(url)) return Promise.resolve({ item: item, bytes: 0, status: 0, index: index });

  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": MOBILE_UA,
      "Accept": "*/*",
      "Range": "bytes=0-0"
    }
  }).then(function (res) {
    var bytes = parseTotalBytesFromHeaders(res);
    console.log("[MovieBox] CDN probe #" + index + " status=" + res.status +
      " totalMB=" + (bytes ? Math.round(bytes / 1048576) : 0) +
      " apiDuration=" + candidateDuration(item) +
      " apiSize=" + candidateSize(item) +
      " resolution=" + Number(item.resolution || item._requestedResolution || 0));
    return { item: item, bytes: bytes, status: res.status, index: index };
  }).catch(function (error) {
    console.log("[MovieBox] CDN probe #" + index + " fail=" + (error && error.message ? error.message : String(error)));
    return { item: item, bytes: 0, status: 0, index: index };
  });
}

function uniqueCandidates(items) {
  var seen = {};
  var out = [];
  (items || []).forEach(function (item) {
    var url = String(item && (item.resourceLink || item.url) || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    var rid = String(item && item.resourceId || "").trim();
    var key = rid ? "rid:" + rid : "url:" + url;
    if (seen[key]) return;
    seen[key] = true;
    out.push(item);
  });
  return out;
}


function isPlayableMediaUrl(url) {
  var s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  return /(?:\.m3u8|\.mp4|\.m4v|\.mpd|\/resource\/|hakunaymatata\.com|aoneroom\.com\/.*(?:video|stream))/i.test(s);
}

function collectPlayableUrls(value, out, depth) {
  out = out || [];
  depth = Number(depth || 0);
  if (depth > 6 || value == null) return out;
  if (typeof value === "string") {
    if (isPlayableMediaUrl(value) && out.indexOf(value) < 0) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(function (v) { collectPlayableUrls(v, out, depth + 1); });
    return out;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      var v = value[key];
      if (typeof v === "string" && /^(?:url|streamUrl|playUrl|videoUrl|file|src|link|resourceLink|downloadUrl)$/i.test(key)) {
        if (isPlayableMediaUrl(v) && out.indexOf(v) < 0) out.push(v);
      } else if (v && (typeof v === "object" || Array.isArray(v))) {
        collectPlayableUrls(v, out, depth + 1);
      }
    });
  }
  return out;
}

function candidateRank(a, b) {
  var am = Number(a && a.requireMemberType || 0);
  var bm = Number(b && b.requireMemberType || 0);
  if (am !== bm) return am - bm;
  var ar = Number(a && (a.resolution || a._requestedResolution) || 0);
  var br = Number(b && (b.resolution || b._requestedResolution) || 0);
  if (ar !== br) return br - ar;
  var ad = candidateDuration(a), bd = candidateDuration(b);
  if (ad !== bd) return bd - ad;
  return candidateSize(b) - candidateSize(a);
}

function resolveViaPlayInfo(items, subjectId, mediaType, season, episode) {
  var candidates = uniqueCandidates(items).slice().sort(candidateRank).slice(0, 6);
  if (!candidates.length) return Promise.resolve([]);
  var se = mediaType === "tv" ? Number(season || 1) : 0;
  var ep = mediaType === "tv" ? Number(episode || 1) : 0;

  function tryCandidate(i) {
    if (i >= candidates.length) return Promise.resolve([]);
    var item = candidates[i];
    var resolution = Number(item.resolution || item._requestedResolution || 0);
    var resourceId = String(item.resourceId || "").trim();
    if (!resourceId) return tryCandidate(i + 1);

    console.log("[MovieBox] candidate #" + (i + 1) +
      " resourceId=" + resourceId +
      " q=" + resolution +
      " member=" + Number(item.requireMemberType || 0) +
      " linkType=" + Number(item.linkType || 0) +
      " apiMB=" + Math.round(candidateSize(item) / 1048576));

    function callPlayInfo(qualityValue, secondTry) {
      return apiCall(PATH_PLAY_INFO, "GET", {
        subjectId: subjectId,
        se: se,
        ep: ep,
        quality: qualityValue,
        resourceId: resourceId
      }, null).then(function (result) {
        var data = result && result.data ? result.data : null;
        var urls = collectPlayableUrls(data, [], 0);
        console.log("[MovieBox] play-info resourceId=" + resourceId +
          " quality=" + String(qualityValue) +
          " host=" + (result ? result.host : "none") +
          " urls=" + urls.length);
        if (!urls.length && !secondTry && resolution) {
          return callPlayInfo(resolution + "p", true);
        }
        if (!urls.length) return tryCandidate(i + 1);

        var url = urls[0];
        var quality = resolution ? resolution + "p" : "Auto";
        console.log("[MovieBox] selected play-info stream q=" + quality +
          " resourceId=" + resourceId +
          " cdn=" + String(url).replace(/^https?:\/\//i, "").split("/")[0]);
        return [{
          name: PROVIDER,
          title: "MovieBox • " + quality + " • Direct",
          url: url,
          quality: quality,
          headers: {
            "User-Agent": "ExoPlayerLib/2.19.1",
            "Accept": "*/*",
            "Referer": "https://api6.aoneroom.com/"
          }
        }];
      }).catch(function (error) {
        console.log("[MovieBox] play-info error resourceId=" + resourceId +
          " error=" + (error && error.message ? error.message : String(error)));
        return tryCandidate(i + 1);
      });
    }

    return callPlayInfo(resolution || 720, false);
  }

  return tryCandidate(0);
}


function extractPlayInfoStreams(data, fallbackResolution, resourceId) {
  var out = [];
  if (!data || typeof data !== "object") return out;
  var signCookie = String(data.signCookie || data.cookie || "").trim();
  var list = Array.isArray(data.streamList) ? data.streamList : [];
  list.forEach(function (stream) {
    if (!stream || typeof stream !== "object") return;
    var url = String(stream.url || stream.streamUrl || stream.playUrl || stream.file || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    var q = Number(stream.resolution || stream.quality || fallbackResolution || 0);
    if (!isFinite(q)) q = Number(fallbackResolution || 0);
    var headers = {
      "User-Agent": "ExoPlayerLib/2.19.1",
      "Accept": "*/*"
    };
    if (/hakunaymatata\.com/i.test(url)) headers.Referer = "https://www.movieboxpro.app/";
    if (signCookie) headers.Cookie = signCookie;
    out.push({
      name: PROVIDER,
      title: "MovieBox • " + (q ? q + "p" : "Auto") + " • PlayInfo",
      url: url,
      quality: q ? q + "p" : "Auto",
      headers: headers,
      _resourceId: resourceId || ""
    });
  });
  return out;
}

function resolveCurrentPlayInfo(items, subjectId, mediaType, season, episode) {
  var candidates = uniqueCandidates(items).slice().sort(candidateRank).slice(0, 5);
  if (!candidates.length) return Promise.resolve([]);
  var se = mediaType === "tv" ? Number(season || 1) : 0;
  var ep = mediaType === "tv" ? Number(episode || 1) : 0;

  function tryOne(i) {
    if (i >= candidates.length) return Promise.resolve([]);
    var item = candidates[i];
    var resourceId = String(item.resourceId || "").trim();
    if (!resourceId) return tryOne(i + 1);
    var resolution = Number(item.resolution || item._requestedResolution || 0) || 0;
    var apiHost = String(item._apiHost || API_HOSTS[0]);
    var apiHostName = apiHost.replace(/^https?:\/\//i, "");
    return apiCall(PATH_PLAY_INFO, "GET", {
      subjectId: subjectId,
      se: se,
      ep: ep,
      quality: resolution || 720,
      resourceId: resourceId,
      host: apiHostName
    }, null).then(function (result) {
      var data = result && result.data ? result.data : {};
      var streams = extractPlayInfoStreams(data, resolution, resourceId);
      console.log("[MovieBox] play-info resourceId=" + resourceId +
        " host=" + (result ? result.host : "none") +
        " apiHost=" + apiHostName +
        " streams=" + streams.length +
        " cookie=" + (data && (data.signCookie || data.cookie) ? "yes" : "no"));
      if (streams.length) return streams;
      return tryOne(i + 1);
    }).catch(function (error) {
      console.log("[MovieBox] play-info error resourceId=" + resourceId + " error=" + (error && error.message ? error.message : String(error)));
      return tryOne(i + 1);
    });
  }
  return tryOne(0);
}

function hostOf(url) {
  return String(url || "").replace(/^https?:\/\//i, "").split("/")[0];
}

function qualityName(value) {
  var q = Number(value || 0);
  if (q >= 2160) return "4K";
  return q ? q + "p" : "Auto";
}

function waitMs(ms, value) {
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(value); }, ms);
  });
}

function directCandidateScore(item) {
  var score = 0;
  var resolution = Number(item && (item.resolution || item._requestedResolution) || 0);
  var member = Number(item && item.requireMemberType || 0);
  var linkType = Number(item && item.linkType || 0);
  if (member === 0) score += 1000000000000;
  else score -= member * 100000000000;
  if (linkType === 1) score += 50000000000;
  score += resolution * 100000000;
  score += candidateDuration(item) * 10000;
  score += candidateSize(item);
  return score;
}

function resolveDirectResources(items, mediaType) {
  var unique = uniqueCandidates(items).filter(function (item) {
    return /^https?:\/\//i.test(String(item && item.resourceLink || ""));
  });
  if (!unique.length) return Promise.resolve([]);

  unique.sort(function (a, b) { return directCandidateScore(b) - directCandidateScore(a); });

  // Keep the best candidate per quality first. This mirrors the current
  // resourceLink flow and avoids returning duplicate mirrors for one quality.
  var byQuality = {};
  unique.forEach(function (item) {
    var q = Number(item.resolution || item._requestedResolution || 0) || 0;
    if (!byQuality[q]) byQuality[q] = item;
  });
  var selected = Object.keys(byQuality).map(function (q) { return byQuality[q]; })
    .sort(function (a, b) { return Number(b.resolution || b._requestedResolution || 0) - Number(a.resolution || a._requestedResolution || 0); })
    .slice(0, 4);

  return Promise.all(selected.map(function (item, i) {
    return probeCandidate(item, i + 1);
  })).then(function (probes) {
    var minBytes = mediaType === "movie" ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
    var streams = [];

    probes.forEach(function (p) {
      var item = p.item || {};
      var apiBytes = candidateSize(item);
      var actualBytes = Number(p.bytes || 0);
      var validStatus = p.status === 200 || p.status === 206;
      var tinyMismatch = apiBytes >= 50 * 1024 * 1024 && actualBytes > 0 && actualBytes < minBytes;
      var likelyFull = actualBytes >= minBytes || (actualBytes === 0 && apiBytes >= minBytes);
      var qn = Number(item.resolution || item._requestedResolution || 0);
      console.log("[MovieBox] direct check q=" + qn +
        " host=" + hostOf(item.resourceLink) +
        " apiMB=" + Math.round(apiBytes / 1048576) +
        " actualMB=" + (actualBytes ? Math.round(actualBytes / 1048576) : 0) +
        " ok=" + (validStatus && likelyFull && !tinyMismatch));
      if (!validStatus || tinyMismatch || !likelyFull) return;

      streams.push({
        name: PROVIDER,
        title: "MovieBox • " + (qn ? qn + "p" : "Auto") + " • Direct",
        url: String(item.resourceLink),
        quality: qn ? qn + "p" : "Auto",
        headers: {
          "User-Agent": MOBILE_UA,
          "Accept": "*/*"
        }
      });
    });

    console.log("[MovieBox] direct verified=" + streams.length + "/" + probes.length);
    return streams;
  });
}

function selectPlayableByActualSize(items, mediaType) {
  var unique = uniqueCandidates(items);
  if (!unique.length) return Promise.resolve([]);

  // Current MovieBox responses can include a short official install/update
  // notice beside the real movie. Metadata is not always reliable, so probe
  // the signed CDN URLs and rank using the real file size from Content-Range.
  var probeList = unique.slice(0, 8);
  return Promise.all(probeList.map(function (item, i) {
    return probeCandidate(item, i + 1);
  })).then(function (results) {
    var usable = results.filter(function (r) {
      return r && r.item && !isNoticeCandidate(r.item) && (r.status === 200 || r.status === 206 || r.bytes > 0);
    });
    if (!usable.length) usable = results.filter(function (r) { return r && r.item; });
    if (!usable.length) return [];

    usable.sort(function (a, b) {
      var byteDiff = Number(b.bytes || 0) - Number(a.bytes || 0);
      if (byteDiff) return byteDiff;
      var durationDiff = candidateDuration(b.item) - candidateDuration(a.item);
      if (durationDiff) return durationDiff;
      return candidateSize(b.item) - candidateSize(a.item);
    });

    var best = usable[0];
    var item = best.item;
    var url = String(item.resourceLink || item.url || "").trim();
    var resolution = Number(item.resolution || item._requestedResolution || 0);
    var quality = resolution ? resolution + "p" : "Auto";
    var actualMb = best.bytes ? Math.round(best.bytes / 1048576) : 0;

    // If there is a clearly full-length candidate, never return tiny notice clips.
    var fullThreshold = mediaType === "movie" ? 25 * 1024 * 1024 : 12 * 1024 * 1024;
    var hasFull = usable.some(function (r) { return Number(r.bytes || 0) >= fullThreshold; });
    if (hasFull && Number(best.bytes || 0) < fullThreshold) return [];

    console.log("[MovieBox] selected actual stream index=" + best.index +
      " quality=" + quality + " actualMB=" + actualMb +
      " duration=" + candidateDuration(item) +
      " resourceId=" + String(item.resourceId || "?"));

    return [{
      name: PROVIDER,
      title: "MovieBox • " + quality + " • MP4",
      url: url,
      quality: quality,
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept": "*/*"
      }
    }];
  });
}
function verifyFastDirectCandidate(item, mediaType, index) {
  return probeCandidate(item, index).then(function (p) {
    var apiBytes = candidateSize(item);
    var actualBytes = Number(p.bytes || 0);
    var minBytes = mediaType === "movie" ? 20 * 1024 * 1024 : 8 * 1024 * 1024;
    var validStatus = p.status === 200 || p.status === 206;
    var tinyMismatch = apiBytes >= 50 * 1024 * 1024 && actualBytes > 0 && actualBytes < minBytes;
    var likelyFull = actualBytes >= minBytes || (actualBytes === 0 && apiBytes >= minBytes);
    var qn = Number(item.resolution || item._requestedResolution || 0);
    var ok = validStatus && likelyFull && !tinyMismatch;

    console.log("[MovieBox] fast direct check q=" + qn +
      " host=" + hostOf(item.resourceLink) +
      " apiMB=" + Math.round(apiBytes / 1048576) +
      " actualMB=" + (actualBytes ? Math.round(actualBytes / 1048576) : 0) +
      " ok=" + ok);

    if (!ok) return null;
    var qLabel = qualityName(qn);
    return {
      name: PROVIDER,
      title: "MovieBox • " + qLabel + " • Direct",
      url: String(item.resourceLink),
      quality: qLabel,
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept": "*/*"
      }
    };
  });
}

var fastVerifyCache = {};

function candidateFingerprint(item) {
  var url = String(item && item.resourceLink || "");
  var q = Number(item && (item.resolution || item._requestedResolution) || 0);
  var size = candidateSize(item);
  var duration = candidateDuration(item);
  var host = hostOf(url);
  var rid = String(item && item.resourceId || "").trim();

  // MovieBox frequently returns the same underlying file with a different
  // signed URL/resourceId for 2160/1080/720 requests. The stable media
  // metadata is a better de-duplication key than the signed URL.
  return [
    q,
    size,
    duration,
    host,
    rid && !size && !duration ? rid : ""
  ].join("|");
}

function verifyCachedCandidate(item, mediaType, index) {
  var url = String(item && item.resourceLink || "");
  if (!url) return Promise.resolve(null);
  var key = candidateFingerprint(item);
  if (!fastVerifyCache[key]) {
    fastVerifyCache[key] = verifyFastDirectCandidate(item, mediaType, index);
  } else {
    console.log("[MovieBox] reuse media fingerprint q=" +
      qualityName(Number(item.resolution || item._requestedResolution || 0)) +
      " host=" + hostOf(url));
  }
  return fastVerifyCache[key];
}

function resolveFastQuality(subjectId, mediaType, season, episode, resolution) {
  return fetchResolution(subjectId, mediaType, season, episode, resolution).then(function (items) {
    var candidates = uniqueCandidates(items).filter(function (item) {
      return /^https?:\/\//i.test(String(item && item.resourceLink || ""));
    }).sort(function (a, b) {
      return directCandidateScore(b) - directCandidateScore(a);
    }).slice(0, 2);

    var actualQualities = [];
    candidates.forEach(function (item) {
      var q = qualityName(Number(item.resolution || item._requestedResolution || 0));
      if (actualQualities.indexOf(q) < 0) actualQualities.push(q);
    });
    console.log("[MovieBox] request " + qualityName(resolution) +
      " candidates=" + candidates.length +
      " actual=" + (actualQualities.length ? actualQualities.join(",") : "none"));
    if (!candidates.length) return null;

    function tryCandidate(i) {
      if (i >= candidates.length) return Promise.resolve(null);
      return verifyCachedCandidate(candidates[i], mediaType, i + 1).then(function (stream) {
        if (stream) {
          console.log("[MovieBox] READY q=" + stream.quality +
            " candidate=" + (i + 1) +
            " host=" + hostOf(stream.url));
          return stream;
        }
        return tryCandidate(i + 1);
      });
    }

    return tryCandidate(0);
  }).catch(function (error) {
    console.log("[MovieBox] quality " + qualityName(resolution) +
      " error=" + (error && error.message ? error.message : String(error)));
    return null;
  });
}

function multiQualityFastDirect(subjectId, mediaType, season, episode) {
  fastVerifyCache = {};

  // MovieBox currently returns the same resource set for 2160/1080/720.
  // Fetch once, then trust each item's actual resolution.
  return fetchResolution(subjectId, mediaType, season, episode, 2160).then(function (items) {
    var candidates = uniqueCandidates(items).filter(function (item) {
      return /^https?:\/\//i.test(String(item && item.resourceLink || ""));
    }).sort(function (a, b) {
      var qa = Number(a && (a.resolution || a._requestedResolution) || 0);
      var qb = Number(b && (b.resolution || b._requestedResolution) || 0);
      if (qb !== qa) return qb - qa;
      return directCandidateScore(b) - directCandidateScore(a);
    });

    var seen = {};
    var unique = [];
    candidates.forEach(function (item) {
      var fp = candidateFingerprint(item);
      if (seen[fp]) return;
      seen[fp] = true;
      unique.push(item);
    });

    var actual = [];
    unique.forEach(function (item) {
      var q = qualityName(Number(item.resolution || item._requestedResolution || 0));
      if (actual.indexOf(q) < 0) actual.push(q);
    });

    console.log("[MovieBox] single resource request items=" + items.length +
      " unique=" + unique.length +
      " actual=" + (actual.length ? actual.join(",") : "none"));

    function tryCandidate(i) {
      if (i >= unique.length) return Promise.resolve([]);
      return verifyCachedCandidate(unique[i], mediaType, 1).then(function (stream) {
        if (stream) {
          console.log("[MovieBox] READY q=" + stream.quality +
            " host=" + hostOf(stream.url));
          return [stream];
        }
        return tryCandidate(i + 1);
      });
    }

    return tryCandidate(0);
  }).catch(function (error) {
    console.log("[MovieBox] single resource error=" +
      (error && error.message ? error.message : String(error)));
    return [];
  }).then(function (streams) {
    streams = streams || [];
    if (streams.length) {
      console.log("[MovieBox] fast ready=" + streams.map(function (s) {
        return s.quality + ":" + hostOf(s.url);
      }).join(","));
      return streams;
    }

    function fallback(list, i) {
      if (i >= list.length) return Promise.resolve([]);
      return resolveFastQuality(subjectId, mediaType, season, episode, list[i]).then(function (stream) {
        return stream ? [stream] : fallback(list, i + 1);
      });
    }
    return fallback([1080, 720, 480], 0);
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var startedAt = Date.now();
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);
  console.log("[MovieBox] v" + VERSION + " TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : "") + " region=US sp=90101 multiQuality=true");

  var info = null;
  var matchedSubjectId = null;
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
        return [];
      }
      matchedSubjectId = String(item.subjectId || "").trim();
      console.log("[MovieBox] matched title='" + String(item.title || "") + "' year=" + parseYear(item.releaseDate) + " id=" + matchedSubjectId);
      return multiQualityFastDirect(matchedSubjectId, mediaType, season, episode);
    })
    .then(function (streams) {
      streams = streams || [];
      console.log("[MovieBox] v" + VERSION +
        " playable sources=" + streams.length +
        " elapsed=" + (Date.now() - startedAt) + "ms");
      return streams;
    })
    .catch(function (error) {
      console.log("[MovieBox] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
