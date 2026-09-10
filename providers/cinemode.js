"use strict";

var PROVIDER = "CineMode";
var VERSION = "2.1.7";
var BASE = "https://cinemode.fun";
var TMDB_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var UA =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var BUDGET_MS = 9300;
var PAGE_TIMEOUT_MS = 3000;
var BUNDLE_TIMEOUT_MS = 1350;
var ROUTE_WEBVIEW_MS = 3900;
var PLAYER_WEBVIEW_MS = 5200;
var VERIFY_MS = 900;

var MEDIA_RE = /\.(?:m3u8|mp4|m4v|webm)(?:$|[?#])/i;
var HLS_RE = /\.m3u8(?:$|[?#])/i;

var BLOCKED = [
  "effectivecpmnetwork",
  "doubleclick",
  "googlesyndication",
  "googleadservices",
  "adservice.google",
  "popads",
  "popcash",
  "propellerads",
  "onclicka",
  "adsterra",
  "exoclick",
  "/ads/",
  "/vast"
];

var PLAYER_HINTS = [
  ".m3u8",
  ".mp4",
  ".m4v",
  ".webm",
  "/embed/",
  "/embed-",
  "/player/",
  "/watch/",
  "/sora/",
  "vidsrc",
  "vidlink",
  "vidfast",
  "autoembed",
  "2embed",
  "embedsu",
  "multiembed",
  "player4u",
  "moviesapi",
  "superembed",
  "smashystream",
  "streamwish",
  "filelions",
  "streamtape",
  "abyss",
  "video"
];

var ZXC_MATCH = [
  ".m3u8",
  ".mp4",
  ".m4v",
  ".webm",
  "workers.dev",
  "berkas.",
  "valstrax.",
  "burat.",
  "zinogre.",
  "daedalus.",
  "/backend_/sources/",
  "/api/",
  "/source",
  "/sources",
  "/playlist",
  "/manifest",
  "/master",
  "/playback",
  "/hls/",
  "/stream/",
  "/streams/",
  "getsource",
  "get-source"
];


/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function sharedTmdb(url, fallback) {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.vueoDiscoveryContext === "function"
  ) {
    return globalThis.vueoDiscoveryContext(url)
      .then(function(ctx) {
        if (ctx && ctx.tmdb) return ctx.tmdb;
        throw new Error("empty shared TMDB");
      })
      .catch(fallback);
  }
  return fallback();
}

function timeout(promise, ms, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error((label || "operation") + " timeout"));
    }, Math.max(1, Number(ms || 1)));

    Promise.resolve(promise).then(
      function(value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      function(error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function blocked(url) {
  var s = String(url || "").toLowerCase();
  for (var i = 0; i < BLOCKED.length; i++) {
    if (s.indexOf(BLOCKED[i]) !== -1) return true;
  }
  return false;
}

function hostOf(url) {
  try { return new URL(String(url || "")).hostname.toLowerCase(); }
  catch (_) { return ""; }
}

function originOf(url) {
  try { return new URL(String(url || "")).origin; }
  catch (_) { return ""; }
}

function absUrl(value, base) {
  var s = String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .trim();

  if (!s || /^javascript:|^data:/i.test(s)) return "";
  try { return new URL(s, base || BASE + "/").toString(); }
  catch (_) { return ""; }
}

function fetchText(url, ms, headers) {
  var h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/"
  };
  Object.keys(headers || {}).forEach(function(k) { h[k] = headers[k]; });

  return timeout(
    fetch(url, { method: "GET", headers: h, redirect: "follow" })
      .then(function(res) {
        return res.text().then(function(text) {
          return {
            ok: res.ok,
            status: res.status,
            url: res.url || url,
            text: String(text || ""),
            headers: res.headers
          };
        });
      }),
    ms,
    "fetch"
  );
}

function fetchJson(url, ms) {
  return timeout(
    fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      redirect: "follow"
    }).then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }),
    ms,
    "json"
  );
}

function tmdbInfo(id, type) {
  var endpoint = type === "tv" ? "tv" : "movie";
  var url =
    "https://api.themoviedb.org/3/" + endpoint + "/" +
    encodeURIComponent(id) +
    "?api_key=" + TMDB_KEY;

  return sharedTmdb(url, function() {
    return fetchJson(url, 1500);
  }).then(function(data) {
    return {
      title: String(data && (data.title || data.name) || "").trim(),
      year: String(data && (data.release_date || data.first_air_date) || "").split("-")[0]
    };
  });
}


function zxcPlayerUrls(id, type, season, episode) {
  var base =
    type === "tv"
      ? "https://zxcstream.xyz/player/tv/" +
        encodeURIComponent(id) + "/" +
        encodeURIComponent(season) + "/" +
        encodeURIComponent(episode)
      : "https://zxcstream.xyz/player/movie/" +
        encodeURIComponent(id);

  return [
    base + "?autoplay=true&server=1",
    base + "?autoplay=true&server=2"
  ];
}

function isZxc(url) {
  return /(?:^|\.)zxc(?:stream|prime)\.xyz$/i.test(hostOf(url)) ||
         /(?:^|\.)player\.zxc(?:stream|prime)\.xyz$/i.test(hostOf(url));
}

function isWorkerBootstrap(url) {
  var h = hostOf(url);
  return /(?:^|\.)workers\.dev$/i.test(h) ||
         /(?:^|\.)(?:berkas|valstrax|burat|zinogre|daedalus)\./i.test(h);
}


function isStaticAssetUrl(url) {
  var s = String(url || "");
  var path = "";
  try { path = new URL(s).pathname.toLowerCase(); }
  catch (_) { path = s.toLowerCase(); }

  if (/\/_next\/static\//i.test(path)) return true;
  if (/\/static\/(?:media|chunks|css)\//i.test(path)) return true;
  if (/\.(?:woff2?|ttf|otf|eot|css|js|map|png|jpe?g|gif|svg|ico|avif|webp)(?:$|[?#])/i.test(path)) {
    return true;
  }
  return false;
}

function likelySourceEndpoint(url) {
  if (isStaticAssetUrl(url)) return false;

  try {
    var u = new URL(String(url || ""));
    var target = (u.pathname + "?" + u.searchParams.toString()).toLowerCase();

    return (
      /\/api\/|\/source(?:s)?(?:\/|$)|\/playlist(?:\/|$)|\/manifest(?:\/|$)|\/master(?:\/|$)|\/playback(?:\/|$)|\/hls\/|\/stream(?:s)?(?:\/|$)|getsource|get-source/.test(target)
    );
  } catch (_) {
    return false;
  }
}

function routeUrl(id, type) {
  return BASE + "/" + (type === "tv" ? "tv" : "movie") + "/" + encodeURIComponent(id);
}

function visibleText(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function pageMatches(html, info, id) {
  var raw = String(html || "");
  if (!raw) return false;
  if (raw.indexOf(String(id)) !== -1) return true;

  var text = visibleText(raw);
  var title = String(info && info.title || "").toLowerCase();
  var year = String(info && info.year || "");
  return !!title &&
    text.indexOf(title) !== -1 &&
    (!year || raw.indexOf(year) !== -1 || text.indexOf(year) !== -1);
}

function scriptUrls(html, pageUrl) {
  var out = [];
  var seen = {};
  var re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  var m;

  while ((m = re.exec(String(html || ""))) !== null) {
    var u = absUrl(m[1], pageUrl);
    if (!u || seen[u] || blocked(u)) continue;
    seen[u] = true;

    var score = 0;
    var l = u.toLowerCase();
    if (l.indexOf("/_next/") !== -1) score += 20;
    if (l.indexOf("page") !== -1) score += 10;
    if (l.indexOf("app") !== -1) score += 5;

    out.push({ url: u, score: score });
  }

  out.sort(function(a, b) { return b.score - a.score; });
  return out.slice(0, 7).map(function(x) { return x.url; });
}

function decodeLiteral(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function looksLikePlayer(url) {
  var u = String(url || "");
  if (!/^https?:\/\//i.test(u) || blocked(u)) return false;
  if (MEDIA_RE.test(u)) return true;

  var h = hostOf(u);
  if (!h || h === "cinemode.fun" || /themoviedb|tmdb|youtube|cloudflareinsights/i.test(h)) {
    return false;
  }

  var s = u.toLowerCase();
  return (
    /embed|player|watch|stream|video|movie|tv|vidsrc|vidlink|vidfast|2embed|autoembed|sora|abyss/.test(s)
  );
}

function specializePlayerUrl(url, id, type, season, episode) {
  var u = String(url || "").trim();
  if (!u) return "";

  u = u
    .replace(/\{(?:tmdb_?id|tmdb|id)\}/gi, String(id))
    .replace(/\$\{(?:tmdb_?id|tmdb|id)\}/gi, String(id))
    .replace(/\{season\}/gi, String(season))
    .replace(/\$\{season\}/gi, String(season))
    .replace(/\{episode\}/gi, String(episode))
    .replace(/\$\{episode\}/gi, String(episode));

  if (/[?&](?:tmdb|id)=$/i.test(u)) {
    u += encodeURIComponent(id);
  } else if (
    /\/(?:embed\/)?(?:movie|tv)\/$/i.test(u) ||
    /\/(?:movie|tv)\/embed\/$/i.test(u)
  ) {
    u += encodeURIComponent(id);
  }

  if (type === "tv" && String(u).indexOf(String(id)) !== -1) {
    if (!/[?&](?:season|s)=/i.test(u)) {
      u += (u.indexOf("?") === -1 ? "?" : "&") + "season=" + encodeURIComponent(season);
    }
    if (!/[?&](?:episode|e)=/i.test(u)) {
      u += "&episode=" + encodeURIComponent(episode);
    }
  }

  return u;
}

function bundlePlayerCandidates(text, pageUrl, id, type, season, episode) {
  var raw = decodeLiteral(String(text || ""));
  var out = [];
  var seen = {};

  function add(value) {
    var u = absUrl(value, pageUrl);
    if (!u) return;

    u = specializePlayerUrl(u, id, type, season, episode);
    if (!looksLikePlayer(u) || seen[u]) return;

    seen[u] = true;
    out.push(u);
  }

  var absRe = /https?:\/\/[^\s"'`<>\\]+/gi;
  var m;
  while ((m = absRe.exec(raw)) !== null) {
    add(m[0]);
    if (out.length >= 16) break;
  }

  var quoted = /["'`]([^"'`]{1,260})["'`]/g;
  while ((m = quoted.exec(raw)) !== null) {
    var s = String(m[1] || "");
    if (
      /embed|player|watch|vidsrc|vidlink|vidfast|2embed|autoembed|sora|abyss/i.test(s)
    ) {
      add(s);
    }
    if (out.length >= 20) break;
  }

  return out;
}

function inspectSiteBundles(page, id, type, season, episode) {
  var scripts = scriptUrls(page.text, page.url);
  var baseCandidates = bundlePlayerCandidates(
    page.text,
    page.url,
    id,
    type,
    season,
    episode
  );

  if (!scripts.length) {
    return Promise.resolve(baseCandidates);
  }

  console.log("[CineMode] site scripts=" + scripts.length);

  return Promise.all(
    scripts.map(function(u) {
      return fetchText(u, BUNDLE_TIMEOUT_MS, {
        "Accept": "*/*",
        "Referer": page.url
      }).then(function(x) {
        return x.ok ? x.text : "";
      }).catch(function() {
        return "";
      });
    })
  ).then(function(chunks) {
    var all = baseCandidates.slice();
    var seen = {};
    all.forEach(function(u) { seen[u] = true; });

    chunks.forEach(function(js) {
      bundlePlayerCandidates(
        js,
        page.url,
        id,
        type,
        season,
        episode
      ).forEach(function(u) {
        if (!seen[u]) {
          seen[u] = true;
          all.push(u);
        }
      });
    });

    var hosts = [];
    var hostSeen = {};
    all.forEach(function(u) {
      var h = hostOf(u);
      if (h && !hostSeen[h]) {
        hostSeen[h] = true;
        hosts.push(h);
      }
    });

    console.log(
      "[CineMode] site player hints=" + all.length +
      (hosts.length ? " hosts=" + hosts.slice(0, 6).join("|") : "")
    );

    return all.slice(0, 6);
  });
}

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function interactions(type, season, episode) {
  var out = [];
  if (type === "tv") {
    out.push("season " + season);
    out.push("s" + season);
    out.push("episode " + episode);
    out.push("ep " + episode);
    out.push("e" + episode);
  }

  [
    "watch now",
    "start watching",
    "watch",
    "play now",
    "play",
    "continue",
    "skip ad",
    "skip",
    "close ad",
    "close"
  ].forEach(function(x) { out.push(x); });

  return out;
}

function webviewCapture(startUrl, type, season, episode, timeoutMs, playerStage, refererOverride) {
  if (!nativeAvailable()) return Promise.resolve([]);

  console.log(
    "[CineMode] webview stage=" + (playerStage ? "player" : "route") +
    " host=" + hostOf(startUrl) +
    " popup=allow timeout=" + timeoutMs
  );

  return globalThis.webviewResolve(startUrl, {
    referer: refererOverride || BASE + "/",
    directLoad: true,
    timeoutMs: timeoutMs,
    finishAfterFirstMs: playerStage ? 350 : 850,

    /*
     * CineMode is ad-supported and its watch action can navigate away from
     * cinemode.fun. Do not suppress the player popup/tab and do not lock the
     * main frame to the CineMode hostname.
     */
    suppressPopups: false,
    lockMainFrameHost: false,

    interactionTexts: interactions(type, season, episode),
    viewportWidth: 1080,
    viewportHeight: 1080,
    clickX: 540,
    clickY: 600,
    clickDelaysMs: playerStage
      ? [350, 850, 1450, 2200, 2850]
      : [450, 950, 1550, 2350, 3200],

    match: playerStage ? ZXC_MATCH : PLAYER_HINTS,
    blocked: BLOCKED,
    injectAbyssHook: true
  }).then(function(result) {
    var rows = result && Array.isArray(result.streams) ? result.streams : [];
    console.log(
      "[CineMode] webview " + (playerStage ? "player" : "route") +
      " captured=" + rows.length
    );
    return rows;
  }).catch(function(error) {
    console.log(
      "[CineMode] webview " + (playerStage ? "player" : "route") +
      " fail=" + (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function sanitiseHeaders(input, referer) {
  var out = {};
  var src = input && typeof input === "object" ? input : {};

  Object.keys(src).forEach(function(k) {
    var l = String(k || "").toLowerCase();
    if (
      l === "host" ||
      l === "connection" ||
      l === "content-length" ||
      l === "accept-encoding" ||
      l === "range" ||
      l.indexOf("sec-fetch-") === 0
    ) return;
    out[k] = String(src[k]);
  });

  out["User-Agent"] = out["User-Agent"] || out["user-agent"] || UA;
  delete out["user-agent"];

  var r = out.Referer || out.referer || referer || BASE + "/";
  delete out.referer;
  out.Referer = r;

  return out;
}

function inferQuality(url, label) {
  var s = (String(url || "") + " " + String(label || "")).toLowerCase();
  if (/2160|4k/.test(s)) return "2160p";
  if (/1440/.test(s)) return "1440p";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "Auto";
}

function totalBytes(res) {
  var range = "";
  var len = "";
  try {
    range = res.headers.get("content-range") || "";
    len = res.headers.get("content-length") || "";
  } catch (_) {}

  var m = /\/(\d+)\s*$/.exec(range);
  if (m) return Number(m[1] || 0);
  return Number(len || 0);
}

function verifyDirect(item) {
  var url = String(item && item.url || "");
  if (!/^https?:\/\//i.test(url) || blocked(url)) return Promise.resolve(null);

  var headers = sanitiseHeaders(item.headers, item.referer);
  headers.Accept = "*/*";

  if (!HLS_RE.test(url)) headers.Range = "bytes=0-1023";

  return timeout(
    fetch(url, {
      method: "GET",
      headers: headers,
      redirect: "follow"
    }).then(function(res) {
      var ct = "";
      try { ct = String(res.headers.get("content-type") || "").toLowerCase(); } catch (_) {}

      if (!(res.status === 200 || res.status === 206)) return null;
      if (/text\/html|application\/json/.test(ct)) return null;

      if (HLS_RE.test(url) || /mpegurl/.test(ct)) {
        return res.text().then(function(text) {
          if (String(text || "").indexOf("#EXTM3U") === -1 && !/mpegurl/.test(ct)) return null;
          item.url = res.url || url;
          item.headers = headers;
          return item;
        }).catch(function() {
          return /mpegurl/.test(ct) ? item : null;
        });
      }

      var total = totalBytes(res);
      if (
        (/^video\//.test(ct) || /octet-stream/.test(ct)) &&
        (total === 0 || total > 2 * 1024 * 1024)
      ) {
        item.url = res.url || url;
        item.headers = headers;
        return item;
      }
      return null;
    }),
    VERIFY_MS,
    "verify"
  ).catch(function() {
    return null;
  });
}


function zxcPlayerReferer(tmdbId, type, season, episode) {
  if (type === "tv") {
    return "https://player.zxcstream.xyz/player/tv/" +
      encodeURIComponent(tmdbId) + "/" +
      encodeURIComponent(season) + "/" +
      encodeURIComponent(episode);
  }
  return "https://player.zxcstream.xyz/player/movie/" +
    encodeURIComponent(tmdbId);
}

function isNoiseRequest(url) {
  var h = hostOf(url);
  var s = String(url || "").toLowerCase();

  if (!h) return true;
  if (isStaticAssetUrl(url)) return true;
  if (/google-analytics|googletagmanager|cloudflareinsights|vercel-insights/.test(h)) return true;
  if (/favicon|registersw|service-worker|manifest\.json/.test(s)) return true;
  return false;
}

function genericSessionCandidate(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return false;
  if (isNoiseRequest(url) || blocked(url)) return false;
  if (isZxc(url) && /\/player\//i.test(String(url || ""))) return false;
  if (likelySourceEndpoint(url)) return false;

  /*
   * After ZXC's protected /backend_/sources call, the actual media/CDN
   * request may be extensionless. Keep any remaining non-static request as
   * a candidate and let verifyDirect decide by response content-type.
   */
  return true;
}

function capturedRows(rows, fallbackReferer) {
  var direct = [];
  var players = [];
  var endpoints = [];
  var session = [];
  var seenDirect = {};
  var seenPlayer = {};
  var seenEndpoint = {};
  var seenSession = {};

  (rows || []).forEach(function(row) {
    if (!row || !row.url) return;
    var url = String(row.url).trim();
    if (!url || blocked(url) || isNoiseRequest(url)) return;

    var referer =
      String(row.referer || row.referrer || fallbackReferer || BASE + "/");

    if (MEDIA_RE.test(url)) {
      if (seenDirect[url]) return;
      seenDirect[url] = true;
      direct.push({
        url: url,
        referer: referer,
        headers: sanitiseHeaders(row.headers, referer),
        label: row.label || "ZXC media",
        quality: inferQuality(url, row.label)
      });
      return;
    }

    if (likelySourceEndpoint(url)) {
      if (seenEndpoint[url]) return;
      seenEndpoint[url] = true;
      endpoints.push({
        url: url,
        referer: referer,
        headers: sanitiseHeaders(row.headers, referer),
        label: row.label || "source",
        method: row.method || row.requestMethod || "",
        body: row.body || row.postData || row.requestBody || ""
      });
      return;
    }

    if (isZxc(url) && /\/player\//i.test(url)) return;

    if (isWorkerBootstrap(url)) {
      if (!seenPlayer[url]) {
        seenPlayer[url] = true;
        players.push(url);
      }
      return;
    }

    if (genericSessionCandidate(url)) {
      if (!seenSession[url]) {
        seenSession[url] = true;
        session.push({
          url: url,
          referer: referer,
          headers: sanitiseHeaders(row.headers, referer),
          label: row.label || "ZXC session",
          quality: inferQuality(url, row.label)
        });
      }
      return;
    }

    if (!looksLikePlayer(url)) return;
    if (seenPlayer[url]) return;
    seenPlayer[url] = true;
    players.push(url);
  });

  return {
    direct: direct,
    players: players,
    endpoints: endpoints,
    session: session
  };
}

function endpointMeta(url) {
  try {
    var u = new URL(String(url || ""));
    var keys = [];
    u.searchParams.forEach(function(_, k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
    return {
      host: u.hostname,
      path: u.pathname,
      params: keys.join(",")
    };
  } catch (_) {
    return { host: hostOf(url), path: "?", params: "" };
  }
}

function printableKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.keys(value).slice(0, 16).join(",");
}

function tryJson(text) {
  var raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  return null;
}

function maybeB64Decode(value) {
  var raw = String(value || "").trim();
  if (raw.length < 20 || raw.length > 12000) return "";

  var compact = raw.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_=-]+$/.test(compact)) return "";

  compact = compact.replace(/-/g, "+").replace(/_/g, "/");
  while (compact.length % 4) compact += "=";

  try {
    if (typeof atob === "function") {
      var bin = atob(compact);
      var out = "";
      for (var i = 0; i < bin.length; i++) {
        var c = bin.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) {
          out += String.fromCharCode(c);
        } else {
          return "";
        }
      }
      return out;
    }
  } catch (_) {}

  try {
    return Buffer.from(compact, "base64").toString("utf8");
  } catch (_) {}

  return "";
}

function collectNestedStrings(value, out, depth) {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    out.push(value);

    var nested = tryJson(value);
    if (nested) collectNestedStrings(nested, out, depth + 1);

    var decoded = maybeB64Decode(value);
    if (decoded && decoded !== value) {
      out.push(decoded);
      var nested2 = tryJson(decoded);
      if (nested2) collectNestedStrings(nested2, out, depth + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 40).forEach(function(v) {
      collectNestedStrings(v, out, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    Object.keys(value).slice(0, 60).forEach(function(k) {
      collectNestedStrings(value[k], out, depth + 1);
    });
  }
}

function sourceCandidatesFromResponse(text, baseUrl, referer, headers) {
  var strings = [];
  var parsed = tryJson(text);

  if (parsed) {
    collectNestedStrings(parsed, strings, 0);
  } else {
    strings.push(String(text || ""));
  }

  var merged = strings.join("\n");
  return extractMediaCandidates(merged, baseUrl, referer, headers);
}

function extractMediaCandidates(text, baseUrl, referer, headers) {
  var raw = decodeLiteral(String(text || ""));
  var out = [];
  var seen = {};

  function add(value) {
    var source = String(value || "").trim();
    if (!source) return;

    /*
     * Also accept protocol-relative and relative HLS/API paths from JSON.
     */
    var u = absUrl(source, baseUrl);
    if (!u || seen[u] || blocked(u)) return;
    seen[u] = true;

    if (
      MEDIA_RE.test(u) ||
      /m3u8|playlist|manifest|master|playback|\/hls\/|stream|video/i.test(u)
    ) {
      out.push({
        url: u,
        referer: referer || baseUrl,
        headers: headers || {},
        label: "ZXC source",
        quality: inferQuality(u, "")
      });
    }
  }

  var m;

  var absolute = /https?:\\?\/\\?\/[^\s"'`<>\\]+/gi;
  while ((m = absolute.exec(raw)) !== null && out.length < 24) add(m[0]);

  var protocolRelative = /["'](\/\/[^"'<>\\]+)["']/gi;
  while ((m = protocolRelative.exec(raw)) !== null && out.length < 24) add(m[1]);

  var props =
    /["'](?:url|file|src|source|sources|stream|playlist|manifest|playback|video)["']\s*:\s*["']([^"']+)["']/gi;
  while ((m = props.exec(raw)) !== null && out.length < 24) add(m[1]);

  var relative =
    /["'](\/[^"']*(?:m3u8|playlist|manifest|master|playback|hls|stream|video)[^"']*)["']/gi;
  while ((m = relative.exec(raw)) !== null && out.length < 24) add(m[1]);

  return out;
}

function resolveCapturedEndpoints(rows, tmdbId, type, season, episode) {
  var list = (rows || []).slice(0, 3);
  if (!list.length) return Promise.resolve(null);

  var playerRef = zxcPlayerReferer(tmdbId, type, season, episode);
  var playerOrigin = "https://player.zxcstream.xyz";

  return Promise.all(list.map(function(row, index) {
    var captured = sanitiseHeaders(row.headers, playerRef);
    var headers = {};

    Object.keys(captured || {}).forEach(function(k) {
      headers[k] = captured[k];
    });

    delete headers.Range;
    headers["User-Agent"] = headers["User-Agent"] || UA;
    headers["Accept"] = "application/json,text/plain,*/*";
    headers["Referer"] = playerRef;
    headers["Origin"] = playerOrigin;
    headers["Sec-Fetch-Dest"] = "empty";
    headers["Sec-Fetch-Mode"] = "cors";
    headers["Sec-Fetch-Site"] = "same-site";

    var method = String(row.method || "GET").toUpperCase();
    if (method !== "POST") method = "GET";

    var options = {
      method: method,
      headers: headers,
      redirect: "follow"
    };

    if (method === "POST" && row.body) {
      options.body = row.body;
    }

    var meta = endpointMeta(row.url);
    console.log(
      "[CineMode] source-replay#" + (index + 1) +
      " host=" + meta.host +
      " path=" + meta.path +
      " method=" + method
    );

    return timeout(
      fetch(row.url, options).then(function(res) {
        var ct = "";
        try { ct = String(res.headers.get("content-type") || "").toLowerCase(); } catch (_) {}

        return res.text().then(function(text) {
          var parsed = tryJson(text);
          var err = parsed && parsed.error ? String(parsed.error).replace(/\s+/g, " ").slice(0, 120) : "";

          console.log(
            "[CineMode] source-replay#" + (index + 1) +
            " status=" + res.status +
            " ct=" + (ct || "?") +
            (err ? " error='" + err + "'" : "")
          );

          if (!(res.status >= 200 && res.status < 300)) return null;

          var candidates = sourceCandidatesFromResponse(
            text,
            res.url || row.url,
            playerRef,
            headers
          );

          return verifyFirst(candidates, 4);
        });
      }),
      1100,
      "source replay"
    ).catch(function() {
      return null;
    });
  })).then(function(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i]) return results[i];
    }
    return null;
  });
}

function verifyFirst(list, limit) {
  var rows = (list || []).slice(0, Math.max(1, Number(limit || 3)));
  if (!rows.length) return Promise.resolve(null);

  return Promise.all(rows.map(function(row) {
    return verifyDirect(row);
  })).then(function(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i]) return results[i];
    }
    return null;
  });
}


function zxcApiProbeUrls(playerUrl, tmdbId, type, season, episode) {
  var origin = originOf(playerUrl);
  if (!origin) return [];

  var mediaPath =
    type === "tv"
      ? encodeURIComponent(tmdbId) + "/" + encodeURIComponent(season) + "/" + encodeURIComponent(episode)
      : encodeURIComponent(tmdbId);

  return [
    origin + "/api/source/" + type + "/" + mediaPath,
    origin + "/api/sources/" + type + "/" + mediaPath,
    origin + "/api/stream/" + type + "/" + mediaPath,
    origin + "/api/streams/" + type + "/" + mediaPath
  ];
}

function probeZxcApis(playerUrl, tmdbId, type, season, episode) {
  var urls = zxcApiProbeUrls(playerUrl, tmdbId, type, season, episode);

  return Promise.all(urls.map(function(apiUrl) {
    return timeout(fetch(apiUrl, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Referer": playerUrl,
        "Origin": originOf(playerUrl)
      },
      redirect: "follow"
    }).then(function(res) {
      var ct = "";
      try { ct = String(res.headers.get("content-type") || "").toLowerCase(); } catch (_) {}

      return res.text().then(function(text) {
        if (!(res.status >= 200 && res.status < 300)) return null;

        var candidates = sourceCandidatesFromResponse(
          text,
          res.url || apiUrl,
          playerUrl,
          {
            "User-Agent": UA,
            "Referer": playerUrl,
            "Origin": originOf(playerUrl)
          }
        );

        if (candidates.length) {
          console.log(
            "[CineMode] api-probe hit path=" +
            (function() {
              try { return new URL(res.url || apiUrl).pathname; } catch (_) { return "?"; }
            })() +
            " candidates=" + candidates.length
          );
        }

        return verifyFirst(candidates, 4);
      });
    }), 1050, "zxc api probe").catch(function() {
      return null;
    });
  })).then(function(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i]) return results[i];
    }
    return null;
  });
}


function resolveWorkerBootstrap(urls, type, season, episode, startedAt, parentUrl) {
  var seen = {};
  var list = (urls || []).filter(function(url) {
    url = String(url || "").trim();
    if (!/^https?:\/\//i.test(url) || blocked(url) || MEDIA_RE.test(url)) return false;
    if (isZxc(url) && /\/player\//i.test(url)) return false;
    if (seen[url]) return false;
    seen[url] = true;
    return true;
  }).slice(0, 2);
  if (!list.length) return Promise.resolve(null);

  function next(index) {
    if (index >= list.length) return Promise.resolve(null);

    var remaining = BUDGET_MS - (Date.now() - startedAt) - 500;
    if (remaining < 1100) return Promise.resolve(null);

    var waitMs = Math.min(2200, Math.max(1000, remaining));

    console.log(
      "[CineMode] child-bootstrap attempt=" + (index + 1) +
      "/" + list.length +
      " host=" + hostOf(list[index]) +
      " refererHost=" + hostOf(parentUrl || BASE) +
      " timeout=" + waitMs
    );

    return webviewCapture(
      list[index],
      type,
      season,
      episode,
      waitMs,
      true,
      parentUrl || BASE + "/"
    ).then(function(rows) {
      var parsed = capturedRows(rows, list[index]);

      console.log(
        "[CineMode] child parsed direct=" + parsed.direct.length +
        " session=" + parsed.session.length +
        " endpoints=" + parsed.endpoints.length
      );

      return verifyFirst(parsed.direct, 6).then(function(hit) {
        if (hit) return hit;

        if (parsed.endpoints.length) {
          return resolveCapturedEndpoints(
            parsed.endpoints,
            "",
            type,
            season,
            episode
          );
        }

        return null;
      });
    }).then(function(hit) {
      if (hit) {
        console.log(
          "[CineMode] CHILD MEDIA HIT host=" + hostOf(hit.url)
        );
        return hit;
      }
      return next(index + 1);
    });
  }

  return next(0);
}

function resolvePlayerPages(urls, type, season, episode, startedAt, tmdbId) {
  var seen = {};
  var list = [];

  zxcPlayerUrls(tmdbId, type, season, episode).forEach(function(u) {
    if (!seen[u]) {
      seen[u] = true;
      list.push(u);
    }
  });

  (urls || []).forEach(function(u) {
    u = String(u || "").trim();
    if (!u || seen[u] || blocked(u)) return;
    if (!looksLikePlayer(u) || MEDIA_RE.test(u)) return;

    if (isZxc(u) && /\/player\//i.test(u)) return;

    seen[u] = true;
    list.push(u);
  });

  list = list.slice(0, 2);
  if (!list.length) return Promise.resolve(null);

  console.log(
    "[CineMode] player-stage candidates=" + list.length +
    " mode=sequential-fast"
  );

  function processRows(rows, playerUrl) {
    var capturedPaths = (rows || []).slice(0, 8).map(function(row) {
      try {
        return new URL(String(row && row.url || "")).pathname;
      } catch (_) {
        return "?";
      }
    }).join("|");

    console.log(
      "[CineMode] player capture paths=" +
      (capturedPaths || "none")
    );

    var parsed = capturedRows(rows, playerUrl);

    console.log(
      "[CineMode] player parsed host=" + hostOf(playerUrl) +
      " direct=" + parsed.direct.length +
      " session=" + parsed.session.length +
      " endpoints=" + parsed.endpoints.length +
      " childPlayers=" + parsed.players.length
    );

    return verifyFirst(parsed.direct, 6).then(function(hit) {
      if (hit) {
        console.log("[CineMode] DIRECT HIT host=" + hostOf(hit.url));
        return hit;
      }

      /*
       * Important: replay protected /backend_/sources requests BEFORE trying
       * generic session URLs. The worker root seen in browser capture can be a
       * tiny HTML/bootstrap page, while the protected source endpoint contains
       * the actual media URL.
       */
      if (parsed.endpoints.length) {
        console.log(
          "[CineMode] protected source replay count=" +
          parsed.endpoints.length
        );

        return resolveCapturedEndpoints(
          parsed.endpoints,
          tmdbId,
          type,
          season,
          episode
        ).then(function(endpointHit) {
          if (endpointHit) {
            console.log(
              "[CineMode] SOURCE REPLAY HIT host=" +
              hostOf(endpointHit.url)
            );
            return endpointHit;
          }

          return resolveWorkerBootstrap(
            parsed.players,
            type,
            season,
            episode,
            startedAt,
            playerUrl
          ).then(function(workerHit) {
            if (workerHit) return workerHit;

            return verifyFirst(parsed.session, 4).then(function(sessionHit) {
              if (sessionHit) {
                console.log(
                  "[CineMode] browser-session HIT host=" +
                  hostOf(sessionHit.url)
                );
                return sessionHit;
              }
              return null;
            });
          });
        });
      }

      return resolveWorkerBootstrap(
        parsed.players,
        type,
        season,
        episode,
        startedAt,
        playerUrl
      ).then(function(workerHit) {
        if (workerHit) return workerHit;

        return verifyFirst(parsed.session, 4).then(function(sessionHit) {
          if (sessionHit) {
            console.log(
              "[CineMode] browser-session HIT host=" +
              hostOf(sessionHit.url)
            );
            return sessionHit;
          }
          return null;
        });
      });
    });
  }

  function tryPlayer(index) {
    if (index >= list.length) return Promise.resolve(null);

    var elapsed = Date.now() - startedAt;
    var remaining = BUDGET_MS - elapsed - 450;

    if (remaining < 1200) {
      console.log(
        "[CineMode] stop player fallback remaining=" +
        remaining + "ms"
      );
      return Promise.resolve(null);
    }

    /*
     * Only one WebView is active at a time. Previous Promise.all() could leave
     * server #2 alive after server #1 already returned captured rows, causing
     * the outer VUEO 10s runtime timeout.
     */
    var attemptCap = index === 0 ? 4200 : 2600;
    var eachTimeout = Math.min(
      PLAYER_WEBVIEW_MS,
      attemptCap,
      Math.max(1100, remaining - 1200)
    );

    console.log(
      "[CineMode] player attempt=" + (index + 1) +
      "/" + list.length +
      " timeout=" + eachTimeout
    );

    return webviewCapture(
      list[index],
      type,
      season,
      episode,
      eachTimeout,
      true
    ).then(function(rows) {
      return processRows(rows, list[index]);
    }).then(function(hit) {
      if (hit) {
        console.log("[CineMode] EARLY PLAYER RETURN");
        return hit;
      }
      return tryPlayer(index + 1);
    });
  }

  return tryPlayer(0);
}

function toStream(hit, info, type, season, episode) {
  var suffix = type === "tv"
    ? " S" + String(season).padStart(2, "0") +
      "E" + String(episode).padStart(2, "0")
    : "";

  return {
    name: PROVIDER,
    title: (info.title || PROVIDER) + suffix,
    url: hit.url,
    quality: hit.quality || inferQuality(hit.url, hit.label),
    type: "direct",
    headers: sanitiseHeaders(hit.headers, hit.referer || BASE + "/")
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  var startedAt = Date.now();
  var id = String(tmdbId || "").trim();
  var type = mediaType === "tv" ? "tv" : "movie";
  var s = Math.max(1, Number(season || 1));
  var e = Math.max(1, Number(episode || 1));

  if (!id) return Promise.resolve([]);

  console.log(
    "[CineMode] v" + VERSION + " TMDB=" + id + " type=" + type +
    (type === "tv" ? " S" + s + "E" + e : "")
  );

  var work = tmdbInfo(id, type).then(function(info) {
    var route = routeUrl(id, type);

    console.log(
      "[CineMode] title='" + info.title + "' year=" + info.year +
      " route=" + route
    );

    return fetchText(route, PAGE_TIMEOUT_MS, {
      "Accept": "text/html,application/xhtml+xml,*/*"
    }).then(function(page) {
      if (!page.ok || !page.text) {
        throw new Error("CineMode detail route HTTP " + page.status);
      }

      console.log(
        "[CineMode] real-site page status=" + page.status +
        " bytes=" + page.text.length +
        " identity=" + pageMatches(page.text, info, id)
      );

      return true;
    }).catch(function(error) {
      var message = error && error.message ? error.message : String(error);

      if (/timeout/i.test(message) && nativeAvailable()) {
        console.log(
          "[CineMode] page preflight soft-timeout -> continue WebView elapsed=" +
          (Date.now() - startedAt) + "ms"
        );
        return true;
      }

      throw error;
    }).then(function() {
      if (!nativeAvailable()) return [];

      console.log(
        "[CineMode] real-site ZXC player confirmed -> browser-session capture"
      );

      return resolvePlayerPages(
        [],
        type,
        s,
        e,
        startedAt,
        id
      ).then(function(hit) {
        if (!hit) return [];
        console.log(
          "[CineMode] PLAYER HIT host=" + hostOf(hit.url) +
          " q=" + (hit.quality || "Auto") +
          " elapsed=" + (Date.now() - startedAt) + "ms"
        );
        return [toStream(hit, info, type, s, e)];
      });
    });
  });

  return timeout(work, BUDGET_MS, "CineMode provider")
    .then(function(streams) {
      var list = Array.isArray(streams) ? streams : [];
      console.log(
        "[CineMode] v" + VERSION +
        " playable sources=" + list.length +
        " elapsed=" + (Date.now() - startedAt) + "ms"
      );
      return list;
    })
    .catch(function(error) {
      console.log(
        "[CineMode] fail=" +
        (error && error.message ? error.message : String(error)) +
        " elapsed=" + (Date.now() - startedAt) + "ms"
      );
      return [];
    });
}

module.exports = {
  getStreams: getStreams
};
