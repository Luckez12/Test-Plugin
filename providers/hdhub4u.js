"use strict";

var PROVIDER = "HDHub4u";
var VERSION = "1.1.0";
var PRIMARY_BASE = "https://new5.hdhub4u.cl";
var FALLBACK_BASES = ["https://hdhub4u.frl"];
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var SEARCH_BASE = "https://search.hdhub4u.glass/collections/post/documents/search";
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var UA = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var PROVIDER_BUDGET_MS = 8800;
var VERIFY_TIMEOUT_MS = 1350;
var SEEK_VERIFY_TIMEOUT_MS = 1450;
var SEEK_PROBE_OFFSET = 1048576;

function cheerio() { return require("cheerio-without-node-native"); }

function trace(stage, details) {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.vueoTrace === "function") {
      globalThis.vueoTrace(stage, details || {});
    }
  } catch (_) {}
}

function withTimeout(promise, ms, label) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error((label || "operation") + " timeout"));
    }, Math.max(1, Number(ms || 1)));
    Promise.resolve(promise).then(function(v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, function(e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

function mergeHeaders(extra) {
  var out = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "xla=s4t"
  };
  Object.keys(extra || {}).forEach(function(k) { out[k] = extra[k]; });
  return out;
}

function fetchResponse(url, options, timeoutMs) {
  var opts = options || {};
  opts.headers = mergeHeaders(opts.headers || {});
  return withTimeout(fetch(url, opts), timeoutMs || 2100, "HTTP").then(function(res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " " + url);
    return res;
  });
}

function fetchText(url, options, timeoutMs) {
  return fetchResponse(url, options, timeoutMs).then(function(res) {
    return res.text().then(function(text) {
      return { text: text, url: res.url || url, status: res.status, headers: res.headers };
    });
  });
}

function fetchJson(url, options, timeoutMs) {
  return fetchText(url, options, timeoutMs).then(function(x) {
    return JSON.parse(String(x.text || "").replace(/^\uFEFF/, ""));
  });
}

function vueoSharedTmdb(url, fallback) {
  function normalize(raw) {
    var ctx = raw;
    if (typeof raw === "string") {
      try { ctx = JSON.parse(raw); } catch (_) { ctx = null; }
    }
    if (!ctx || ctx.error) return null;
    if (ctx.tmdb && typeof ctx.tmdb === "object") return ctx.tmdb;
    if (!ctx.title) return null;
    return {
      id: ctx.tmdbId,
      title: ctx.mediaType === "movie" ? ctx.title : undefined,
      name: ctx.mediaType === "tv" ? ctx.title : undefined,
      original_title: ctx.mediaType === "movie" ? (ctx.originalTitle || ctx.title) : undefined,
      original_name: ctx.mediaType === "tv" ? (ctx.originalTitle || ctx.title) : undefined,
      release_date: ctx.mediaType === "movie" && ctx.year ? String(ctx.year) + "-01-01" : "",
      first_air_date: ctx.mediaType === "tv" && ctx.year ? String(ctx.year) + "-01-01" : "",
      external_ids: { imdb_id: ctx.imdbId || "" }
    };
  }

  try {
    if (typeof globalThis !== "undefined") {
      var direct = normalize(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (direct) return Promise.resolve(direct);
      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve(globalThis.vueoDiscoveryContext(url)).then(function(raw) {
          var shared = normalize(raw);
          if (shared) return shared;
          throw new Error("shared context empty");
        }).catch(function() { return fallback(); });
      }
    }
  } catch (_) {}
  return fallback();
}

function normalizeTitle(v) {
  var s = String(v || "").toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return s.replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

function cleanDiscoveryTitle(v) {
  return normalizeTitle(String(v || "")
    .replace(/\[(?:[^\]]{0,160})\]/g, " ")
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\bseason\s*\d{1,2}\b/gi, " ")
    .replace(/\bs\d{1,2}\b/gi, " ")
    .replace(/\b(?:2160p|1080p|720p|480p|4k|ds4k|web[- ]?dl|webrip|hdrip|bluray|hevc|h26[45]|10bit|dual audio|multi audio|full movie|full series|all episodes|hindi dubbed|english)\b/gi, " "));
}

function parseYear(v) {
  var m = String(v || "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}

function unique(arr) {
  var seen = Object.create(null);
  return (arr || []).filter(function(v) {
    var key = String(v || "").trim();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function collectAliases(data) {
  var out = [];
  var seen = Object.create(null);
  function add(v) {
    var text = String(v || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    out.push(text);
  }
  add(data && (data.title || data.name));
  add(data && (data.original_title || data.original_name));
  var alt = data && data.alternative_titles;
  var rows = alt && Array.isArray(alt.titles) ? alt.titles : (alt && Array.isArray(alt.results) ? alt.results : []);
  rows.slice(0, 8).forEach(function(x) { add(x && (x.title || x.name)); });
  return out.slice(0, 6);
}

function tmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(String(tmdbId)) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles,external_ids";
  return vueoSharedTmdb(url, function() {
    return fetchJson(url, { headers: { "Accept": "application/json" } }, 1600);
  }).then(function(d) {
    return {
      title: String(type === "tv" ? (d.name || d.original_name || "") : (d.title || d.original_title || "")).trim(),
      year: parseYear(type === "tv" ? d.first_air_date : d.release_date),
      aliases: collectAliases(d || {})
    };
  });
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}

function absoluteUrl(base, href) {
  href = String(href || "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return "https:" + href;
  try { return new URL(href, base).toString(); } catch (_) {}
  var origin = originOf(base);
  return href.charAt(0) === "/" ? origin + href : origin + "/" + href;
}

function hostOf(url) {
  try { return new URL(String(url || "")).hostname.toLowerCase(); } catch (_) { return "?"; }
}

function b64decode(v) {
  try { if (typeof atob === "function") return atob(String(v || "")); } catch (_) {}
  try { return require("crypto-js").enc.Utf8.stringify(require("crypto-js").enc.Base64.parse(String(v || ""))); } catch (_) { return ""; }
}

function b64encode(v) {
  try { if (typeof btoa === "function") return btoa(String(v || "")); } catch (_) {}
  try { return require("crypto-js").enc.Base64.stringify(require("crypto-js").enc.Utf8.parse(String(v || ""))); } catch (_) { return ""; }
}

function rot13(v) {
  return String(v || "").replace(/[a-zA-Z]/g, function(c) {
    var base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
  });
}

function discoverCurrentBase() {
  return fetchJson(DOMAINS_URL, { headers: { "Accept": "application/json" } }, 1200)
    .then(function(data) {
      return data && data.HDHUB4u ? String(data.HDHUB4u).replace(/\/+$/, "") : null;
    }).catch(function() { return null; });
}

function parseSearch(html, base) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);

  $(".recent-movies > li.thumb, li.thumb, article").each(function(_, el) {
    var root = $(el);
    var a = root.find("a[href]").first();
    var href = absoluteUrl(base, a.attr("href"));
    if (!href || seen[href]) return;
    var title = String(root.find("figcaption p").first().text() || root.find("h2,h3").first().text() || a.attr("title") || root.text() || "")
      .replace(/\s+/g, " ").trim();
    if (!title) return;
    seen[href] = true;
    out.push({ title: title, url: href, year: parseYear(title) });
  });

  if (!out.length) {
    $("a[href]").each(function(_, el) {
      var a = $(el);
      var href = absoluteUrl(base, a.attr("href"));
      var text = String(a.text() || a.attr("title") || "").replace(/\s+/g, " ").trim();
      if (!href || !text || seen[href]) return;
      if (!/(?:19|20)\d{2}|season\s*\d+/i.test(text)) return;
      seen[href] = true;
      out.push({ title: text, url: href, year: parseYear(text) });
    });
  }
  return out;
}

function scoreCandidate(c, info, mediaType, season) {
  var wanted = cleanDiscoveryTitle(info.title);
  var cand = cleanDiscoveryTitle(c.title);
  if (!wanted || !cand) return -9999;
  var score = -9999;

  (info.aliases && info.aliases.length ? info.aliases : [info.title]).forEach(function(alias) {
    var a = cleanDiscoveryTitle(alias);
    if (!a) return;
    if (cand === a) score = Math.max(score, 1000);
    else if (cand.indexOf(a) >= 0 || a.indexOf(cand) >= 0) score = Math.max(score, 820);
  });
  if (score < 0) return score;

  if (info.year && c.year) {
    var diff = Math.abs(Number(info.year) - Number(c.year));
    if (diff === 0) score += 450;
    else if (diff === 1) score += mediaType === "tv" && Number(season || 1) > 1 ? 120 : 40;
    else if (diff > 2) score -= 900;
  }

  if (mediaType === "tv") {
    var sm = String(c.title || "").match(/\bseason\s*(\d{1,2})\b/i);
    if (sm && Number(sm[1]) === Number(season || 1)) score += 350;
    else if (sm) score -= 900;
  } else if (/\bseason\s*\d+/i.test(c.title || "")) {
    score -= 900;
  }
  return score;
}

function bestSearchResult(items, info, mediaType, season) {
  var scored = (items || []).map(function(x) {
    x.score = scoreCandidate(x, info, mediaType, season);
    return x;
  }).filter(function(x) { return x.score > 0; });
  scored.sort(function(a, b) { return b.score - a.score; });
  var best = scored[0] || null;
  if (best) trace("CANDIDATE", { title: best.title, score: best.score, count: items.length });
  return best;
}


function rewriteHdhubUrl(url, base) {
  var raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.charAt(0) === "/") return String(base || PRIMARY_BASE).replace(/\/+$/, "") + raw;
  if (!/^https?:\/\//i.test(raw)) return absoluteUrl(base || PRIMARY_BASE, raw);
  try {
    var u = new URL(raw);
    if (/hdhub4u\./i.test(u.hostname)) {
      var b = new URL(base || PRIMARY_BASE);
      u.protocol = b.protocol;
      u.hostname = b.hostname;
      u.port = b.port;
      return u.toString();
    }
  } catch (_) {}
  return raw;
}

function searchApi(base, query, info, mediaType, season) {
  var url = SEARCH_BASE +
    "?q=" + encodeURIComponent(query) +
    "&query_by=post_title,category" +
    "&query_by_weights=4,2" +
    "&sort_by=sort_by_date:desc" +
    "&limit=15" +
    "&highlight_fields=none" +
    "&use_cache=true" +
    "&page=1";

  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "Referer": String(base || PRIMARY_BASE) + "/"
    }
  }, 1700).then(function(data) {
    var hits = data && Array.isArray(data.hits) ? data.hits : [];
    var items = hits.map(function(hit) {
      var d = hit && hit.document ? hit.document : {};
      var title = String(d.post_title || d.title || "").replace(/\s+/g, " ").trim();
      return {
        title: title,
        url: rewriteHdhubUrl(d.permalink || d.url || "", base),
        year: parseYear(title)
      };
    }).filter(function(x) { return x.title && x.url; });

    var best = bestSearchResult(items, info, mediaType, season);
    console.log(
      "[HDHub4u] search-api query='" + query +
      "' items=" + items.length +
      " match=" + (best ? "yes" : "no")
    );
    return best ? { base: base, item: best } : null;
  });
}

function searchOne(base, query, info, mediaType, season) {
  var url = base + "/?s=" + encodeURIComponent(query);
  return fetchText(url, { headers: { "Referer": base + "/" } }, 2200).then(function(x) {
    var items = parseSearch(x.text, base);
    var best = bestSearchResult(items, info, mediaType, season);
    console.log("[HDHub4u] search host=" + base + " query='" + query + "' items=" + items.length + " match=" + (best ? "yes" : "no"));
    return best ? { base: base, item: best } : null;
  });
}

function findDetail(info, mediaType, season) {
  var queries = unique([info.title].concat((info.aliases || []).slice(0, 1)));
  var base = PRIMARY_BASE;

  function tryApi(i) {
    if (i >= queries.length) return Promise.resolve(null);
    return searchApi(base, queries[i], info, mediaType, season).then(function(hit) {
      return hit || tryApi(i + 1);
    }).catch(function() {
      return tryApi(i + 1);
    });
  }

  return tryApi(0).then(function(hit) {
    if (hit) return hit;

    console.log("[HDHub4u] search API missed -> website search fallback");
    return searchOne(base, info.title, info, mediaType, season).catch(function() {
      return null;
    });
  }).then(function(hit) {
    if (hit) return hit;

    console.log("[HDHub4u] primary domain missed -> refresh domain once");
    return discoverCurrentBase().then(function(current) {
      if (!current) return null;
      return searchApi(current, info.title, info, mediaType, season).then(function(apiHit) {
        return apiHit || searchOne(current, info.title, info, mediaType, season);
      }).catch(function() {
        return searchOne(current, info.title, info, mediaType, season).catch(function() {
          return null;
        });
      });
    });
  });
}

function qualityNumber(text) {
  var value = String(text || "");
  if (/\b(?:2160p|4k)\b/i.test(value)) return 2160;
  var m = value.match(/\b(1440|1080|720|480|360)p?\b/i);
  return m ? Number(m[1]) : 0;
}

function qualityLabel(q) {
  if (q >= 2160) return "2160p";
  if (q >= 1440) return "1440p";
  if (q >= 1080) return "1080p";
  if (q >= 720) return "720p";
  if (q >= 480) return "480p";
  if (q >= 360) return "360p";
  return "Auto";
}

function movieBlocks(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  $("h3 a[href], h4 a[href]").each(function(_, el) {
    var a = $(el);
    var href = absoluteUrl(detailUrl, a.attr("href"));
    var text = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
    var q = qualityNumber(text);
    if (!href || !q || seen[href]) return;
    seen[href] = true;
    out.push({ url: href, text: text, quality: q });
  });
  return out;
}

function episodeDirectBlocks(html, detailUrl, episode) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  var wanted = Number(episode || 1);

  $("h3, h4, h5").each(function(_, el) {
    var row = $(el);
    var text = String(row.text() || "").replace(/\s+/g, " ").trim();
    var em = text.match(/(?:episode|ep)\s*[-:#]?\s*0*(\d{1,3})/i) || text.match(/\bE0*(\d{1,3})\b/i);
    if (!em || Number(em[1]) !== wanted) return;

    function collect(node) {
      node.find("a[href]").each(function(_, aEl) {
        var a = $(aEl);
        var href = absoluteUrl(detailUrl, a.attr("href"));
        var label = String(a.text() || node.text() || "").replace(/\s+/g, " ").trim();
        if (!href || seen[href] || /\.zip(?:$|[?#])/i.test(href)) return;
        seen[href] = true;
        out.push({ url: href, text: label, quality: qualityNumber(label) });
      });
    }

    collect(row);
    var next = row.next();
    var guard = 0;
    while (next && next.length && guard++ < 8) {
      var tag = String(next.get(0) && next.get(0).tagName || "").toLowerCase();
      if (/^(h3|h4|h5|hr)$/.test(tag)) break;
      collect(next);
      next = next.next();
    }
  });
  return out;
}

function qualityRedirects(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  $("h3 a[href], h4 a[href]").each(function(_, el) {
    var a = $(el);
    var href = absoluteUrl(detailUrl, a.attr("href"));
    var text = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
    if (!href || !qualityNumber(text)) return;
    if (/techyboy4u|[?&]id=/i.test(href)) out.push({ url: href, text: text, quality: qualityNumber(text) });
  });
  return out;
}

function blockScore(block) {
  var q = Number(block.quality || 0);
  var t = String(block.text || "").toLowerCase();
  var score = q === 1080 ? 1000 : q === 720 ? 800 : q === 480 ? 650 : q === 2160 ? 600 : 400;
  if (/x264|h264|avc/.test(t)) score += 120;
  if (/10bit|hevc|x265|h265/.test(t)) score -= 35;
  if (/web-dl/.test(t)) score += 50;
  return score;
}

function getRedirectLinks(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || PRIMARY_BASE + "/" } }, 1700).then(function(x) {
    var doc = x.text;
    var re = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var combined = "";
    var m;
    while ((m = re.exec(doc))) combined += m[1] || m[2] || "";
    if (!combined) return x.url || url;
    try {
      var decoded = b64decode(rot13(b64decode(b64decode(combined))));
      var obj = JSON.parse(decoded);
      var direct = b64decode(obj.o || "").trim();
      if (direct) return direct;
      var data = b64encode(obj.data || "").trim();
      var blog = String(obj.blog_url || "").trim();
      if (blog && data) {
        return fetchText(blog + "?re=" + encodeURIComponent(data), { headers: { "Referer": url } }, 1500)
          .then(function(y) { return String(y.text || "").trim() || url; });
      }
    } catch (_) {}
    return x.url || url;
  }).catch(function() { return url; });
}

function headerGet(res, name) {
  try { return String(res && res.headers && res.headers.get ? (res.headers.get(name) || "") : ""); } catch (_) { return ""; }
}

function responseMediaInfo(res, originalUrl) {
  var ct = headerGet(res, "content-type").toLowerCase().split(";")[0].trim();
  var cd = headerGet(res, "content-disposition").toLowerCase();
  var finalUrl = String((res && res.url) || originalUrl || "");
  var cr = headerGet(res, "content-range");
  var m = cr.match(/\/(\d+)\s*$/);
  var total = m ? Number(m[1]) : Number(headerGet(res, "content-length") || 0);
  var html = /text\/html|application\/json|javascript/.test(ct);
  var manifest = /mpegurl|dash\+xml/.test(ct) || /\.(?:m3u8|mpd)(?:$|[?#])/i.test(finalUrl);
  var media = /^video\//.test(ct) || /octet-stream|matroska|mp4/.test(ct) || /attachment/.test(cd) || /\.(?:mp4|mkv|webm|m4v)(?:$|[?#])/i.test(finalUrl);
  var sizeOk = !total || total >= 8 * 1024 * 1024 || manifest;
  return { playable: !!res && res.status >= 200 && res.status < 400 && !html && sizeOk && (manifest || media), url: finalUrl, total: total, type: ct };
}

function parseContentRangeStart(value) {
  var m = String(value || "").match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  return m ? Number(m[1]) : -1;
}

function isR2Storage(url) {
  var host = hostOf(url);
  return /(?:^|\.)r2\.cloudflarestorage\.com$/i.test(host) ||
         /(?:^|\.)r2\.dev$/i.test(host);
}

function verifySeekRange(url, referer, total) {
  /*
   * A 0-1 probe only proves that the file exists. VUEO fast-forward needs
   * a non-zero byte-range request to be honoured as 206, otherwise the
   * player can fall back to byte 0 and appear to restart the video.
   */
  var maxStart =
    total && total > SEEK_PROBE_OFFSET + 4096
      ? Math.min(
          Math.max(SEEK_PROBE_OFFSET, Math.floor(total / 4)),
          Math.max(SEEK_PROBE_OFFSET, total - 4096)
        )
      : SEEK_PROBE_OFFSET;

  var end = maxStart + 1023;

  return withTimeout(fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: mergeHeaders({
      "Accept": "*/*",
      "Range": "bytes=" + maxStart + "-" + end,
      "Referer": referer || ""
    })
  }), SEEK_VERIFY_TIMEOUT_MS, "seek-range").then(function(res) {
    var cr = headerGet(res, "content-range");
    var start = parseContentRangeStart(cr);
    var ok = res.status === 206 && start === maxStart;

    console.log(
      "[HDHub4u] seek-probe host=" +
      hostOf((res && res.url) || url) +
      " status=" +
      res.status +
      " start=" +
      start +
      " expected=" +
      maxStart +
      " ok=" +
      ok
    );

    return ok;
  }).catch(function() {
    return false;
  });
}

function verifyDirect(url, referer) {
  function finish(res, originalUrl) {
    var info = responseMediaInfo(res, originalUrl);
    if (!info.playable) return Promise.resolve(null);

    var manifest =
      /mpegurl|dash\+xml/.test(info.type) ||
      /\.(?:m3u8|mpd)(?:$|[?#])/i.test(info.url);

    if (manifest) {
      console.log(
        "[HDHub4u] verify host=" +
        hostOf(info.url) +
        " status=" +
        res.status +
        " manifest=true ok=true"
      );
      return Promise.resolve({
        url: info.url,
        seekable: true,
        weakSeek: false,
        total: info.total || 0
      });
    }

    console.log(
      "[HDHub4u] verify host=" +
      hostOf(info.url) +
      " status=" +
      res.status +
      " MB=" +
      (info.total ? Math.round(info.total / 1048576) : "?") +
      " ok=true"
    );

    return verifySeekRange(
      info.url,
      referer,
      info.total || 0
    ).then(function(seekable) {
      if (isR2Storage(info.url)) {
        console.log(
          "[HDHub4u] reject R2 playback host=" +
          hostOf(info.url) +
          " reason=VUEO-seek-restart"
        );
        return null;
      }

      if (!seekable) {
        console.log(
          "[HDHub4u] reject non-seekable host=" +
          hostOf(info.url)
        );
        return null;
      }

      return {
        url: info.url,
        seekable: true,
        weakSeek: false,
        total: info.total || 0
      };
    });
  }

  function range() {
    return withTimeout(fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: mergeHeaders({
        "Accept": "*/*",
        "Range": "bytes=0-1",
        "Referer": referer || ""
      })
    }), VERIFY_TIMEOUT_MS, "range").then(function(res) {
      return finish(res, url);
    });
  }

  return withTimeout(fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: mergeHeaders({
      "Accept": "*/*",
      "Referer": referer || ""
    })
  }), VERIFY_TIMEOUT_MS, "head").then(function(res) {
    var info = responseMediaInfo(res, url);
    if (info.playable) return finish(res, url);
    if (/text\/html|application\/json/.test(info.type)) return null;
    return range().catch(function() { return null; });
  }).catch(function() {
    return range().catch(function() { return null; });
  });
}

function pixelDirect(url) {
  var m = String(url || "").match(/pixeldrain\.(?:com|dev|xyz)\/(?:u\/|api\/file\/)?([A-Za-z0-9]+)/i);
  return m ? "https://pixeldrain.com/api/file/" + m[1] + "?download" : url;
}

function collectAnchors(html, base) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  $("a[href]").each(function(_, el) {
    var a = $(el);
    var url = absoluteUrl(base, a.attr("href"));
    if (!/^https?:\/\//i.test(url) || seen[url]) return;
    seen[url] = true;
    out.push({ url: url, label: String(a.text() || a.attr("download") || "").replace(/\s+/g, " ").trim() });
  });
  return out;
}

function serverScore(url, label) {
  var s = (String(url || "") + " " + String(label || "")).toLowerCase();

  /* Playback/seek priority, not download-speed priority. */
  if (/hubcdn/.test(s)) return 1250;
  if (/pixeldrain/.test(s)) return 1200;
  if (/workers\.dev/.test(s)) return 1150;
  if (/fsl server|s3 server/.test(s)) return 1080;
  if (/10gbps/.test(s)) return 1000;
  if (/hubcloud/.test(s)) return 900;
  if (/hubdrive/.test(s)) return 840;
  if (/hblinks/.test(s)) return 780;
  if (/streamtape/.test(s)) return 650;
  if (/download file/.test(s)) return 500;
  if (/r2\.cloudflarestorage\.com|r2\.dev/.test(s)) return 50;
  return 300;
}


function hlsHeaders(referer, origin) {
  var h = {
    "User-Agent": UA,
    "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
    "Referer": referer || ""
  };
  if (origin) h["Origin"] = origin;
  return h;
}

function normalizeEscapedUrl(value) {
  var s = String(value || "").trim();
  if (!s) return "";
  s = s.replace(/\\u0026/gi, "&")
       .replace(/\\u003d/gi, "=")
       .replace(/\\u002f/gi, "/")
       .replace(/\\\//g, "/")
       .replace(/&amp;/gi, "&");
  try { s = JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (_) {}
  return s;
}

function verifyHls(url, referer, extraHeaders) {
  url = normalizeEscapedUrl(url);
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(null);

  var origin = "";
  try { origin = new URL(referer || url).origin; } catch (_) {}
  var headers = hlsHeaders(referer, origin);
  Object.keys(extraHeaders || {}).forEach(function(k) { headers[k] = extraHeaders[k]; });

  return fetchText(url, { headers: headers, redirect: "follow" }, 1650).then(function(x) {
    var body = String(x.text || "");
    var ct = headerGet({ headers: x.headers }, "content-type").toLowerCase();
    var finalUrl = String(x.url || url);
    var ok = /#EXTM3U/i.test(body) || /mpegurl/i.test(ct);
    if (!ok) {
      console.log("[HDHub4u] HLS reject host=" + hostOf(finalUrl) + " ct=" + (ct || "?"));
      return null;
    }
    console.log("[HDHub4u] HLS verified host=" + hostOf(finalUrl));
    return {
      url: finalUrl,
      referer: referer || "",
      headers: headers,
      isHls: true,
      quality: 1080
    };
  }).catch(function() {
    return null;
  });
}

function unbasePacker(word, radix) {
  var alphabet62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var alphabet95 = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
  var alphabet = null;
  if (radix > 36) {
    if (radix <= 62) alphabet = alphabet62.substring(0, radix);
    else if (radix <= 95) alphabet = alphabet95.substring(0, radix);
  }
  if (!alphabet) {
    var n = parseInt(word, radix);
    return isNaN(n) ? -1 : n;
  }
  var out = 0;
  for (var i = 0; i < word.length; i++) {
    var p = alphabet.indexOf(word.charAt(i));
    if (p < 0) return -1;
    out = out * radix + p;
  }
  return out;
}

function unpackPacker(js) {
  var raw = String(js || "");
  if (!/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(raw)) return "";
  var m = raw.match(/\}\s*\('([\s\S]*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!m) {
    m = raw.match(/\}\s*\("([\s\S]*)",\s*(\d+)\s*,\s*(\d+)\s*,\s*"([\s\S]*?)"\.split\("\|"\)/);
  }
  if (!m) return "";

  var payload = String(m[1] || "").replace(/\\'/g, "'");
  var radix = Number(m[2] || 36);
  var count = Number(m[3] || 0);
  var symtab = String(m[4] || "").split("|");
  if (!count || symtab.length < count) return "";

  return payload.replace(/\b[a-zA-Z0-9_]+\b/g, function(word) {
    var n = unbasePacker(word, radix);
    return n >= 0 && n < symtab.length && symtab[n] ? symtab[n] : word;
  });
}

function extractHlsUrls(text, base) {
  var raw = String(text || "");
  var sources = [];
  var seen = Object.create(null);

  function add(v) {
    var u = normalizeEscapedUrl(v);
    if (!u) return;
    if (/^\/\//.test(u)) u = "https:" + u;
    if (/^\//.test(u)) u = absoluteUrl(base, u);
    if (!/^https?:\/\//i.test(u)) return;
    if (!/\.m3u8(?:$|[?#])/i.test(u) && !/m3u8/i.test(u)) return;
    if (seen[u]) return;
    seen[u] = true;
    sources.push(u);
  }

  var patterns = [
    /(?:file|source|src)\s*[:=]\s*["']([^"']+)["']/gi,
    /["'](https?:\\?\/\\?\/[^"']+?m3u8[^"']*)["']/gi,
    /(https?:\/\/[^\s"'<>]+?\.m3u8[^\s"'<>]*)/gi
  ];

  patterns.forEach(function(rex) {
    var m;
    while ((m = rex.exec(raw)) !== null) add(m[1]);
  });
  return sources;
}

function resolveHdstream4u(url, referer) {
  var input = String(url || "");
  var embed = input
    .replace("/download/", "/v/")
    .replace("/file/", "/v/")
    .replace("/embed/", "/v/")
    .replace("/d/", "/v/")
    .replace("/f/", "/v/");

  console.log("[HDHub4u] try WATCH host=" + hostOf(input));

  return fetchText(embed, {
    headers: {
      "Referer": referer || "",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site"
    }
  }, 1900).then(function(x) {
    var raw = String(x.text || "");
    var scripts = [];
    var $ = cheerio().load(raw);
    $("script").each(function(_, el) {
      var t = String($(el).html() || "");
      if (t) scripts.push(t);
    });

    var joined = scripts.join("\n");
    var unpacked = unpackPacker(joined);
    var candidates = extractHlsUrls(unpacked || joined, x.url);

    if (!candidates.length && unpacked) {
      candidates = extractHlsUrls(joined, x.url);
    }

    console.log("[HDHub4u] WATCH HLS candidates=" + candidates.length);

    function next(i) {
      if (i >= candidates.length || i >= 3) return Promise.resolve(null);
      var origin = originOf(x.url);
      return verifyHls(candidates[i], x.url, {
        "Origin": origin,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site"
      }).then(function(hit) {
        if (hit) {
          hit.label = "WATCH";
          hit.quality = 1080;
          return hit;
        }
        return next(i + 1);
      });
    }
    return next(0);
  }).catch(function(e) {
    console.log("[HDHub4u] WATCH fail=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function getCryptoJS() {
  return require("crypto-js");
}

function resolveHubstream(url, referer) {
  var rawUrl = String(url || "");
  var hash = "";
  try {
    var u = new URL(rawUrl);
    hash = String(u.hash || "").replace(/^#/, "");
    if (!hash) {
      var parts = u.pathname.split("/").filter(Boolean);
      hash = parts.length ? parts[parts.length - 1] : "";
    }
  } catch (_) {
    hash = rawUrl.split("#").pop().split("/").pop();
  }

  if (!hash) return Promise.resolve(null);

  var base = originOf(rawUrl) || "https://hubstream.art";
  var api = base + "/api/v1/video?id=" + encodeURIComponent(hash);
  console.log("[HDHub4u] try PLAYER-2 host=" + hostOf(rawUrl) + " id=" + hash.slice(0, 8));

  return fetchText(api, {
    headers: {
      "Accept": "text/plain,*/*",
      "Referer": rawUrl,
      "Origin": base
    }
  }, 1700).then(function(x) {
    var encoded = String(x.text || "").trim();
    if (!/^[0-9a-f]+$/i.test(encoded) || encoded.length < 32) return null;

    var CryptoJS = getCryptoJS();
    var key = CryptoJS.enc.Utf8.parse("kiemtienmua911ca");
    var ivs = ["1234567890oiuytr", "0123456789abcdef"];

    function decryptAt(i) {
      if (i >= ivs.length) return Promise.resolve(null);
      try {
        var iv = CryptoJS.enc.Utf8.parse(ivs[i]);
        var dec = CryptoJS.AES.decrypt(
          { ciphertext: CryptoJS.enc.Hex.parse(encoded) },
          key,
          { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        var text = dec.toString(CryptoJS.enc.Utf8);
        var m = text && text.match(/"source"\s*:\s*"([^"]+)"/i);
        var source = m ? normalizeEscapedUrl(m[1]) : "";
        if (!source) return decryptAt(i + 1);

        var tries = [source];
        if (/^http:\/\//i.test(source)) tries.push(source.replace(/^http:/i, "https:"));

        function verifyAt(j) {
          if (j >= tries.length) return decryptAt(i + 1);
          return verifyHls(tries[j], rawUrl, {
            "Origin": base,
            "Referer": rawUrl
          }).then(function(hit) {
            if (hit) {
              hit.label = "PLAYER-2";
              hit.quality = 1080;
              return hit;
            }
            return verifyAt(j + 1);
          });
        }
        return verifyAt(0);
      } catch (_) {
        return decryptAt(i + 1);
      }
    }

    return decryptAt(0);
  }).catch(function(e) {
    console.log("[HDHub4u] PLAYER-2 fail=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function siteStreamLinks(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  var seen = Object.create(null);
  var counts = { watch: 0, player2: 0, hubcdn: 0 };

  $("a[href]").each(function(_, el) {
    var a = $(el);
    var href = absoluteUrl(detailUrl, a.attr("href"));
    var label = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
    if (!href || seen[href]) return;

    var host = hostOf(href);
    var kind = "";
    var priority = 0;
    var q = qualityNumber(label) || 1080;

    if (/hubstream|vidstack/i.test(host)) {
      kind = "player2";
      priority = 1300;
      counts.player2++;
    } else if (/hdstream4u/i.test(host)) {
      kind = "watch";
      priority = 1200;
      counts.watch++;
    } else if (/hubcdn/i.test(host)) {
      kind = "hubcdn";
      priority = 900;
      counts.hubcdn++;
    } else {
      return;
    }

    seen[href] = true;
    out.push({ url: href, label: label, kind: kind, priority: priority, quality: q });
  });

  console.log(
    "[HDHub4u] site-stream links watch=" + counts.watch +
    " player2=" + counts.player2 +
    " hubcdn=" + counts.hubcdn
  );

  return out.sort(function(a, b) {
    return b.priority - a.priority;
  });
}

function resolveSiteStream(item, detailUrl) {
  if (!item || !item.url) return Promise.resolve(null);
  if (item.kind === "player2") return resolveHubstream(item.url, detailUrl);
  if (item.kind === "watch") return resolveHdstream4u(item.url, detailUrl);
  if (item.kind === "hubcdn") return resolveHubCdn(item.url, detailUrl);
  return Promise.resolve(null);
}

function resolveHubCdn(url, referer) {
  console.log("[HDHub4u] try HubCDN host=" + hostOf(url));
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var data = String(x.text || "");
    var direct = "";

    var reurl = data.match(/\b(?:var|let|const)\s+reurl\s*=\s*["']([^"']+)["']/i);
    if (reurl && reurl[1]) {
      var val = normalizeEscapedUrl(reurl[1]);
      var rm = val.match(/[?&]r=([^&]+)/i);
      if (rm) {
        try {
          var decoded = b64decode(decodeURIComponent(rm[1]));
          var idx = decoded.lastIndexOf("link=");
          direct = idx >= 0 ? decoded.substring(idx + 5) : decoded;
        } catch (_) {}
      } else {
        var lm = val.match(/[?&]link=([^&]+)/i);
        if (lm) {
          try { direct = decodeURIComponent(lm[1]); } catch (_) { direct = lm[1]; }
        } else if (/^https?:\/\//i.test(val)) {
          direct = val;
        }
      }
    }

    if (!direct) {
      var encoded = data.match(/[?&]r=([A-Za-z0-9+/=]+)/i) || data.match(/\br=([A-Za-z0-9+/=]{16,})/i);
      if (encoded && encoded[1]) {
        try {
          var decoded2 = b64decode(encoded[1]);
          var idx2 = decoded2.lastIndexOf("link=");
          direct = idx2 >= 0 ? decoded2.substring(idx2 + 5) : decoded2;
        } catch (_) {}
      }
    }

    direct = normalizeEscapedUrl(direct);
    if (!direct) return null;

    return verifyHls(direct, url, { "Referer": url }).then(function(hit) {
      if (!hit) return null;
      hit.label = "HubCDN";
      hit.quality = 480;
      return hit;
    });
  }).catch(function() { return null; });
}

function resolveHblinks(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var links = collectAnchors(x.text, x.url).filter(function(a) {
      return /hubcloud|hubdrive|hubcdn|pixeldrain|workers\.dev|streamtape/i.test(a.url);
    }).sort(function(a, b) { return serverScore(b.url, b.label) - serverScore(a.url, a.label); });
    return resolveCandidates(links.slice(0, 4), x.url);
  }).catch(function() { return null; });
}

function resolveHubDrive(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var $ = cheerio().load(x.text);
    var href = String($(".btn.btn-primary.btn-user.btn-success1.m-1[href]").first().attr("href") || "").trim();
    if (href) return resolveServer(absoluteUrl(x.url, href), x.url);
    var links = collectAnchors(x.text, x.url).filter(function(a) {
      return a.url !== x.url && /hubcloud|hubcdn|hblinks|pixeldrain|workers\.dev/i.test(a.url);
    });
    return resolveCandidates(links.slice(0, 4), x.url);
  }).catch(function() { return null; });
}

function resolveHubCloud(url, referer) {
  url = String(url || "").replace("hubcloud.ink", "hubcloud.dad");
  return fetchText(url, { headers: { "Referer": referer || PRIMARY_BASE + "/" } }, 1900).then(function(first) {
    var html = first.text;
    var pageUrl = first.url;
    var m = html.match(/\bvar\s+url\s*=\s*["']([^"']+)["']/i);
    if (m && m[1]) {
      var next = absoluteUrl(pageUrl, m[1]);
      return fetchText(next, { headers: { "Referer": pageUrl } }, 1700).then(function(second) {
        return { html: second.text, pageUrl: second.url };
      }).catch(function() { return { html: html, pageUrl: pageUrl }; });
    }
    return { html: html, pageUrl: pageUrl };
  }).then(function(page) {
    var buttons = collectAnchors(page.html, page.pageUrl).sort(function(a, b) {
      return serverScore(b.url, b.label) - serverScore(a.url, a.label);
    });
    console.log("[HDHub4u] HubCloud buttons=" + buttons.length + " host=" + hostOf(page.pageUrl));

    function acceptOrContinue(hit, index) {
      if (!hit) return next(index + 1);
      if (hit.weakSeek || isR2Storage(hit.url)) {
        console.log(
          "[HDHub4u] skip weak-seek host=" +
          hostOf(hit.url) +
          " label='" +
          (hit.label || "") +
          "'"
        );
        return next(index + 1);
      }
      return hit;
    }

    function next(i) {
      if (i >= buttons.length || i >= 12) {
        return Promise.resolve(null);
      }

      var b = buttons[i];
      var u = b.url;
      var label = String(b.label || "").toLowerCase();

      if (
        /privacy|telegram|contact|home|login/.test(label) &&
        !/download|server|10gbps/.test(label)
      ) {
        return next(i + 1);
      }

      if (/pixeldrain/i.test(u)) {
        var pd = pixelDirect(u);
        return verifyDirect(pd, page.pageUrl).then(function(v) {
          return acceptOrContinue(
            v
              ? {
                  url: v.url,
                  referer: page.pageUrl,
                  label: "PixelDrain",
                  weakSeek: !!v.weakSeek
                }
              : null,
            i
          );
        });
      }

      if (/hubcdn/i.test(u)) {
        return resolveHubCdn(u, page.pageUrl).then(function(v) {
          return acceptOrContinue(v, i);
        });
      }

      if (/hblinks/i.test(u)) {
        return resolveHblinks(u, page.pageUrl).then(function(v) {
          return acceptOrContinue(v, i);
        });
      }

      if (/hubdrive/i.test(u)) {
        return resolveHubDrive(u, page.pageUrl).then(function(v) {
          return acceptOrContinue(v, i);
        });
      }

      if (
        /workers\.dev|\.(?:mp4|mkv|webm|m3u8|m4v)(?:$|[?#])/i.test(u) ||
        /fsl server|s3 server|download file|10gbps|buzzserver/i.test(label)
      ) {
        var direct = u;
        var lm = direct.match(/[?&]link=([^&]+)/i);

        if (lm) {
          try {
            direct = decodeURIComponent(lm[1]);
          } catch (_) {
            direct = lm[1];
          }
        }

        if (
          /buzzserver/i.test(label) &&
          !/\/download(?:$|[?#])/i.test(direct)
        ) {
          direct = direct.replace(/\/$/, "") + "/download";
        }

        return verifyDirect(direct, page.pageUrl).then(function(v) {
          return acceptOrContinue(
            v
              ? {
                  url: v.url,
                  referer: page.pageUrl,
                  label: b.label || "Direct",
                  weakSeek: !!v.weakSeek
                }
              : null,
            i
          );
        });
      }

      return next(i + 1);
    }
    return next(0);
  }).catch(function(e) {
    console.log("[HDHub4u] HubCloud fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function resolveStreamTape(url, referer) {
  try {
    var u = new URL(url);
    u.hostname = "streamtape.com";
    url = u.toString();
  } catch (_) {}
  return fetchText(url, { headers: { "Referer": referer || "" } }, 1800).then(function(x) {
    var m = x.text.match(/['"](\/\/streamtape\.com\/get_video[^'"<>]+)['"]/i);
    if (!m) return null;
    var direct = "https:" + m[1].replace(/&amp;/g, "&");
    return verifyDirect(direct, x.url).then(function(v) { return v ? { url: v.url, referer: x.url, label: "StreamTape", weakSeek: !!v.weakSeek } : null; });
  }).catch(function() { return null; });
}

function resolveServer(url, referer) {
  url = String(url || "").trim();
  if (!url) return Promise.resolve(null);
  return (/techyboy4u|[?&]id=/i.test(url) ? getRedirectLinks(url, referer) : Promise.resolve(url)).then(function(resolved) {
    resolved = String(resolved || url).trim();
    var host = hostOf(resolved);
    if (/hubstream|vidstack/i.test(host)) return resolveHubstream(resolved, referer);
    if (/hdstream4u/i.test(host)) return resolveHdstream4u(resolved, referer);
    if (/pixeldrain/i.test(host)) {
      var pd = pixelDirect(resolved);
      return verifyDirect(pd, referer).then(function(v) { return v ? { url: v.url, referer: referer || "", label: "PixelDrain", weakSeek: !!v.weakSeek } : null; });
    }
    if (/hubcloud/i.test(host)) return resolveHubCloud(resolved, referer);
    if (/hubdrive/i.test(host)) return resolveHubDrive(resolved, referer);
    if (/hubcdn/i.test(host)) return resolveHubCdn(resolved, referer);
    if (/hblinks/i.test(host)) return resolveHblinks(resolved, referer);
    if (/streamtape/i.test(host)) return resolveStreamTape(resolved, referer);
    if (/linkrit/i.test(host)) return null;
    if (/workers\.dev|\.(?:mp4|mkv|webm|m3u8|m4v)(?:$|[?#])/i.test(resolved)) {
      return verifyDirect(resolved, referer).then(function(v) { return v ? { url: v.url, referer: referer || "", label: host, weakSeek: !!v.weakSeek } : null; });
    }
    return null;
  }).catch(function() { return null; });
}

function resolveCandidates(items, referer) {
  var sorted = (items || []).slice().sort(function(a, b) {
    return serverScore(b.url, b.label) - serverScore(a.url, a.label);
  });
  function next(i) {
    if (i >= sorted.length) return Promise.resolve(null);
    return resolveServer(sorted[i].url, referer).then(function(v) {
      return v || next(i + 1);
    }).catch(function() { return next(i + 1); });
  }
  return next(0);
}

function resolveTvQualityRedirect(block, detailUrl, episode) {
  return getRedirectLinks(block.url, detailUrl).then(function(resolvedPage) {
    if (!resolvedPage || resolvedPage === block.url) return null;
    return fetchText(resolvedPage, { headers: { "Referer": block.url } }, 1800).then(function(x) {
      var $ = cheerio().load(x.text);
      var links = [];
      $("h5 a[href], h4 a[href], h3 a[href]").each(function(_, el) {
        var a = $(el);
        var text = String(a.text() || a.parent().text() || "").replace(/\s+/g, " ").trim();
        var m = text.match(/(?:episode|ep)\s*[-:#]?\s*0*(\d{1,3})/i) || text.match(/\bE0*(\d{1,3})\b/i);
        if (!m || Number(m[1]) !== Number(episode)) return;
        var href = absoluteUrl(x.url, a.attr("href"));
        if (href && !/\.zip(?:$|[?#])/i.test(href)) links.push({ url: href, label: text });
      });
      console.log("[HDHub4u] TV redirect q=" + qualityLabel(block.quality) + " episode links=" + links.length);
      return resolveCandidates(links, x.url);
    });
  }).catch(function() { return null; });
}

function resolveMoviePage(html, detailUrl) {
  var links = siteStreamLinks(html, detailUrl);

  function next(i) {
    if (i >= links.length || i >= 5) return Promise.resolve(null);
    var item = links[i];
    console.log(
      "[HDHub4u] stream try kind=" + item.kind +
      " host=" + hostOf(item.url)
    );
    return resolveSiteStream(item, detailUrl).then(function(hit) {
      if (hit) {
        hit.quality = hit.quality || item.quality || 1080;
        return hit;
      }
      return next(i + 1);
    }).catch(function() {
      return next(i + 1);
    });
  }

  return next(0);
}

function resolveTvPage(html, detailUrl, episode) {
  var direct = episodeDirectBlocks(html, detailUrl, episode).sort(function(a, b) { return blockScore(b) - blockScore(a); });
  console.log("[HDHub4u] TV direct episode links=" + direct.length);
  if (direct.length) {
    function tryDirect(i) {
      if (i >= direct.length || i >= 6) return Promise.resolve(null);
      var block = direct[i];
      return resolveServer(block.url, detailUrl).then(function(v) {
        if (v) {
          v.quality = block.quality || 1080;
          return v;
        }
        return tryDirect(i + 1);
      }).catch(function() { return tryDirect(i + 1); });
    }
    return tryDirect(0);
  }

  var redirects = qualityRedirects(html, detailUrl).sort(function(a, b) { return blockScore(b) - blockScore(a); });
  console.log("[HDHub4u] TV quality redirects=" + redirects.length);
  function next(i) {
    if (i >= redirects.length || i >= 5) return Promise.resolve(null);
    var b = redirects[i];
    return resolveTvQualityRedirect(b, detailUrl, episode).then(function(v) {
      if (v) { v.quality = b.quality; return v; }
      return next(i + 1);
    });
  }
  return next(0);
}

function toStream(hit, info, mediaType, season, episode) {
  var suffix = mediaType === "tv" ? " S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0") : "";
  var headers = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Referer": hit.referer || ""
  };
  Object.keys(hit.headers || {}).forEach(function(k) {
    headers[k] = hit.headers[k];
  });

  return {
    name: PROVIDER,
    title: info.title + suffix + " • " + qualityLabel(hit.quality) + " • " + (hit.label || hostOf(hit.url)),
    url: hit.url,
    quality: qualityLabel(hit.quality),
    type: "direct",
    headers: headers
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  var started = Date.now();
  var type = mediaType === "tv" ? "tv" : "movie";
  var s = Math.max(1, Number(season || 1));
  var e = Math.max(1, Number(episode || 1));
  var info;

  console.log("[HDHub4u] v" + VERSION + " TMDB=" + tmdbId + " type=" + type + (type === "tv" ? " S" + s + "E" + e : ""));

  var work = tmdbInfo(tmdbId, type).then(function(meta) {
    info = meta;
    console.log("[HDHub4u] title='" + info.title + "' year=" + (info.year || "?"));
    if (!info.title) return null;
    return findDetail(info, type, s);
  }).then(function(found) {
    if (!found || !found.item) {
      console.log("[HDHub4u] title not found");
      return null;
    }
    console.log("[HDHub4u] matched title='" + found.item.title + "' url=" + found.item.url);
    return fetchText(found.item.url, { headers: { "Referer": found.base + "/" } }, 2200).then(function(page) {
      if (type === "movie") return resolveMoviePage(page.text, page.url);
      return resolveTvPage(page.text, page.url, e);
    });
  }).then(function(hit) {
    if (!hit || !hit.url || !hit.isHls) {
      if (hit && hit.url && !hit.isHls) {
        console.log("[HDHub4u] reject progressive playback host=" + hostOf(hit.url));
      }
      return [];
    }
    console.log(
      "[HDHub4u] FAST HLS HIT host=" + hostOf(hit.url) +
      " q=" + qualityLabel(hit.quality) +
      " source=" + (hit.label || "?") +
      " elapsed=" + (Date.now() - started) + "ms"
    );
    return [toStream(hit, info, type, s, e)];
  });

  return withTimeout(work, PROVIDER_BUDGET_MS, "HDHub4u provider").then(function(streams) {
    streams = Array.isArray(streams) ? streams : [];
    console.log("[HDHub4u] v" + VERSION + " playable sources=" + streams.length + " elapsed=" + (Date.now() - started) + "ms");
    return streams;
  }).catch(function(err) {
    console.log("[HDHub4u] error=" + (err && err.message ? err.message : String(err)) + " elapsed=" + (Date.now() - started) + "ms");
    return [];
  });
}

module.exports = { getStreams: getStreams };
