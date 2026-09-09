const PROVIDER = "4KHDHub";
const VERSION = "1.1.0";
const BASES = ["https://4khdhub.one", "https://4khdhub.fans"];
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const UA = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
const MULTI_FIRST_GRACE_MS = 1800;
const MULTI_ABSOLUTE_MS = 5200;
const QUALITY_TASK_LIMIT = 2;

function cheerio() { return require("cheerio-without-node-native"); }

function fetchResp(url, options) {
  var opts = options || {};
  opts.headers = Object.assign({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
  }, opts.headers || {});
  return fetch(url, opts).then(function (res) {
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " " + url);
    return res.text().then(function (text) {
      return { text: text, url: res.url || url, status: res.status, headers: res.headers };
    });
  });
}

function fetchText(url, options) { return fetchResp(url, options).then(function (x) { return x.text; }); }
function fetchJson(url, options) { return fetchText(url, options).then(function (t) { return JSON.parse(String(t || "").replace(/^\uFEFF/, "")); }); }

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : "";
}
function absoluteUrl(base, href) {
  href = String(href || "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return "https:" + href;
  var origin = originOf(base);
  if (!origin) return href;
  if (href.charAt(0) === "/") return origin + href;
  return String(base || "").replace(/[#?].*$/, "").replace(/\/[^/]*$/, "/") + href;
}
function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^/:?#]+)/i);
  return m ? m[1].toLowerCase() : "?";
}
function normalizeTitle(v) {
  var s = String(v || "").toLowerCase();
  try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (_) {}
  return s.replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function parseYear(v) {
  var m = String(v || "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : 0;
}
function qualityFromText(v) {
  var m = String(v || "").match(/\b(2160|1080|720|480|360)p\b/i);
  return m ? m[1] + "p" : "Auto";
}
function displayQuality(q) {
  q = String(q || "Auto");
  return q === "2160p" ? "4K" : q;
}
function mediaLike(url) {
  var clean = String(url || "").split("?")[0].toLowerCase();
  return /\.(mkv|mp4|m3u8|mpd|webm|m4v)$/.test(clean) || /workers\.dev/i.test(url);
}
function unique(arr) {
  var seen = {};
  return (arr || []).filter(function (x) {
    x = String(x || "").trim();
    if (!x || seen[x]) return false;
    seen[x] = 1; return true;
  });
}
function b64decode(v) {
  try {
    if (typeof atob === "function") return atob(String(v || ""));
  } catch (_) {}
  try {
    var CryptoJS = require("crypto-js");
    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Base64.parse(String(v || "")));
  } catch (_) { return ""; }
}
function rot13(v) {
  return String(v || "").replace(/[a-zA-Z]/g, function (c) {
    var base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(base + ((c.charCodeAt(0) - base + 13) % 26));
  });
}

function tmdbDetails(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  return fetchJson(TMDB_BASE + "/" + type + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY + "&language=en-US", {
    headers: { "Accept": "application/json" }
  });
}
function tmdbInfo(d, mediaType) {
  var tv = mediaType === "tv";
  return {
    title: String(tv ? (d.name || d.original_name || "") : (d.title || d.original_title || "")).trim(),
    aliases: unique([tv ? d.name : d.title, tv ? d.original_name : d.original_title]),
    year: parseYear(tv ? d.first_air_date : d.release_date)
  };
}

function candidateText($, el) {
  var cur = $(el);
  var texts = [];
  for (var i = 0; i < 5 && cur && cur.length; i++) {
    var t = String(cur.text() || "").replace(/\s+/g, " ").trim();
    if (t && texts.indexOf(t) < 0) texts.push(t);
    if (/(?:19|20)\d{2}/.test(t) && t.length > 10) break;
    cur = cur.parent();
  }
  return texts.join(" ");
}
function titleFromAnchor($, el, href) {
  var a = $(el);
  var img = a.find("img").first();
  var alt = String(img.attr("alt") || "").replace(/^Poster Image of\s+/i, "").trim();
  if (alt) return alt.replace(/\s+•.*$/, "").replace(/\s+\((?:19|20)\d{2}\)$/, "").trim();
  var title = String(a.attr("title") || "").trim();
  if (title) return title.replace(/\s+•.*$/, "").replace(/\s+\((?:19|20)\d{2}\)$/, "").trim();
  var slug = String(href || "").replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "").replace(/\/$/, "")
    .replace(/-(movie|series)-\d+$/i, "").replace(/-/g, " ");
  return slug.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}
function scoreSearchCandidate(c, info, mediaType) {
  var wantedType = mediaType === "tv" ? "series" : "movie";
  if (c.type !== wantedType) return -9999;
  var nt = normalizeTitle(c.title);
  var bestTitle = 0;
  (info.aliases || [info.title]).forEach(function (a) {
    var na = normalizeTitle(a);
    if (!na) return;
    if (nt === na) bestTitle = Math.max(bestTitle, 1000);
    else if (nt.indexOf(na) >= 0 || na.indexOf(nt) >= 0) bestTitle = Math.max(bestTitle, 650);
  });
  if (!bestTitle) return -9999;
  var score = bestTitle;
  if (c.year && info.year) {
    if (c.year === info.year) score += 500;
    else if (Math.abs(c.year - info.year) === 1) score += 100;
    else score -= 700;
  }
  return score;
}
function parseSearch(html, base, info, mediaType) {
  var $ = cheerio().load(String(html || ""));
  var map = {};
  $("a[href]").each(function (_, el) {
    var href = absoluteUrl(base, $(el).attr("href"));
    var m = href.match(/\/(.+?)-(movie|series)-(\d+)\/?(?:[?#].*)?$/i);
    if (!m) return;
    if (map[href]) return;
    var context = candidateText($, el);
    map[href] = {
      url: href,
      type: m[2].toLowerCase(),
      title: titleFromAnchor($, el, href),
      year: parseYear(context),
      context: context
    };
  });
  var items = Object.keys(map).map(function (k) { return map[k]; });
  items.forEach(function (x) { x.score = scoreSearchCandidate(x, info, mediaType); });
  items.sort(function (a, b) { return b.score - a.score; });
  return items.filter(function (x) { return x.score > 0; });
}
function findDetail(info, mediaType) {
  var queries = unique([info.title].concat(info.aliases || []));
  function tryBase(bi) {
    if (bi >= BASES.length) return Promise.resolve(null);
    var base = BASES[bi];
    function tryQuery(qi) {
      if (qi >= queries.length) return tryBase(bi + 1);
      var q = queries[qi];
      var url = base + "/?s=" + encodeURIComponent(q);
      return fetchText(url, { headers: { "Referer": base + "/" } }).then(function (html) {
        var items = parseSearch(html, base, info, mediaType);
        var best = items[0] || null;
        console.log("[4KHDHub] search host=" + base + " query='" + q + "' items=" + items.length + " match=" + (best ? "yes" : "no"));
        if (best) return { base: base, item: best };
        return tryQuery(qi + 1);
      }).catch(function (e) {
        console.log("[4KHDHub] search fail host=" + base + " error=" + (e && e.message ? e.message : String(e)));
        return tryQuery(qi + 1);
      });
    }
    return tryQuery(0);
  }
  return tryBase(0);
}

function linksFromBlock($, el, base) {
  var out = [];
  $(el).find("a[href]").each(function (_, a) {
    var href = absoluteUrl(base, $(a).attr("href"));
    if (/^https?:\/\//i.test(href)) out.push(href);
  });
  return unique(out);
}
function parseMovieBlocks(html, detailUrl) {
  var $ = cheerio().load(String(html || ""));
  var blocks = [];
  $("div.download-item").each(function (_, el) {
    var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
    var links = linksFromBlock($, el, detailUrl);
    if (!links.length) return;
    blocks.push({ text: text, quality: qualityFromText(text), links: links });
  });
  if (!blocks.length) {
    var links = [];
    $("a[href]").each(function (_, a) {
      var href = absoluteUrl(detailUrl, $(a).attr("href"));
      if (/hubcloud|hubdrive/i.test(href)) links.push(href);
    });
    if (links.length) blocks.push({ text: "", quality: "Auto", links: unique(links) });
  }
  return blocks;
}
function parseTvBlocks(html, detailUrl, season, episode) {
  var $ = cheerio().load(String(html || ""));
  var blocks = [];
  $("div.episodes-list div.season-item").each(function (_, sEl) {
    var sText = String($(sEl).find("div.episode-number").text() || $(sEl).text() || "");
    var sm = sText.match(/\bS?0*(\d{1,2})\b/i);
    var s = sm ? Number(sm[1]) : 0;
    if (s !== Number(season)) return;
    $(sEl).find("div.episode-download-item").each(function (_, eEl) {
      var eText = String($(eEl).find("div.episode-file-info span.badge-psa").text() || $(eEl).text() || "");
      var em = eText.match(/Episode-?0*(\d{1,3})/i) || eText.match(/\bE0*(\d{1,3})\b/i);
      var e = em ? Number(em[1]) : 0;
      if (e !== Number(episode)) return;
      var text = String($(eEl).text() || "").replace(/\s+/g, " ").trim();
      var links = linksFromBlock($, eEl, detailUrl);
      if (links.length) blocks.push({ text: text, quality: qualityFromText(text), links: links });
    });
  });
  if (!blocks.length) {
    $("div.download-item").each(function (_, el) {
      var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
      var m = text.match(/\bS0*(\d{1,2})E0*(\d{1,3})\b/i);
      if (!m || Number(m[1]) !== Number(season) || Number(m[2]) !== Number(episode)) return;
      var links = linksFromBlock($, el, detailUrl);
      if (links.length) blocks.push({ text: text, quality: qualityFromText(text), links: links });
    });
  }
  return blocks;
}
function blockScore(b, targetQuality) {
  var t = String(b.text || "").toLowerCase();
  var q = String(b.quality || "Auto");
  var score = 0;

  if (targetQuality && q === targetQuality) score += 1000;
  if (/web-dl/.test(t)) score += 100;
  if (/sdr/.test(t)) score += 70;
  if (/av1/.test(t)) score -= 80;
  if (/dv|dolby vision/.test(t)) score -= 35;
  if (/hdr/.test(t) && !/sdr/.test(t)) score -= 10;

  if (q === "2160p") {
    if (/h265|hevc|x265/.test(t)) score += 90;
    if (/h264|x264|avc/.test(t)) score += 35;
  } else {
    if (/h264|x264|avc/.test(t)) score += 120;
    if (/h265|hevc|x265/.test(t)) score += 35;
  }

  return score;
}

function serverScore(url) {
  var u = String(url || "").toLowerCase();
  if (/hubcloud/.test(u)) return 100;
  if (/hubdrive/.test(u)) return 70;
  if (/workers\.dev/.test(u) || mediaLike(u)) return 120;
  return 30;
}

function resolveFourKRedirect(url) {
  if (!/[?&]id=/i.test(url)) return Promise.resolve(url);
  return fetchText(url).then(function (html) {
    var joined = "";
    var re = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var m;
    while ((m = re.exec(html))) joined += m[1] || m[2] || "";
    if (!joined) return url;
    try {
      var first = b64decode(joined);
      var second = b64decode(first);
      var rotated = rot13(second);
      var payload = b64decode(rotated);
      var obj = JSON.parse(payload);
      var direct = b64decode(obj.o || "").trim();
      if (direct) return direct;
      var data = b64decode(obj.data || "").trim();
      var blog = String(obj.blog_url || "").trim();
      if (!data || !blog) return url;
      return fetchText(blog + "?re=" + encodeURIComponent(data)).then(function (x) { return String(x || "").trim() || url; });
    } catch (_) { return url; }
  }).catch(function () { return url; });
}

function decodeWrapperLink(url) {
  var s = String(url || "");
  var m = s.match(/[?&]link=([^&]+)/i);
  if (!m) return s;
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}
function toPixel(url) {
  if (/\/api\/file\//i.test(url)) return url;
  var m = String(url || "").match(/^(https?:\/\/[^/]+)\/(?:u\/)?([^/?#]+)/i);
  return m ? m[1] + "/api/file/" + m[2] + "?download" : url;
}
function headerGet(res, name) {
  try { return String(res && res.headers && res.headers.get ? (res.headers.get(name) || "") : ""); } catch (_) { return ""; }
}
function contentTotalBytes(res) {
  var cr = headerGet(res, "content-range");
  var m = cr.match(/\/(\d+)\s*$/);
  if (m) return Number(m[1]) || 0;
  var cl = Number(headerGet(res, "content-length") || 0);
  return isFinite(cl) ? cl : 0;
}
function inspectMediaResponse(res, originalUrl) {
  var ct = headerGet(res, "content-type").toLowerCase().split(";")[0].trim();
  var cd = headerGet(res, "content-disposition").toLowerCase();
  var finalUrl = String((res && res.url) || originalUrl || "");
  var total = contentTotalBytes(res);
  var okStatus = !!res && res.status >= 200 && res.status < 400;
  var isText = /^(text\/html|text\/plain|application\/json|application\/javascript)/.test(ct);
  var isManifest = /mpegurl|dash\+xml/.test(ct) || /\.(m3u8|mpd)(?:$|[?#])/i.test(finalUrl);
  var mediaType = /^video\//.test(ct) || /octet-stream|matroska|mp4/.test(ct);
  var attachment = /attachment/.test(cd);
  var fileLike = mediaLike(finalUrl);
  var sizeOk = !total || total >= 10 * 1024 * 1024 || isManifest;
  var playable = okStatus && !isText && sizeOk && (isManifest || mediaType || attachment || fileLike);
  return { playable: playable, url: finalUrl, type: ct, total: total };
}
function rangeProbe(url, referer) {
  return fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Range": "bytes=0-1",
      "Referer": referer || ""
    }
  }).then(function (res) {
    var x = inspectMediaResponse(res, url);
    console.log("[4KHDHub] range probe host=" + hostOf(url) + " status=" + res.status + " type=" + x.type + " MB=" + (x.total ? Math.round(x.total / 1048576) : "?") + " playable=" + x.playable);
    return x.playable ? x.url : null;
  });
}
function probeFinal(url, referer) {
  return fetch(url, {
    method: "HEAD",
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Referer": referer || ""
    }
  }).then(function (res) {
    var x = inspectMediaResponse(res, url);
    console.log("[4KHDHub] head probe host=" + hostOf(url) + " status=" + res.status + " type=" + x.type + " MB=" + (x.total ? Math.round(x.total / 1048576) : "?") + " playable=" + x.playable);
    if (x.playable) return x.url;
    if (/^(text\/html|application\/json)/.test(x.type)) return null;
    return rangeProbe(url, referer).catch(function () { return null; });
  }).catch(function () {
    return rangeProbe(url, referer).catch(function (e) {
      console.log("[4KHDHub] probe fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
      return null;
    });
  });
}

function collectAnchors(html, base) {
  var $ = cheerio().load(String(html || ""));
  var out = [];
  $("a[href]").each(function (_, a) {
    var href = absoluteUrl(base, $(a).attr("href"));
    if (!/^https?:\/\//i.test(href)) return;
    var label = String($(a).text() || $(a).attr("download") || "Server").replace(/\s+/g, " ").trim();
    out.push({ url: href, label: label });
  });
  var raw = String(html || "").match(/https?:\/\/[^\s'"<>\\]+/g) || [];
  raw.forEach(function (u) {
    u = u.replace(/\\\//g, "/").replace(/[),;]+$/, "");
    if (/workers\.dev|hubcdn\.fans/i.test(u)) out.push({ url: u, label: "Direct" });
  });
  var seen = {};
  return out.filter(function (x) {
    if (!x.url || seen[x.url]) return false;
    seen[x.url] = 1; return true;
  });
}
function buttonScore(x) {
  var u = String(x.url || "").toLowerCase();
  var l = String(x.label || "").toLowerCase();
  if (/workers\.dev/.test(u)) return 1000;
  if (/pixeldrain|pixelserver/.test(u + " " + l)) return 950;
  if (/10gbps|fsl server|download file|s3 server|fslv2|mega server|pdl server/.test(l)) return 900;
  if (mediaLike(u)) return 880;
  if (/hubcdn\.fans/.test(u)) return 850;
  if (/buzzserver/.test(l)) return 820;
  if (/hubcdn/.test(u)) return 700;
  if (/hblinks/.test(u)) return 650;
  if (/hubdrive/.test(u)) return 500;
  return 100;
}

function resolveHubCdn(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }).then(function (html) {
    var m = String(html).match(/reurl\s*=\s*["']([^"']+)/i);
    var encoded = m && m[1] ? String(m[1]).split("?r=")[1] : "";
    if (!encoded) {
      m = String(html).match(/[?&]r=([A-Za-z0-9+/=]+)/);
      encoded = m ? m[1] : "";
    }
    var decoded = b64decode(encoded || "");
    var link = decoded ? decoded.substring(decoded.lastIndexOf("link=") + 5) : "";
    if (!link || link === decoded && decoded.indexOf("link=") < 0) return null;
    return probeFinal(link, url).then(function (p) { return p || null; });
  }).catch(function () { return null; });
}

function resolveHblinks(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || "" } }).then(function (html) {
    var links = collectAnchors(html, url).map(function (x) { return x.url; }).filter(function (u) {
      return /hubcloud|hubdrive|hubcdn|workers\.dev|pixeldrain|hdstream4u|hubstream/i.test(u) || mediaLike(u);
    });
    return resolveCandidates(links.slice(0, 4), url);
  }).catch(function () { return null; });
}

function resolveHubDrive(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || BASES[0] + "/" } }).then(function (html) {
    var links = collectAnchors(html, url).map(function (x) { return x.url; }).filter(function (u) {
      return u !== url && (/hubcloud|hubcdn|hblinks|workers\.dev|pixeldrain|hdstream4u|hubstream/i.test(u) || mediaLike(u));
    });
    console.log("[4KHDHub] HubDrive candidates=" + links.length);
    return resolveCandidates(links.slice(0, 5), url);
  }).catch(function (e) {
    console.log("[4KHDHub] HubDrive fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function resolveHubCloud(url, referer) {
  return fetchText(url, { headers: { "Referer": referer || BASES[0] + "/" } }).then(function (landingHtml) {
    var $ = cheerio().load(String(landingHtml || ""));
    var next = String($("#download[href]").first().attr("href") || $("a[href*='hubcloud.php']").first().attr("href") || "").trim();
    if (!next) {
      var m = String(landingHtml).match(/\bvar\s+url\s*=\s*["']([^"']+)["']/i) || String(landingHtml).match(/location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
      next = m ? m[1] : "";
    }
    next = next ? absoluteUrl(url, next) : url;
    var pagePromise = next === url ? Promise.resolve(landingHtml) : fetchText(next, { headers: { "Referer": url } });
    return pagePromise.then(function (html) {
      var buttons = collectAnchors(html, next).sort(function (a, b) { return buttonScore(b) - buttonScore(a); });
      console.log("[4KHDHub] HubCloud buttons=" + buttons.length + " host=" + hostOf(next));
      function tryButton(i) {
        if (i >= buttons.length || i >= 6) return Promise.resolve(null);
        var x = buttons[i];
        var u = x.url;
        var l = String(x.label || "").toLowerCase();
        if (/privacy|contact|home|login|telegram|discord|4khdhub/i.test(l) && !/download|server|10gbps/.test(l)) return tryButton(i + 1);
        if (/workers\.dev/i.test(u) || mediaLike(u)) {
          return probeFinal(u, next).then(function (p) {
            return p ? { url: p, referer: /workers\.dev/i.test(u) ? "" : next, label: x.label || "Direct" } : tryButton(i + 1);
          });
        }
        if (/pixeldrain|pixelserver/i.test(u + " " + l)) {
          var pixel = toPixel(u);
          return probeFinal(pixel, next).then(function (p) {
            return p ? { url: p, referer: next, label: "PixelDrain" } : tryButton(i + 1);
          });
        }
        if (/hubcdn\.fans/i.test(u)) {
          return probeFinal(u, next).then(function (p) { return p ? { url: p, referer: "", label: "Fast 10Gbps" } : tryButton(i + 1); });
        }
        if (/hubcdn/i.test(u)) {
          return resolveHubCdn(u, next).then(function (p) { return p ? { url: p, referer: u, label: "HubCDN" } : tryButton(i + 1); });
        }
        if (/hblinks/i.test(u)) {
          return resolveHblinks(u, next).then(function (p) { return p ? p : tryButton(i + 1); });
        }
        if (/hubdrive/i.test(u)) {
          return resolveHubDrive(u, next).then(function (p) { return p ? p : tryButton(i + 1); });
        }
        var unwrapped = decodeWrapperLink(u);
        if (/buzzserver/.test(l) && !/\/download(?:$|[?#])/i.test(unwrapped)) unwrapped = unwrapped.replace(/\/$/, "") + "/download";
        if (/10gbps|fsl server|download file|s3 server|fslv2|mega server|pdl server|buzzserver/.test(l)) {
          return probeFinal(unwrapped, next).then(function (p) { return p ? { url: p, referer: next, label: x.label || "Direct" } : tryButton(i + 1); });
        }
        return tryButton(i + 1);
      }
      return tryButton(0);
    });
  }).catch(function (e) {
    console.log("[4KHDHub] HubCloud fail host=" + hostOf(url) + " error=" + (e && e.message ? e.message : String(e)));
    return null;
  });
}

function resolveServer(url, referer) {
  url = String(url || "").trim();
  if (!url) return Promise.resolve(null);
  return resolveFourKRedirect(url).then(function (resolved) {
    resolved = String(resolved || url);
    if (/workers\.dev/i.test(resolved) || mediaLike(resolved)) {
      return probeFinal(resolved, referer).then(function (p) {
        return p ? { url: p, referer: /workers\.dev/i.test(resolved) ? "" : (referer || ""), label: "Direct" } : null;
      });
    }
    if (/pixeldrain/i.test(resolved)) {
      var pixel = toPixel(resolved);
      return probeFinal(pixel, referer).then(function (p) {
        return p ? { url: p, referer: referer || "", label: "PixelDrain" } : null;
      });
    }
    if (/hubcloud/i.test(resolved)) return resolveHubCloud(resolved, referer);
    if (/hubdrive/i.test(resolved)) return resolveHubDrive(resolved, referer);
    if (/hubcdn/i.test(resolved)) return resolveHubCdn(resolved, referer).then(function (p) { return p ? { url: p, referer: resolved, label: "HubCDN" } : null; });
    if (/hblinks/i.test(resolved)) return resolveHblinks(resolved, referer);
    return probeFinal(resolved, referer).then(function (p) { return p ? { url: p, referer: referer || "", label: hostOf(resolved) } : null; });
  });
}
function resolveCandidates(links, referer) {
  links = unique(links).sort(function (a, b) { return serverScore(b) - serverScore(a); });
  function next(i) {
    if (i >= links.length) return Promise.resolve(null);
    return resolveServer(links[i], referer).then(function (r) { return r || next(i + 1); }).catch(function () { return next(i + 1); });
  }
  return next(0);
}

function buildStream(result, quality, detailUrl) {
  return {
    name: PROVIDER,
    title: "4KHDHub • " + displayQuality(quality) + " • " + (result.label || hostOf(result.url)),
    url: result.url,
    quality: displayQuality(quality),
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Referer": result.referer || detailUrl
    }
  };
}

function resolveOneQuality(blocks, targetQuality, detailUrl) {
  var matches = (blocks || []).filter(function (b) {
    return String(b.quality || "") === targetQuality;
  }).sort(function (a, b) {
    return blockScore(b, targetQuality) - blockScore(a, targetQuality);
  }).slice(0, QUALITY_TASK_LIMIT);

  if (!matches.length) {
    console.log("[4KHDHub] quality " + displayQuality(targetQuality) + " unavailable");
    return Promise.resolve(null);
  }

  console.log(
    "[4KHDHub] quality " + displayQuality(targetQuality) +
    " candidates=" + matches.length
  );

  function tryBlock(i) {
    if (i >= matches.length) return Promise.resolve(null);
    var b = matches[i];
    var links = b.links.slice().sort(function (a, c) {
      return serverScore(c) - serverScore(a);
    });

    console.log(
      "[4KHDHub] try quality=" + displayQuality(targetQuality) +
      " block=" + (i + 1) +
      " servers=" + links.map(hostOf).join("|")
    );

    return resolveCandidates(links, detailUrl).then(function (r) {
      if (!r || !r.url) return tryBlock(i + 1);

      console.log(
        "[4KHDHub] READY host=" + hostOf(r.url) +
        " q=" + displayQuality(targetQuality) +
        " label='" + (r.label || "Direct") + "'"
      );

      return buildStream(r, targetQuality, detailUrl);
    }).catch(function () {
      return tryBlock(i + 1);
    });
  }

  return tryBlock(0);
}

function resolveBlocks(blocks, detailUrl) {
  var targets = ["2160p", "1080p", "720p"];
  var available = targets.filter(function (q) {
    return (blocks || []).some(function (b) { return b.quality === q; });
  });

  console.log(
    "[4KHDHub] blocks=" + (blocks || []).length +
    " available=" + available.map(displayQuality).join(",")
  );

  if (!available.length) {
    /* Keep compatibility for older posts with only Auto/unknown quality. */
    var fallback = (blocks || []).slice().sort(function (a, b) {
      return blockScore(b) - blockScore(a);
    }).slice(0, 2);

    function fallbackNext(i) {
      if (i >= fallback.length) return Promise.resolve([]);
      return resolveCandidates(fallback[i].links, detailUrl).then(function (r) {
        if (!r || !r.url) return fallbackNext(i + 1);
        var q = fallback[i].quality || "Auto";
        return [buildStream(r, q, detailUrl)];
      }).catch(function () { return fallbackNext(i + 1); });
    }
    return fallbackNext(0);
  }

  var ready = [];
  var pending = available.length;
  var firstResolved = false;
  var resolveFirst;
  var resolveAll;

  var firstGood = new Promise(function (resolve) { resolveFirst = resolve; });
  var allDone = new Promise(function (resolve) { resolveAll = resolve; });

  available.forEach(function (q) {
    resolveOneQuality(blocks, q, detailUrl).then(function (stream) {
      if (stream) {
        ready.push(stream);
        if (!firstResolved) {
          firstResolved = true;
          resolveFirst(true);
        }
      }
    }).catch(function () {
      /* One slow/broken quality must not hold the other qualities. */
    }).then(function () {
      pending--;
      if (pending <= 0) resolveAll(true);
    });
  });

  var grace = firstGood.then(function () {
    return new Promise(function (resolve) {
      setTimeout(resolve, MULTI_FIRST_GRACE_MS);
    });
  });

  var absolute = new Promise(function (resolve) {
    setTimeout(resolve, MULTI_ABSOLUTE_MS);
  });

  return Promise.race([allDone, grace, absolute]).then(function () {
    var rank = { "4K": 3, "1080p": 2, "720p": 1 };
    var seen = {};
    var finalStreams = ready.filter(function (s) {
      if (!s || !s.url || seen[s.quality]) return false;
      seen[s.quality] = true;
      return true;
    }).sort(function (a, b) {
      return (rank[b.quality] || 0) - (rank[a.quality] || 0);
    });

    console.log(
      "[4KHDHub] multi-quality ready=" +
      finalStreams.map(function (s) { return s.quality + ":" + hostOf(s.url); }).join(",")
    );

    return finalStreams;
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);
  var startedAt = Date.now();
  console.log("[4KHDHub] v" + VERSION + " TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : ""));
  var info;
  var detail;
  return tmdbDetails(tmdbId, mediaType)
    .then(function (d) {
      info = tmdbInfo(d || {}, mediaType);
      console.log("[4KHDHub] title='" + info.title + "' year=" + info.year);
      if (!info.title) return null;
      return findDetail(info, mediaType);
    })
    .then(function (found) {
      if (!found || !found.item) {
        console.log("[4KHDHub] title not found");
        return [];
      }
      detail = found.item;
      console.log("[4KHDHub] matched title='" + detail.title + "' year=" + (detail.year || "?") + " url=" + detail.url);
      return fetchText(detail.url, { headers: { "Referer": found.base + "/" } }).then(function (html) {
        var blocks = mediaType === "tv" ? parseTvBlocks(html, detail.url, season, episode) : parseMovieBlocks(html, detail.url);
        if (mediaType === "tv") console.log("[4KHDHub] episode blocks=" + blocks.length);
        return resolveBlocks(blocks, detail.url);
      });
    })
    .then(function (streams) {
      streams = streams || [];
      console.log("[4KHDHub] v" + VERSION + " playable sources=" + streams.length + " elapsed=" + (Date.now() - startedAt) + "ms");
      return streams;
    })
    .catch(function (e) {
      console.log("[4KHDHub] error=" + (e && e.message ? e.message : String(e)));
      return [];
    });
}

module.exports = { getStreams };
