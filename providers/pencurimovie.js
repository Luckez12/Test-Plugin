const PROVIDER = "PencuriMovie";
const VERSION = "1.1.0";
const BASE = "https://ww44.pencurimovie.baby";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
const PLAYMATE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0";

function getCheerio() {
  return require("cheerio-without-node-native");
}

function fetchResponse(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("HTTP " + (res ? res.status : "unknown") + " " + url);
    }
    return res.text().then(function (text) {
      return {
        text: text,
        url: res.url || url,
        status: res.status
      };
    });
  });
}

function fetchText(url, options) {
  return fetchResponse(url, options).then(function (x) { return x.text; });
}

function fetchJson(url, options) {
  return fetchText(url, options).then(function (text) {
    return JSON.parse(String(text || "").replace(/^\uFEFF/, ""));
  });
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : String(url || "").replace(/\/+$/, "");
}

function absoluteUrl(base, value) {
  var raw = String(value || "")
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/\\\//g, "/")
    .replace(/^['\"]|['\"]$/g, "");

  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return "https:" + raw;

  var root = originOf(base);
  if (raw.charAt(0) === "/") return root + raw;

  var cleanBase = String(base || "").split("#")[0].split("?")[0];
  cleanBase = cleanBase.substring(0, cleanBase.lastIndexOf("/") + 1);
  return cleanBase + raw;
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyTitle(value) {
  var text = String(value || "").trim().toLowerCase();
  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}
  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function stripYear(value) {
  return String(value || "")
    .replace(/\s*\(((?:19|20)\d{2})\)\s*$/i, "")
    .trim();
}

function yearFromText(value) {
  var m = String(value || "").match(/(?:\(|\b)((?:19|20)\d{2})(?:\)|\b)/);
  return m ? Number(m[1]) : null;
}

function getTmdbDetails(tmdbId, mediaType) {
  var type = mediaType === "tv" ? "tv" : "movie";
  var url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles";

  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT
    }
  }).then(function (data) {
    var altRoot = data.alternative_titles || {};
    var altItems = type === "movie"
      ? (Array.isArray(altRoot.titles) ? altRoot.titles : [])
      : (Array.isArray(altRoot.results) ? altRoot.results : []);

    return {
      title: type === "movie"
        ? (data.title || data.original_title || "")
        : (data.name || data.original_name || ""),
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").slice(0, 4),
      alternativeTitles: altItems.map(function (x) {
        return x && x.title ? String(x.title).trim() : "";
      }).filter(Boolean)
    };
  });
}

function acceptedTitleSet(details) {
  var set = {};
  [details.title, details.originalTitle]
    .concat(details.alternativeTitles || [])
    .filter(Boolean)
    .forEach(function (title) {
      var n = normalizeTitle(title);
      if (n) set[n] = true;
    });
  return set;
}

function parsePageIdentity(html) {
  var cheerio = getCheerio();
  var $ = cheerio.load(String(html || ""));
  var rawTitle = String(
    $("div.mvic-desc h3").first().text() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text() ||
    ""
  ).replace(/\s+/g, " ").trim();

  rawTitle = rawTitle
    .replace(/\s*[-|]\s*Pencuri\s*Movie.*$/i, "")
    .trim();

  var year = yearFromText(rawTitle);
  if (!year) {
    $("div.mvic-info p").each(function (_, el) {
      if (year) return;
      var text = String($(el).text() || "").replace(/\s+/g, " ").trim();
      if (/Release\s*:/i.test(text)) year = yearFromText(text);
    });
  }

  return {
    title: stripYear(rawTitle),
    rawTitle: rawTitle,
    year: year
  };
}

function validatePage(html, details, mediaType) {
  var identity = parsePageIdentity(html);
  if (!identity.title) return null;

  var accepted = acceptedTitleSet(details);
  if (!accepted[normalizeTitle(identity.title)]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(identity.year || 0);
  if (mediaType === "movie" && targetYear && itemYear && Math.abs(targetYear - itemYear) > 1) {
    return null;
  }

  return identity;
}

function tryDirectPage(details, mediaType) {
  var slug = slugifyTitle(details.title || details.originalTitle || "");
  var year = String(details.year || "").trim();
  if (!slug) return Promise.resolve(null);

  var paths = mediaType === "movie"
    ? ["/" + slug + (year ? "-" + year : "") + "/"]
    : [
        "/series/" + slug + (year ? "-" + year : "") + "/",
        "/series/" + slug + "/",
        "/" + slug + (year ? "-" + year : "") + "/"
      ];

  var index = 0;
  function next() {
    if (index >= paths.length) return Promise.resolve(null);
    var url = BASE + paths[index++];
    return fetchText(url, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": BASE + "/",
        "User-Agent": USER_AGENT
      }
    }).then(function (html) {
      var identity = validatePage(html, details, mediaType);
      if (!identity) return next();
      console.log("[PencuriMovie] fast title='" + identity.rawTitle + "' url=" + url);
      return {
        title: identity.title,
        rawTitle: identity.rawTitle,
        year: identity.year,
        url: url,
        mediaType: mediaType,
        html: html
      };
    }).catch(function () {
      return next();
    });
  }

  return next();
}

function parseSearchResults(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var results = [];

  $("div.ml-item").each(function (_, element) {
    var box = $(element);
    var a = box.find("a[href]").first();
    var href = absoluteUrl(pageUrl, a.attr("href"));
    if (!href || href.indexOf("pencurimovie") === -1) return;

    var rawTitle = String(
      a.attr("oldtitle") ||
      a.attr("title") ||
      box.find("h2").first().text() ||
      ""
    ).replace(/\s+/g, " ").trim();
    if (!rawTitle) return;

    var eps = box.find("span.mli-eps").length > 0;
    var isTv = eps || /\/series\//i.test(href);

    results.push({
      title: stripYear(rawTitle),
      rawTitle: rawTitle,
      year: yearFromText(rawTitle),
      url: href,
      mediaType: isTv ? "tv" : "movie"
    });
  });

  return results;
}

function scoreCandidate(item, details, mediaType) {
  if (!item || item.mediaType !== mediaType) return null;
  var accepted = acceptedTitleSet(details);
  var title = normalizeTitle(item.title);
  if (!accepted[title]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(item.year || 0);
  if (mediaType === "movie" && targetYear && itemYear && Math.abs(targetYear - itemYear) > 1) {
    return null;
  }

  var score = 100;
  if (title === normalizeTitle(details.title)) score += 40;
  if (targetYear && itemYear && targetYear === itemYear) score += 30;
  return score;
}

function searchSite(query) {
  var url = BASE + "/?s=" + encodeURIComponent(query);
  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": BASE + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    return parseSearchResults(html, url);
  });
}

function findBestTitle(details, mediaType) {
  var queries = [];
  function add(v) {
    v = String(v || "").trim();
    if (v && queries.indexOf(v) === -1) queries.push(v);
  }
  add(details.title);
  add(details.originalTitle);
  (details.alternativeTitles || []).slice(0, 2).forEach(add);

  var index = 0;
  function next() {
    if (index >= queries.length) return Promise.resolve(null);
    var query = queries[index++];
    return searchSite(query).then(function (items) {
      var ranked = items.map(function (item) {
        return { item: item, score: scoreCandidate(item, details, mediaType) };
      }).filter(function (x) {
        return typeof x.score === "number";
      }).sort(function (a, b) {
        return b.score - a.score;
      });

      if (ranked.length) {
        console.log("[PencuriMovie] matched title='" + ranked[0].item.rawTitle + "' url=" + ranked[0].item.url);
        return ranked[0].item;
      }
      return next();
    }).catch(function () {
      return next();
    });
  }

  return next();
}

function findTitle(details, mediaType) {
  return tryDirectPage(details, mediaType).then(function (item) {
    if (item) return item;
    return findBestTitle(details, mediaType);
  });
}

function findEpisodeUrl(html, pageUrl, season, episode) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var wantedSeason = Number(season || 1);
  var wantedEpisode = Number(episode || 1);
  var found = "";

  $("div.tvseason").each(function (_, seasonEl) {
    if (found) return;
    var box = $(seasonEl);
    var seasonText = String(box.find("strong").first().text() || "");
    var sm = seasonText.match(/Season\s*(\d+)/i);
    var currentSeason = sm ? Number(sm[1]) : 1;
    if (currentSeason !== wantedSeason) return;

    box.find("div.les-content a[href]").each(function (_, aEl) {
      if (found) return;
      var a = $(aEl);
      var text = String(a.text() || "").replace(/\s+/g, " ").trim();
      var em = text.match(/Episode\s*(\d+)/i);
      if (!em) em = String(a.attr("href") || "").match(/(?:episode|ep)[-_\/]?(\d+)/i);
      var currentEpisode = em ? Number(em[1]) : null;
      if (currentEpisode === wantedEpisode) {
        found = absoluteUrl(pageUrl, a.attr("href"));
      }
    });
  });

  return found;
}

function loadPlaybackPage(item, mediaType, season, episode) {
  var rootPromise = item && item.html
    ? Promise.resolve(item.html)
    : fetchText(item.url, {
        headers: {
          "Accept": "text/html,*/*",
          "Referer": BASE + "/",
          "User-Agent": USER_AGENT
        }
      });

  return rootPromise.then(function (html) {
    if (mediaType === "movie") {
      return { url: item.url, html: html };
    }

    var episodeUrl = findEpisodeUrl(html, item.url, season, episode);
    if (!episodeUrl) {
      console.log("[PencuriMovie] episode not found S" + season + "E" + episode);
      return null;
    }

    console.log("[PencuriMovie] episode url=" + episodeUrl);
    return fetchText(episodeUrl, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": item.url,
        "User-Agent": USER_AGENT
      }
    }).then(function (episodeHtml) {
      return { url: episodeUrl, html: episodeHtml };
    });
  });
}

function cleanCandidateUrl(value) {
  return String(value || "")
    .trim()
    .replace(/^['\"]|['\"]$/g, "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&");
}

function isBlockedFrame(url) {
  var lower = String(url || "").toLowerCase();
  return !/^https?:\/\//i.test(url) ||
    /youtube\.com|youtu\.be|google\.com\/recaptcha|doubleclick|googlesyndication|facebook\.com|instagram\.com|t\.me\//i.test(lower) ||
    /\.(?:jpg|jpeg|png|gif|webp|svg|css|js|woff2?|ttf|ico)(?:[?#]|$)/i.test(lower);
}

function extractUrlsFromScripts(html) {
  var clean = String(html || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  var out = {};
  var patterns = [
    /(?:src|file|url|embed|video|player|data-src|data-video|data-url)["']?\s*[:=]\s*["'](https?:[^"'\s<]+)["']/ig,
    /(https?:\/\/[^\s"'<>\\]+)/ig
  ];
  patterns.forEach(function (regex) {
    var m;
    while ((m = regex.exec(clean))) {
      var candidate = m[1] || m[0];
      if (candidate) out[candidate] = true;
      if (Object.keys(out).length >= 40) break;
    }
  });
  return Object.keys(out);
}

function collectEmbedUrls(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw, label) {
    var cleaned = cleanCandidateUrl(raw);
    var url = absoluteUrl(pageUrl, cleaned);
    if (!url || url === pageUrl || isBlockedFrame(url)) return;
    if (originOf(url) === originOf(pageUrl) && url.split("#")[0] === pageUrl.split("#")[0]) return;
    if (!found[url]) found[url] = label || "Server";
  }

  var selectors = [
    "div.movieplay iframe",
    "div.movieplay [data-src]",
    "div.movieplay [data-video]",
    "div.movieplay [data-url]",
    "div.movieplay [data-embed]",
    "div.movieplay [data-link]",
    "div#movieplay iframe",
    "div#movieplay [data-src]",
    "div#movieplay [data-video]",
    "div#movieplay [data-url]",
    "div#player iframe",
    "div#player [data-src]",
    "div#player [data-video]",
    "div#player [data-url]",
    "div.player iframe",
    "div.player [data-src]",
    "div.player [data-video]",
    "div.player [data-url]",
    "div.playbox iframe",
    "div.playbox [data-src]",
    "[id*=server] iframe",
    "[id*=server] [data-src]",
    "[id*=server] [data-video]",
    "[id*=server] [data-url]",
    "[class*=server] iframe",
    "[class*=server] [data-src]",
    "[class*=server] [data-video]",
    "[class*=server] [data-url]"
  ].join(", ");

  $(selectors).each(function (_, el) {
    var node = $(el);
    var label = String(
      node.attr("title") ||
      node.attr("data-name") ||
      node.closest("li,div").find("span,strong").first().text() ||
      "Server"
    ).replace(/\s+/g, " ").trim();

    [
      node.attr("data-src"),
      node.attr("src"),
      node.attr("data-video"),
      node.attr("data-url"),
      node.attr("data-embed"),
      node.attr("data-link"),
      node.attr("data-player"),
      node.attr("href")
    ].forEach(function (v) { add(v, label); });
  });

  if (!Object.keys(found).length) {
    $("iframe, [data-src], [data-video], [data-url], [data-embed], [data-link], [data-player]").each(function (_, el) {
      var node = $(el);
      [
        node.attr("data-src"), node.attr("src"), node.attr("data-video"),
        node.attr("data-url"), node.attr("data-embed"), node.attr("data-link"),
        node.attr("data-player")
      ].forEach(function (v) { add(v, "Server"); });
    });
  }

  if (!Object.keys(found).length) {
    extractUrlsFromScripts(html).forEach(function (url) { add(url, "Script"); });
  }

  return Object.keys(found).map(function (url) {
    return { url: url, label: found[url] };
  });
}

function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function waitMs(ms, value) {
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(value); }, ms);
  });
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isLikelyStreamUrl(raw) {
  var value = String(raw || "").toLowerCase();
  if (!/^https?:\/\//i.test(String(raw || ""))) return false;
  return /\.(?:m3u8|mp4|m4v|mkv|webm)(?:[?#]|$)/i.test(value) ||
    value.indexOf("/sora/") >= 0 ||
    value.indexOf("manifest.m3u8") >= 0 ||
    value.indexOf("master.m3u8") >= 0 ||
    /[?&](?:mime|type)=video/i.test(value);
}

function mediaUrlsFromText(text, baseUrl) {
  var input = decodeHtmlEntities(String(text || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  var found = {};

  function add(raw) {
    raw = String(raw || "").trim().replace(/^["']|["']$/g, "").replace(/["'\\]+$/g, "");
    var url = absoluteUrl(baseUrl, raw);
    if (url && isLikelyStreamUrl(url)) found[url] = true;
  }

  (input.match(/https?:\/\/[^\s"'<>\\]+/ig) || []).forEach(add);
  (input.match(/\/\/[a-z0-9.-]+\/[^\s"'<>\\]+/ig) || []).forEach(add);
  return Object.keys(found);
}

function unpackPacker(source) {
  var text = String(source || "");
  if (text.indexOf("eval(function(p,a,c,k,e,d)") === -1) return text;
  var re = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/;
  var match = re.exec(text);
  if (!match) return text;

  var payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  var radix = Number(match[2]);
  var count = Number(match[3]);
  var symtab = match[4].split("|");

  function encodeBase(num, base) {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (num < base) return chars.charAt(num);
    return encodeBase(Math.floor(num / base), base) + chars.charAt(num % base);
  }

  for (var i = count - 1; i >= 0; i--) {
    if (!symtab[i]) continue;
    var word = encodeBase(i, radix);
    payload = payload.replace(new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), symtab[i]);
  }
  return payload;
}

function resolvePlaymate(url) {
  if (!/playmate\.to/i.test(url)) return Promise.resolve([]);
  var clean = String(url).split("#")[0].split("?")[0].replace(/\/+$/, "");
  var id = clean.substring(clean.lastIndexOf("/") + 1);
  if (!id) return Promise.resolve([]);

  return fetchJson("https://playmate.to/api/s", {
    method: "POST",
    headers: {
      "Accept": "application/json,*/*",
      "Content-Type": "application/json",
      "User-Agent": PLAYMATE_USER_AGENT
    },
    body: JSON.stringify({ c: id, d: "web" })
  }).then(function (data) {
    var streamUrl = String(data && data.sx || "").trim();
    if (!/^https?:\/\//i.test(streamUrl)) return [];
    return [{
      url: streamUrl,
      label: "Playmate",
      noReferer: true,
      headers: { "Accept": "*/*", "User-Agent": PLAYMATE_USER_AGENT }
    }];
  }).catch(function () { return []; });
}

function randomToken(length) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var out = "";
  for (var i = 0; i < length; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function resolveDood(url, referer) {
  if (!/(?:dood|dsvplay|ds2play|vide0\.net|myvidplay)/i.test(url)) return Promise.resolve([]);
  var embedUrl = String(url).replace("/d/", "/e/");

  return fetchResponse(embedUrl, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || originOf(embedUrl) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (response) {
    var finalEmbedUrl = response.url || embedUrl;
    var host = originOf(finalEmbedUrl);
    var passMatch = response.text.match(/\/pass_md5\/[^'"\s<]+/i);
    if (!passMatch) return [];
    var passUrl = /^https?:\/\//i.test(passMatch[0]) ? passMatch[0] : host + passMatch[0];
    var token = passUrl.substring(passUrl.lastIndexOf("/") + 1);
    if (!token) return [];

    return fetchText(passUrl, {
      headers: { "Accept": "*/*", "Referer": finalEmbedUrl, "User-Agent": USER_AGENT }
    }).then(function (prefix) {
      var base = String(prefix || "").trim();
      if (!/^https?:\/\//i.test(base)) return [];
      var finalUrl = base + randomToken(10) + "?token=" + encodeURIComponent(token);
      return [{
        url: finalUrl,
        referer: host + "/",
        label: "Dood",
        headers: { "Accept": "*/*", "Referer": host + "/", "User-Agent": USER_AGENT }
      }];
    });
  }).catch(function () { return []; });
}

function resolveMixDrop(url, referer) {
  if (!/(?:mixdrop|mxdrop|mdy48tn97)/i.test(url)) return Promise.resolve([]);
  var embedUrl = String(url).replace("/f/", "/e/");
  return fetchText(embedUrl, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || embedUrl, "User-Agent": USER_AGENT }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var match = unpacked.match(/wurl.*?=.*?["']([^"']+)["'];?/i);
    if (!match) return [];
    var streamUrl = String(match[1] || "");
    if (/^\/\//.test(streamUrl)) streamUrl = "https:" + streamUrl;
    if (!/^https?:\/\//i.test(streamUrl)) return [];
    return [{ url: streamUrl, referer: embedUrl, label: "MixDrop" }];
  }).catch(function () { return []; });
}

function resolveStreamWish(url, referer) {
  if (!/(?:streamwish|hglink|wish|filelions|filelion|rapidplayers|dwish|embedwish|flaswish|cdnwish|hlswish|vidhide|vidhidepro|filemoon)/i.test(url)) {
    return Promise.resolve([]);
  }

  return fetchText(url, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || url, "User-Agent": USER_AGENT }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var candidates = mediaUrlsFromText(unpacked, url);
    return candidates.map(function (streamUrl) {
      return { url: streamUrl, referer: url, label: "StreamHost" };
    });
  }).catch(function () { return []; });
}

function rot13(value) {
  return String(value || "").replace(/[a-zA-Z]/g, function (c) {
    var code = c.charCodeAt(0);
    var base = code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

function base64DecodeBinary(input) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(input || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var output = "";
  var i = 0;
  while (i < clean.length) {
    var e1 = chars.indexOf(clean.charAt(i++));
    var e2 = chars.indexOf(clean.charAt(i++));
    var c3 = clean.charAt(i++);
    var c4 = clean.charAt(i++);
    var e3 = c3 === "=" ? 64 : chars.indexOf(c3);
    var e4 = c4 === "=" ? 64 : chars.indexOf(c4);
    if (e1 < 0 || e2 < 0) break;
    output += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== 64 && e3 >= 0) output += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== 64 && e4 >= 0 && e3 >= 0) output += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return output;
}

function binaryToUtf8(binary) {
  try {
    var encoded = "";
    for (var i = 0; i < binary.length; i++) encoded += "%" + ("0" + binary.charCodeAt(i).toString(16)).slice(-2);
    return decodeURIComponent(encoded);
  } catch (_) {
    return binary;
  }
}

function decryptVoe(encoded) {
  try {
    var step1 = rot13(encoded);
    ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].forEach(function (pattern) {
      step1 = step1.split(pattern).join("_");
    });
    var step2 = step1.replace(/_/g, "");
    var step3 = base64DecodeBinary(step2);
    var step4 = "";
    for (var i = 0; i < step3.length; i++) step4 += String.fromCharCode(step3.charCodeAt(i) - 3);
    var step5 = step4.split("").reverse().join("");
    return JSON.parse(binaryToUtf8(base64DecodeBinary(step5)));
  } catch (_) {
    return null;
  }
}

function resolveVoe(url, referer) {
  if (!/(?:voe\.|voe\.sx|tubeless|simpulum|urochs|nathanfromsubject|yip\.su|metagnath|donaldlineelse|charlestoughrace)/i.test(url)) {
    return Promise.resolve([]);
  }

  function load(target) {
    return fetchResponse(target, {
      headers: { "Accept": "text/html,*/*", "Referer": referer || target, "User-Agent": USER_AGENT }
    });
  }

  return load(url).then(function (response) {
    var redirect = response.text.match(/window\.location\.href\s*=\s*'([^']+)'/i);
    return redirect ? load(absoluteUrl(response.url || url, redirect[1])) : response;
  }).then(function (response) {
    var cheerio = getCheerio();
    var $ = cheerio.load(response.text);
    var raw = $("script[type='application/json']").first().text().trim();
    if (!raw) return [];
    var encoded = raw;
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) encoded = String(parsed[0] || "");
    } catch (_) {
      encoded = raw.replace(/^\s*\[\s*"/, "").replace(/"\s*\]\s*$/, "");
    }
    var data = decryptVoe(encoded);
    if (!data) return [];
    var out = [];
    if (data.source && isLikelyStreamUrl(data.source)) out.push({ url: data.source, referer: response.url || url, label: "VOE" });
    if (data.direct_access_url && isLikelyStreamUrl(data.direct_access_url)) out.push({ url: data.direct_access_url, referer: response.url || url, label: "VOE MP4" });
    return out;
  }).catch(function () { return []; });
}

function collectMediaFromObject(value, baseUrl, out, depth) {
  if (depth > 7 || value == null) return;
  if (typeof value === "string") {
    var clean = decodeHtmlEntities(value).replace(/\\\//g, "/").trim();
    if (/^https?:\/\//i.test(clean) && isLikelyStreamUrl(clean)) out[clean] = true;
    mediaUrlsFromText(clean, baseUrl).forEach(function (url) { out[url] = true; });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(function (x) { collectMediaFromObject(x, baseUrl, out, depth + 1); });
    return;
  }
  if (typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      var child = value[key];
      if (typeof child === "string" && /^(?:file|url|src|source|stream|playlist|hls|video)$/i.test(key)) {
        var candidate = decodeHtmlEntities(child).replace(/\\\//g, "/").trim();
        if (/^https?:\/\//i.test(candidate) && isLikelyStreamUrl(candidate)) out[candidate] = true;
      }
      collectMediaFromObject(child, baseUrl, out, depth + 1);
    });
  }
}

function resolveAbyss(url) {
  if (!/(?:abyss\.|playhydrax\.com)/i.test(url)) return Promise.resolve([]);
  return fetchText(url, {
    headers: { "Accept": "text/html,*/*", "Origin": originOf(url), "Referer": originOf(url) + "/", "User-Agent": USER_AGENT }
  }).then(function (html) {
    var match = html.match(/const\s+datas\s*=\s*"([^"]+)"/i) || html.match(/datas\s*[:=]\s*'([^']+)'/i);
    if (!match) return [];
    return fetchJson("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ text: match[1] })
    }).then(function (data) {
      if (!data || Number(data.status) !== 200) return [];
      var found = {};
      collectMediaFromObject(data.result, url, found, 0);
      return Object.keys(found).map(function (streamUrl) {
        return { url: streamUrl, referer: url, label: "Abyss" };
      });
    });
  }).catch(function () { return []; });
}

function resolveStreamTape(url, referer) {
  if (!/(?:streamtape|strtape|stape|shavetape|streamta\.pe)/i.test(url)) return Promise.resolve([]);
  return fetchText(url, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || url, "User-Agent": USER_AGENT }
  }).then(function (html) {
    var clean = String(html || "").replace(/\\\//g, "/");
    var match = clean.match(/id=["']robotlink["'][^>]*>([^<]+)/i) ||
      clean.match(/id=["']norobotlink["'][^>]*>([^<]+)/i) ||
      clean.match(/(?:robotlink|norobotlink).*?innerHTML\s*=\s*['"]([^'"]+)/i);
    if (!match) return [];
    var streamUrl = String(match[1] || "").trim();
    if (/^\/\//.test(streamUrl)) streamUrl = "https:" + streamUrl;
    if (!/^https?:\/\//i.test(streamUrl)) return [];
    return [{ url: streamUrl, referer: url, label: "StreamTape" }];
  }).catch(function () { return []; });
}

function nestedFramesFromHtml(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};
  function add(raw) {
    var url = absoluteUrl(pageUrl, raw);
    if (!url || url === pageUrl || isBlockedFrame(url)) return;
    found[url] = true;
  }
  $("iframe[src], iframe[data-src], [data-video], [data-url], [data-embed], [data-link]").each(function (_, el) {
    var node = $(el);
    add(node.attr("data-src") || node.attr("src") || node.attr("data-video") || node.attr("data-url") || node.attr("data-embed") || node.attr("data-link"));
  });
  return Object.keys(found).slice(0, 4);
}

function resolveGeneric(url, referer, depth) {
  if (isLikelyStreamUrl(url)) {
    return Promise.resolve([{ url: url, referer: referer || originOf(url) + "/", label: "Direct" }]);
  }
  if (depth > 1) return Promise.resolve([]);

  return fetchResponse(url, {
    headers: { "Accept": "text/html,*/*", "Referer": referer || originOf(url) + "/", "User-Agent": USER_AGENT }
  }).then(function (response) {
    var finalUrl = response.url || url;
    var unpacked = unpackPacker(response.text);
    var direct = mediaUrlsFromText(unpacked, finalUrl).map(function (streamUrl) {
      return { url: streamUrl, referer: finalUrl, label: "Direct" };
    });
    if (direct.length) return direct;

    var frames = nestedFramesFromHtml(response.text, finalUrl);
    if (!frames.length) return [];
    return Promise.all(frames.map(function (frame) {
      return resolveMirror({ url: frame, label: "Nested" }, finalUrl, depth + 1);
    })).then(function (groups) {
      var out = [];
      groups.forEach(function (group) { out = out.concat(group || []); });
      return out;
    });
  }).catch(function () { return []; });
}

function mirrorPriority(mirror) {
  var value = (String(mirror && mirror.label || "") + " " + String(mirror && mirror.url || "")).toLowerCase();
  if (isLikelyStreamUrl(mirror.url)) return 0;
  if (/playmate|playm/.test(value)) return 1;
  if (/streamwish|hglink|wish|filelion|vidhide|filemoon/.test(value)) return 2;
  if (/voe/.test(value)) return 3;
  if (/mixdrop|mxdrop/.test(value)) return 4;
  if (/dsvplay|dood/.test(value)) return 5;
  if (/streamtape|stape/.test(value)) return 6;
  if (/abyss|playhydrax/.test(value)) return 7;
  return 10;
}

function resolveMirror(mirror, pageUrl, depth) {
  var url = String(mirror && mirror.url || "");
  if (!url) return Promise.resolve([]);
  var host = hostOf(url);

  function finish(streams) {
    return (streams || []).map(function (stream) {
      if (!stream.label || stream.label === "Direct" || stream.label === "Nested") {
        stream.label = mirror.label || stream.label || host || "Server";
      }
      return stream;
    });
  }

  return resolvePlaymate(url)
    .then(function (streams) { return streams.length ? streams : resolveStreamWish(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveVoe(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveMixDrop(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveDood(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveStreamTape(url, pageUrl); })
    .then(function (streams) { return streams.length ? streams : resolveAbyss(url); })
    .then(function (streams) { return streams.length ? streams : resolveGeneric(url, pageUrl, depth || 0); })
    .then(function (streams) {
      if (!streams.length) console.log("[PencuriMovie] unresolved host=" + (host || "?") + " url=" + url);
      return finish(streams);
    });
}

function probeDoodStream(stream) {
  var url = String(stream && stream.url || "").trim();
  if (!url) {
    return Promise.resolve({
      stream: stream,
      ok: false,
      status: 0,
      contentType: "",
      totalSize: 0,
      hasFtyp: false,
      score: 0
    });
  }

  var headers = {};
  var supplied = stream.headers || {};
  Object.keys(supplied).forEach(function (key) { headers[key] = supplied[key]; });
  if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
  if (!headers["Accept"]) headers["Accept"] = "*/*";
  if (!headers["Referer"] && !headers["referer"]) {
    headers["Referer"] = stream.referer || "https://dsvplay.com/";
  }
  headers["Range"] = "bytes=0-4095";

  return fetch(url, {
    method: "GET",
    headers: headers
  }).then(function (res) {
    var status = res ? Number(res.status || 0) : 0;
    var contentType = "";
    var contentRange = "";
    var contentLength = "";
    try {
      if (res && res.headers && res.headers.get) {
        contentType = String(res.headers.get("content-type") || "").toLowerCase();
        contentRange = String(res.headers.get("content-range") || "");
        contentLength = String(res.headers.get("content-length") || "");
      }
    } catch (_) {}

    var totalSize = 0;
    var rangeMatch = contentRange.match(/\/(\d+)\s*$/);
    if (rangeMatch) totalSize = Number(rangeMatch[1] || 0);
    if (!totalSize && contentLength && status === 200) totalSize = Number(contentLength || 0);

    var okStatus = status === 200 || status === 206;
    var looksLikeError = /text\/html|application\/json|text\/plain/.test(contentType);
    var baseOk = okStatus && !looksLikeError;

    function finishProbe(hasFtyp) {
      var sizeOk = !totalSize || totalSize >= 5 * 1024 * 1024;
      var ok = baseOk && sizeOk;
      var score = 0;
      if (ok) score += 1000;
      if (hasFtyp) score += 500;
      if (totalSize > 0) score += Math.min(400, Math.floor(totalSize / (1024 * 1024)));

      console.log(
        "[PencuriMovie] DSV probe status=" + status +
        " type='" + contentType + "'" +
        " size=" + totalSize +
        " ftyp=" + hasFtyp +
        " ok=" + ok
      );

      return {
        stream: stream,
        ok: ok,
        status: status,
        contentType: contentType,
        totalSize: totalSize,
        hasFtyp: hasFtyp,
        score: score
      };
    }

    if (!baseOk || !res || typeof res.arrayBuffer !== "function") {
      return finishProbe(false);
    }

    return res.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer || new ArrayBuffer(0));
      var limit = Math.min(bytes.length, 64);
      var ascii = "";
      for (var i = 0; i < limit; i++) {
        var code = bytes[i];
        ascii += code >= 32 && code <= 126 ? String.fromCharCode(code) : ".";
      }
      return finishProbe(ascii.indexOf("ftyp") >= 0);
    }).catch(function () {
      return finishProbe(false);
    });
  }).catch(function (error) {
    console.log("[PencuriMovie] DSV probe failed=" + (error && error.message ? error.message : String(error)));
    return {
      stream: stream,
      ok: false,
      status: 0,
      contentType: "",
      totalSize: 0,
      hasFtyp: false,
      score: 0
    };
  });
}

function verifyFastStream(stream) {
  var url = String(stream && stream.url || "").trim();
  if (!url) return Promise.resolve(null);

  var headers = {};
  var supplied = stream.headers || {};
  Object.keys(supplied).forEach(function (key) { headers[key] = supplied[key]; });
  if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
  if (!headers["Accept"]) headers["Accept"] = "*/*";
  if (!stream.noReferer && !headers["Referer"] && !headers["referer"]) {
    headers["Referer"] = stream.referer || originOf(url) + "/";
  }
  headers["Range"] = "bytes=0-2047";

  var probe = fetch(url, {
    method: "GET",
    headers: headers
  }).then(function (res) {
    var status = res ? Number(res.status || 0) : 0;
    var contentType = "";
    try {
      if (res && res.headers && res.headers.get) {
        contentType = String(res.headers.get("content-type") || "").toLowerCase();
      }
    } catch (_) {}

    if (status !== 200 && status !== 206) return null;
    if (/text\/html|application\/json|text\/plain/.test(contentType)) return null;

    if (/mpegurl|video\//.test(contentType)) {
      console.log("[PencuriMovie] VERIFIED host=" + hostOf(url) +
        " status=" + status + " type='" + contentType + "'");
      return stream;
    }

    if (!res || typeof res.arrayBuffer !== "function") {
      return stream;
    }

    return res.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer || new ArrayBuffer(0));
      var limit = Math.min(bytes.length, 256);
      var ascii = "";
      for (var i = 0; i < limit; i++) {
        var c = bytes[i];
        ascii += c >= 32 && c <= 126 ? String.fromCharCode(c) : ".";
      }

      var looksMedia =
        ascii.indexOf("#EXTM3U") >= 0 ||
        ascii.indexOf("ftyp") >= 0 ||
        /\.(?:m3u8|mp4|m4v|mkv|webm)(?:[?#]|$)/i.test(url);

      if (!looksMedia) return null;

      console.log("[PencuriMovie] VERIFIED host=" + hostOf(url) +
        " status=" + status + " type='" + contentType + "'");
      return stream;
    }).catch(function () {
      return /\.(?:m3u8|mp4|m4v|mkv|webm)(?:[?#]|$)/i.test(url) ? stream : null;
    });
  }).catch(function () {
    return null;
  });

  return Promise.race([
    probe,
    waitMs(1300, null)
  ]);
}

function verifyFirstFast(streams) {
  var list = (streams || []).slice(0, 3);
  var index = 0;

  function next() {
    if (index >= list.length) return Promise.resolve(null);
    var stream = list[index++];
    return verifyFastStream(stream).then(function (verified) {
      return verified || next();
    });
  }

  return next();
}

function firstVerifiedMirror(tasks, maxWaitMs) {
  return new Promise(function (resolve) {
    if (!tasks.length) return resolve([]);
    var finished = false;
    var pending = tasks.length;

    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      resolve([]);
    }, maxWaitMs);

    tasks.forEach(function (task) {
      Promise.resolve(task).then(function (group) {
        if (finished) return;
        return verifyFirstFast(group || []).then(function (stream) {
          if (finished) return;
          if (stream) {
            finished = true;
            clearTimeout(timer);
            resolve([stream]);
            return;
          }

          pending--;
          if (pending <= 0) {
            finished = true;
            clearTimeout(timer);
            resolve([]);
          }
        });
      }).catch(function () {
        if (finished) return;
        pending--;
        if (pending <= 0) {
          finished = true;
          clearTimeout(timer);
          resolve([]);
        }
      });
    });
  });
}

function filterDeadDoodStreams(streams) {
  var list = streams || [];
  var doodIndexes = [];

  list.forEach(function (stream, index) {
    var label = String(stream && stream.label || "").toLowerCase();
    if (/dood|dsv/.test(label)) doodIndexes.push(index);
  });

  if (doodIndexes.length < 2) return Promise.resolve(list);

  return Promise.all(doodIndexes.map(function (index) {
    return probeDoodStream(list[index]).then(function (result) {
      result.index = index;
      return result;
    });
  })).then(function (results) {
    var passing = results.filter(function (result) { return result.ok; });

    if (!passing.length) {
      console.log("[PencuriMovie] DSV probe inconclusive, keeping first DSV only");
      var fallbackIndex = doodIndexes[0];
      return list.filter(function (stream, index) {
        return doodIndexes.indexOf(index) === -1 || index === fallbackIndex;
      });
    }

    passing.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.totalSize !== a.totalSize) return b.totalSize - a.totalSize;
      return a.index - b.index;
    });

    var best = passing[0];
    console.log(
      "[PencuriMovie] DSV selected=1/" + doodIndexes.length +
      " size=" + Number(best.totalSize || 0) +
      " ftyp=" + !!best.hasFtyp
    );

    return list.filter(function (stream, index) {
      return doodIndexes.indexOf(index) === -1 || index === best.index;
    });
  });
}

function qualityFromUrl(url) {
  var value = String(url || "").toLowerCase();
  var m = value.match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)p?(?:[^0-9]|$)/);
  if (m) return m[1] + "p";
  if (/4k/.test(value)) return "2160p";
  return "Auto";
}

function formatStreams(streams) {
  var seen = {};
  var out = [];

  streams.forEach(function (stream) {
    var url = String(stream && stream.url || "").trim();
    if (!url || seen[url]) return;
    seen[url] = true;

    var quality = qualityFromUrl(url);
    var label = String(stream.label || "Server").trim();
    var headers = {};
    var supplied = stream.headers || {};
    Object.keys(supplied).forEach(function (key) { headers[key] = supplied[key]; });
    if (!headers["User-Agent"]) headers["User-Agent"] = USER_AGENT;
    if (!headers["Accept"]) headers["Accept"] = "*/*";

    if (!stream.noReferer) {
      headers["Referer"] = stream.referer || headers["Referer"] || originOf(url) + "/";
    } else {
      delete headers["Referer"];
      delete headers["referer"];
    }

    out.push({
      name: PROVIDER,
      title: label + " • " + quality + " • MalaySub",
      url: url,
      quality: quality,
      headers: headers
    });
  });

  return out;
}

function resolveMirrors(mirrors, pageUrl) {
  var selected = (mirrors || []).slice().sort(function (a, b) {
    return mirrorPriority(a) - mirrorPriority(b);
  }).slice(0, 5);

  console.log("[PencuriMovie] mirrors=" + mirrors.length);
  console.log("[PencuriMovie] mirror hosts=" + selected.map(function (x) {
    return hostOf(x.url) + "[" + String(x.label || "") + "]";
  }).join(" | "));

  if (!selected.length) return Promise.resolve([]);

  // Fast lane: start the best three mirrors together and return as soon as
  // one verified direct media URL is available. Do not wait for every host.
  var fast = selected.slice(0, 3).map(function (mirror) {
    return resolveMirror(mirror, pageUrl, 0).catch(function () { return []; });
  });

  return firstVerifiedMirror(fast, 3000).then(function (ready) {
    if (ready.length) {
      console.log("[PencuriMovie] fast-first ready host=" + hostOf(ready[0].url));
      return ready;
    }

    // Short fallback lane for remaining mirrors.
    var fallback = selected.slice(3, 5).map(function (mirror) {
      return resolveMirror(mirror, pageUrl, 0).catch(function () { return []; });
    });

    return firstVerifiedMirror(fallback, 1800).then(function (fallbackReady) {
      if (fallbackReady.length) {
        console.log("[PencuriMovie] fallback ready host=" + hostOf(fallbackReady[0].url));
      }
      return fallbackReady;
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var startedAt = Date.now();
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);

  console.log("[PencuriMovie] v" + VERSION + " TMDB=" + tmdbId + " type=" + mediaType + (mediaType === "tv" ? " S" + season + "E" + episode : "") + " fastFirst=true");
  console.log("[PencuriMovie] base=" + BASE);

  return getTmdbDetails(tmdbId, mediaType)
    .then(function (details) {
      return findTitle(details, mediaType);
    })
    .then(function (item) {
      if (!item) {
        console.log("[PencuriMovie] title not found");
        return null;
      }
      return loadPlaybackPage(item, mediaType, season, episode);
    })
    .then(function (playback) {
      if (!playback) return [];
      var mirrors = collectEmbedUrls(playback.html, playback.url);
      return resolveMirrors(mirrors, playback.url);
    })
    .then(function (resolved) {
      var streams = formatStreams(resolved || []);
      console.log("[PencuriMovie] v" + VERSION +
        " playable sources=" + streams.length +
        " elapsed=" + (Date.now() - startedAt) + "ms");
      return streams;
    })
    .catch(function (error) {
      console.log("[PencuriMovie] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
