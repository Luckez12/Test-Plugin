"use strict";

var PROVIDER_NAME = "CineMode";
var VERSION = "1.0.0";
var BASE_URL = "https://cinemode.fun";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

var USER_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

/* Keep the whole provider below VUEO's ~10s scan timeout. */
var PROVIDER_BUDGET_MS = 8800;
var FAST_PATH_BUDGET_MS = 2100;
var PRIMARY_WEBVIEW_MS = 4300;
var ALIAS_WEBVIEW_MS = 1700;
var VERIFY_TIMEOUT_MS = 900;

var DIRECT_EXT_RE = /\.(m3u8|mp4|m4v)(?:$|[?#])/i;
var BLOCKED_PARTS = [
  "googletagmanager",
  "doubleclick",
  "googlesyndication",
  "effectivecpmnetwork",
  "/ads/",
  "/vast"
];

/* VUEO_SHARED_DISCOVERY_CONTEXT_V1 */
function vueoSharedTmdb(url, fallback) {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.vueoDiscoveryContext === "function"
  ) {
    return globalThis.vueoDiscoveryContext(url)
      .then(function(context) {
        if (context && context.tmdb) return context.tmdb;
        throw new Error("Shared discovery context is empty");
      })
      .catch(function() {
        return fallback();
      });
  }
  return fallback();
}

function trace(stage, details) {
  try {
    if (
      typeof globalThis !== "undefined" &&
      typeof globalThis.vueoTrace === "function"
    ) {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function withSoftTimeout(promise, timeoutMs, label) {
  return new Promise(function(resolve, reject) {
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      settled = true;
      reject(new Error((label || "Operation") + " timed out"));
    }, Math.max(1, Number(timeoutMs || 1)));

    Promise.resolve(promise).then(
      function(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      function(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9\u00c0-\uffff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function collectTmdbAliases(data) {
  var output = [];
  var seen = {};

  function add(value, priority) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    output.push({ title: text, priority: Number(priority || 0) });
  }

  add(data && (data.title || data.name), 100);
  add(data && (data.original_title || data.original_name), 95);

  var alt = data && data.alternative_titles;
  var altItems =
    alt && Array.isArray(alt.titles)
      ? alt.titles
      : alt && Array.isArray(alt.results)
        ? alt.results
        : [];

  altItems.forEach(function(item) {
    add(item && (item.title || item.name), 82);
  });

  var translations =
    data && data.translations && Array.isArray(data.translations.translations)
      ? data.translations.translations
      : [];

  translations.forEach(function(item) {
    add(
      item && item.data && (item.data.title || item.data.name),
      item && item.iso_639_1 === "en" ? 88 : 68
    );
  });

  output.sort(function(a, b) {
    return b.priority - a.priority;
  });

  return output.map(function(item) { return item.title; }).slice(0, 10);
}

function fetchJson(url, timeoutMs) {
  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      redirect: "follow"
    }).then(function(response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " " + url);
      }
      return response.json();
    }),
    timeoutMs || 1500,
    "CineMode metadata"
  );
}

function getTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === "tv" ? "tv" : "movie";
  var url =
    "https://api.themoviedb.org/3/" + endpoint + "/" +
    encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  return vueoSharedTmdb(url, function() {
    return fetchJson(url, 1500);
  }).then(function(data) {
    return {
      title: String(data && (data.title || data.name) || "").trim(),
      originalTitle: String(data && (data.original_title || data.original_name) || "").trim(),
      year: String(data && (data.release_date || data.first_air_date) || "").split("-")[0],
      aliases: collectTmdbAliases(data)
    };
  });
}

function absoluteUrl(value, base) {
  var text = decodeHtml(String(value || "").trim());
  if (!text || /^javascript:/i.test(text) || /^data:/i.test(text)) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/\//.test(text)) return "https:" + text;
  try {
    return new URL(text, base || BASE_URL + "/").toString();
  } catch (_) {
    if (text.charAt(0) === "/") return BASE_URL + text;
    return "";
  }
}

function isBlockedUrl(url) {
  var value = String(url || "").toLowerCase();
  return BLOCKED_PARTS.some(function(part) {
    return value.indexOf(part) !== -1;
  });
}

function fetchTextPage(url, timeoutMs, extraHeaders) {
  var headers = {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": USER_AGENT,
    Referer: BASE_URL + "/"
  };

  Object.keys(extraHeaders || {}).forEach(function(key) {
    headers[key] = extraHeaders[key];
  });

  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers: headers,
      redirect: "follow"
    }).then(function(response) {
      if (!response.ok) {
        return { ok: false, status: response.status, url: response.url || url, text: "" };
      }
      return response.text().then(function(text) {
        return {
          ok: true,
          status: response.status,
          url: response.url || url,
          text: String(text || "")
        };
      });
    }),
    timeoutMs,
    "CineMode HTTP page"
  ).catch(function(error) {
    return { ok: false, status: 0, url: url, text: "", error: error };
  });
}

function pageIdentityMatches(html, info, tmdbId) {
  var raw = String(html || "");
  if (!raw) return false;

  if (String(tmdbId || "") && raw.indexOf(String(tmdbId)) !== -1) {
    return true;
  }

  var visible = normalizeTitle(stripHtml(raw));
  var title = normalizeTitle(info && info.title);
  var original = normalizeTitle(info && info.originalTitle);
  var titleHit =
    (title && visible.indexOf(title) !== -1) ||
    (original && visible.indexOf(original) !== -1);

  if (!titleHit) return false;

  var year = String(info && info.year || "");
  return !year || raw.indexOf(year) !== -1 || visible.indexOf(year) !== -1;
}

function extractAnchors(html, pageUrl) {
  var out = [];
  var re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  var match;

  while ((match = re.exec(String(html || "")))) {
    var url = absoluteUrl(match[1], pageUrl);
    if (!url || isBlockedUrl(url)) continue;
    out.push({
      url: url,
      label: stripHtml(match[2]),
      raw: match[0]
    });
    if (out.length >= 150) break;
  }
  return out;
}

function scoreSearchAnchor(anchor, info) {
  var label = normalizeTitle(anchor && anchor.label);
  var href = normalizeTitle(anchor && anchor.url);
  var title = normalizeTitle(info && info.title);
  var original = normalizeTitle(info && info.originalTitle);
  var year = String(info && info.year || "");
  var score = 0;

  if (title && label === title) score += 120;
  else if (title && label.indexOf(title) !== -1) score += 90;
  else if (original && label === original) score += 110;
  else if (original && label.indexOf(original) !== -1) score += 80;
  else if (title && href.indexOf(title) !== -1) score += 55;
  else return 0;

  if (year && (String(anchor.raw || "").indexOf(year) !== -1 || href.indexOf(year) !== -1)) {
    score += 35;
  }

  return score;
}

function extractDirectCandidates(html, pageUrl, headers) {
  var raw = decodeHtml(String(html || ""));
  var out = [];
  var seen = {};

  function add(value, referer) {
    var url = absoluteUrl(value, pageUrl);
    if (!url || seen[url] || isBlockedUrl(url) || !DIRECT_EXT_RE.test(url)) return;
    seen[url] = true;
    out.push({
      url: url,
      referer: referer || pageUrl || BASE_URL + "/",
      headers: headers || {}
    });
  }

  var absRe = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|m4v)(?:\?[^\s"'<>\\]*)?/gi;
  var m;
  while ((m = absRe.exec(raw))) {
    add(m[0], pageUrl);
    if (out.length >= 20) break;
  }

  var relRe = /["']([^"']+\.(?:m3u8|mp4|m4v)(?:\?[^"']*)?)["']/gi;
  while ((m = relRe.exec(raw))) {
    add(m[1], pageUrl);
    if (out.length >= 20) break;
  }

  return out;
}

function extractIframeUrls(html, pageUrl) {
  var out = [];
  var seen = {};
  var re = /<(?:iframe|source|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  var m;

  while ((m = re.exec(String(html || "")))) {
    var url = absoluteUrl(m[1], pageUrl);
    if (!url || seen[url] || isBlockedUrl(url) || DIRECT_EXT_RE.test(url)) continue;
    seen[url] = true;
    out.push(url);
    if (out.length >= 3) break;
  }
  return out;
}

function inferQuality(url, label) {
  var value = (String(label || "") + " " + String(url || "")).toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1440") !== -1) return "1440p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function qualityScore(value) {
  var n = parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
  return isFinite(n) ? n : 0;
}

function sanitiseHeaders(input, fallbackReferer) {
  var output = {};
  var source = input && typeof input === "object" ? input : {};

  Object.keys(source).forEach(function(key) {
    var lower = String(key || "").toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "accept-encoding" ||
      lower === "range" ||
      lower.indexOf("sec-fetch-") === 0
    ) return;
    output[key] = String(source[key]);
  });

  output["User-Agent"] = output["User-Agent"] || output["user-agent"] || USER_AGENT;
  delete output["user-agent"];

  var capturedReferer = output.Referer || output.referer || "";
  delete output.referer;
  output.Referer = capturedReferer || fallbackReferer || BASE_URL + "/";

  return output;
}

function totalBytesFromResponse(response) {
  var range = "";
  var length = "";
  try {
    range = response.headers.get("content-range") || "";
    length = response.headers.get("content-length") || "";
  } catch (_) {}

  var match = /\/(\d+)\s*$/.exec(range);
  if (match) return Number(match[1] || 0);
  return Number(length || 0);
}

function verifyCandidate(candidate, timeoutMs) {
  var headers = sanitiseHeaders(candidate && candidate.headers, candidate && candidate.referer);
  headers.Accept = headers.Accept || "*/*";
  headers.Range = "bytes=0-1023";

  var url = String(candidate && candidate.url || "");
  var isHls = /\.m3u8(?:$|[?#])/i.test(url);

  return withSoftTimeout(
    fetch(url, {
      method: "GET",
      headers: headers,
      redirect: "follow"
    }).then(function(response) {
      var contentType = "";
      try { contentType = String(response.headers.get("content-type") || "").toLowerCase(); } catch (_) {}
      var total = totalBytesFromResponse(response);
      var okStatus = response.status === 200 || response.status === 206;
      var htmlLike = contentType.indexOf("text/html") !== -1;

      if (!okStatus || htmlLike) {
        return { ok: false, status: response.status, total: total, contentType: contentType };
      }

      if (isHls) {
        if (
          contentType.indexOf("mpegurl") !== -1 ||
          contentType.indexOf("application/vnd.apple") !== -1 ||
          contentType.indexOf("application/x-mpegurl") !== -1
        ) {
          return { ok: true, status: response.status, total: total, contentType: contentType };
        }

        return response.text().then(function(text) {
          return {
            ok: String(text || "").indexOf("#EXTM3U") !== -1,
            status: response.status,
            total: total,
            contentType: contentType
          };
        }).catch(function() {
          return { ok: false, status: response.status, total: total, contentType: contentType };
        });
      }

      var videoType = contentType.indexOf("video/") === 0 || contentType.indexOf("octet-stream") !== -1;
      var sizeOk = total === 0 || total > 2 * 1024 * 1024;
      return {
        ok: videoType && sizeOk,
        status: response.status,
        total: total,
        contentType: contentType
      };
    }),
    timeoutMs || VERIFY_TIMEOUT_MS,
    "CineMode stream verify"
  ).catch(function() {
    return { ok: false, status: 0, total: 0, contentType: "" };
  });
}

function verifyBestCandidate(candidates, limit) {
  var list = (candidates || []).slice();
  var seen = {};

  list = list.filter(function(item) {
    var url = String(item && item.url || "");
    if (!url || seen[url] || !DIRECT_EXT_RE.test(url)) return false;
    seen[url] = true;
    item.quality = item.quality || inferQuality(item.url, item.label);
    return true;
  }).sort(function(a, b) {
    return qualityScore(b.quality) - qualityScore(a.quality);
  }).slice(0, Math.max(1, Number(limit || 3)));

  if (!list.length) return Promise.resolve(null);

  return Promise.all(list.map(function(item, index) {
    return verifyCandidate(item, VERIFY_TIMEOUT_MS).then(function(result) {
      console.log(
        "[CineMode] verify #" + (index + 1) +
        " q=" + item.quality +
        " status=" + result.status +
        " sizeMB=" + (result.total ? Math.round(result.total / 1048576) : 0) +
        " ok=" + result.ok
      );
      return { item: item, result: result };
    });
  })).then(function(results) {
    for (var i = 0; i < results.length; i += 1) {
      if (results[i].result.ok) return results[i].item;
    }
    return null;
  });
}

function guessedDetailUrls(tmdbId, mediaType, season, episode) {
  var id = encodeURIComponent(tmdbId);
  if (mediaType === "tv") {
    return [
      BASE_URL + "/tv/" + id + "/" + season + "/" + episode,
      BASE_URL + "/tv/" + id + "?season=" + season + "&episode=" + episode
    ];
  }
  return [
    BASE_URL + "/movie/" + id,
    BASE_URL + "/watch/movie/" + id
  ];
}

function fastHttpDiscover(tmdbId, info, mediaType, season, episode) {
  var title = encodeURIComponent(info.title);
  var probes = guessedDetailUrls(tmdbId, mediaType, season, episode).concat([
    BASE_URL + "/search?q=" + title,
    BASE_URL + "/?s=" + title
  ]);

  console.log("[CineMode] fast-path probes=" + probes.length);

  return withSoftTimeout(
    Promise.all(probes.map(function(url) {
      return fetchTextPage(url, 1250);
    })).then(function(pages) {
      var details = [];
      var searchPages = [];

      pages.forEach(function(page, index) {
        if (!page || !page.ok || !page.text) return;
        if (index < 2 && pageIdentityMatches(page.text, info, tmdbId)) {
          details.push(page);
        } else if (index >= 2) {
          searchPages.push(page);
        }
      });

      if (details.length) return details;

      var ranked = [];
      searchPages.forEach(function(page) {
        extractAnchors(page.text, page.url).forEach(function(anchor) {
          var score = scoreSearchAnchor(anchor, info);
          if (score > 0) ranked.push({ score: score, anchor: anchor });
        });
      });

      ranked.sort(function(a, b) { return b.score - a.score; });
      var bestUrl = ranked.length ? ranked[0].anchor.url : "";
      if (!bestUrl) return [];

      console.log("[CineMode] fast search candidate=" + bestUrl);
      return fetchTextPage(bestUrl, 950).then(function(detail) {
        if (
          detail && detail.ok && detail.text &&
          pageIdentityMatches(detail.text, info, tmdbId)
        ) {
          return [detail];
        }
        return [];
      });
    }).then(function(detailPages) {
      if (!detailPages.length) return [];

      var direct = [];
      var embeds = [];

      detailPages.forEach(function(page) {
        direct = direct.concat(extractDirectCandidates(page.text, page.url));
        embeds = embeds.concat(extractIframeUrls(page.text, page.url));
      });

      if (direct.length) {
        console.log("[CineMode] fast direct candidates=" + direct.length);
        return direct;
      }

      var uniqueEmbeds = [];
      var seen = {};
      embeds.forEach(function(url) {
        if (!seen[url] && uniqueEmbeds.length < 2) {
          seen[url] = true;
          uniqueEmbeds.push(url);
        }
      });

      if (!uniqueEmbeds.length) return [];
      console.log("[CineMode] fast embed probes=" + uniqueEmbeds.length);

      return Promise.all(uniqueEmbeds.map(function(embedUrl) {
        return fetchTextPage(embedUrl, 800, { Referer: detailPages[0].url });
      })).then(function(embedPages) {
        var found = [];
        embedPages.forEach(function(page, index) {
          if (!page || !page.ok || !page.text) return;
          found = found.concat(extractDirectCandidates(
            page.text,
            page.url,
            { Referer: uniqueEmbeds[index] }
          ));
        });
        return found;
      });
    }),
    FAST_PATH_BUDGET_MS,
    "CineMode fast path"
  ).catch(function(error) {
    console.log("[CineMode] fast-path miss reason=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function nativeAvailable() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.webviewResolve === "function"
  );
}

function episodeInteractions(mediaType, season, episode) {
  if (mediaType !== "tv") return [];
  var s = Math.max(1, Number(season || 1));
  var e = Math.max(1, Number(episode || 1));
  var s2 = String(s).padStart(2, "0");
  var e2 = String(e).padStart(2, "0");
  return [
    "season " + s,
    "season " + s2,
    "s" + s,
    "s" + s2,
    "episode " + e,
    "episode " + e2,
    "ep " + e,
    "ep" + e,
    "e" + e,
    "e" + e2
  ];
}

function buildInteractionTexts(searchTitle, info, mediaType, season, episode) {
  var output = [];
  var seen = {};
  function add(value) {
    var text = String(value || "").trim();
    var key = text.toLowerCase();
    if (!text || seen[key]) return;
    seen[key] = true;
    output.push(text);
  }

  add(searchTitle);
  add(info.title);
  add(info.originalTitle);
  episodeInteractions(mediaType, season, episode).forEach(add);
  [
    "watch now", "start watching", "watch", "play now", "play",
    "continue", "server", "change server", "skip ad", "skip",
    "close ad", "close"
  ].forEach(add);
  return output;
}

function runWebview(searchTitle, info, mediaType, season, episode, timeoutMs) {
  console.log(
    "[CineMode] webview title='" + searchTitle + "' timeout=" + timeoutMs +
    (mediaType === "tv" ? " S" + season + "E" + episode : "")
  );

  return globalThis.webviewResolve(BASE_URL + "/", {
    referer: BASE_URL + "/",
    directLoad: true,
    searchText: searchTitle,
    timeoutMs: timeoutMs,
    finishAfterFirstMs: 450,
    suppressPopups: true,
    lockMainFrameHost: true,
    interactionTexts: buildInteractionTexts(searchTitle, info, mediaType, season, episode),
    viewportWidth: 1080,
    viewportHeight: 1080,
    clickX: 540,
    clickY: 540,
    clickDelaysMs: [450, 900, 1500, 2200, 3000, 3900].filter(function(delay) {
      return delay < timeoutMs;
    }),
    match: [".m3u8", ".mp4", ".m4v", "/sora/"],
    blocked: BLOCKED_PARTS,
    injectAbyssHook: true
  }).then(function(result) {
    var streams = result && Array.isArray(result.streams) ? result.streams : [];
    console.log("[CineMode] webview captured=" + streams.length);
    return streams;
  }).catch(function(error) {
    console.log("[CineMode] webview failed error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function capturedCandidates(captured) {
  var out = [];
  var seen = {};

  (captured || []).forEach(function(item) {
    if (!item || !item.url) return;
    var url = String(item.url).trim();
    /* /sora/ is intermediate. Never expose it as a playable source. */
    if (!DIRECT_EXT_RE.test(url) || seen[url]) return;
    seen[url] = true;

    var referer = String(item.referer || item.referrer || "").trim() || BASE_URL + "/";
    out.push({
      url: url,
      label: item.label || "",
      quality: inferQuality(url, item.label),
      referer: referer,
      headers: sanitiseHeaders(item.headers, referer)
    });
  });

  return out;
}

function toStream(candidate, info, mediaType, season, episode) {
  var suffix = mediaType === "tv"
    ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
    : "";

  return {
    name: PROVIDER_NAME,
    title: (info.title || PROVIDER_NAME) + suffix,
    url: candidate.url,
    quality: candidate.quality || inferQuality(candidate.url, candidate.label),
    type: "direct",
    headers: sanitiseHeaders(candidate.headers, candidate.referer || BASE_URL + "/")
  };
}

function pickAlias(info) {
  var primary = normalizeTitle(info && info.title);
  var aliases = info && Array.isArray(info.aliases) ? info.aliases : [];
  for (var i = 0; i < aliases.length; i += 1) {
    var value = String(aliases[i] || "").trim();
    if (value && normalizeTitle(value) !== primary) return value;
  }
  return "";
}

function getStreams(tmdbId, mediaType, season, episode) {
  var startedAt = Date.now();
  var type = mediaType === "tv" ? "tv" : "movie";
  var id = String(tmdbId || "").trim();
  var requestedSeason = Math.max(1, Number(season || 1));
  var requestedEpisode = Math.max(1, Number(episode || 1));

  if (!id) return Promise.resolve([]);

  console.log(
    "[CineMode] v" + VERSION + " TMDB=" + id + " type=" + type +
    (type === "tv" ? " S" + requestedSeason + "E" + requestedEpisode : "")
  );

  var work = getTmdbInfo(id, type).then(function(info) {
    if (!info.title) throw new Error("TMDB title is empty");

    console.log("[CineMode] title='" + info.title + "' year=" + info.year);
    trace("SEARCH", { title: info.title, aliases: info.aliases.length, mode: "fast-first" });

    return fastHttpDiscover(id, info, type, requestedSeason, requestedEpisode)
      .then(function(fastCandidates) {
        return verifyBestCandidate(fastCandidates, 3).then(function(bestFast) {
          if (bestFast) {
            console.log("[CineMode] FAST HIT q=" + (bestFast.quality || inferQuality(bestFast.url, bestFast.label)));
            return [toStream(bestFast, info, type, requestedSeason, requestedEpisode)];
          }

          console.log("[CineMode] fast-path no verified stream -> WebView fallback");
          if (!nativeAvailable()) return [];

          var elapsed = Date.now() - startedAt;
          var remaining = PROVIDER_BUDGET_MS - elapsed - VERIFY_TIMEOUT_MS - 250;
          if (remaining < 1200) return [];

          var primaryTimeout = Math.min(PRIMARY_WEBVIEW_MS, remaining);
          return runWebview(
            info.title,
            info,
            type,
            requestedSeason,
            requestedEpisode,
            primaryTimeout
          ).then(function(captured) {
            return verifyBestCandidate(capturedCandidates(captured), 3);
          }).then(function(bestPrimary) {
            if (bestPrimary) {
              console.log("[CineMode] WEBVIEW HIT primary q=" + bestPrimary.quality);
              return [toStream(bestPrimary, info, type, requestedSeason, requestedEpisode)];
            }

            var alias = pickAlias(info);
            var left = PROVIDER_BUDGET_MS - (Date.now() - startedAt) - VERIFY_TIMEOUT_MS - 200;
            if (!alias || left < 1200) return [];

            var aliasTimeout = Math.min(ALIAS_WEBVIEW_MS, left);
            console.log("[CineMode] alias fallback='" + alias + "'");
            return runWebview(
              alias,
              info,
              type,
              requestedSeason,
              requestedEpisode,
              aliasTimeout
            ).then(function(aliasCaptured) {
              return verifyBestCandidate(capturedCandidates(aliasCaptured), 2);
            }).then(function(bestAlias) {
              if (!bestAlias) return [];
              console.log("[CineMode] WEBVIEW HIT alias q=" + bestAlias.quality);
              return [toStream(bestAlias, info, type, requestedSeason, requestedEpisode)];
            });
          });
        });
      });
  });

  return withSoftTimeout(work, PROVIDER_BUDGET_MS, "CineMode provider")
    .then(function(streams) {
      var list = Array.isArray(streams) ? streams : [];
      console.log(
        "[CineMode] v" + VERSION + " playable sources=" + list.length +
        " elapsed=" + (Date.now() - startedAt) + "ms"
      );
      return list;
    })
    .catch(function(error) {
      console.error("[CineMode] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = {
  getStreams: getStreams
};
