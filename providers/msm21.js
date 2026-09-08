const PROVIDER = "MSM21";
const BASE_CANDIDATES = [
  "https://pencurimoviesubmalay26.site",
  "https://movisubmalay.org"
];
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

var resolvedBasePromise = null;

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
    .replace(/\\\//g, "/");

  if (!raw || raw === "#" || /^javascript:/i.test(raw)) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return "https:" + raw;

  var root = originOf(base);
  if (raw.charAt(0) === "/") return root + raw;

  var cleanBase = String(base || "").split("#")[0].split("?")[0];
  cleanBase = cleanBase.substring(0, cleanBase.lastIndexOf("/") + 1);
  return cleanBase + raw;
}

function resolveBase() {
  if (resolvedBasePromise) return resolvedBasePromise;

  var index = 0;

  function next() {
    if (index >= BASE_CANDIDATES.length) {
      throw new Error("MSM21 base URL unavailable");
    }

    var base = BASE_CANDIDATES[index++];
    return fetchResponse(base + "/", {
      headers: {
        "Accept": "text/html,*/*",
        "User-Agent": USER_AGENT
      }
    }).then(function (response) {
      var resolved = originOf(response.url || base);
      console.log("[MSM21] base=" + resolved);
      return resolved;
    }).catch(function () {
      return next();
    });
  }

  resolvedBasePromise = Promise.resolve().then(next);
  return resolvedBasePromise;
}

function normalizeTitle(value) {
  var text = String(value || "").toLowerCase();

  try {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {}

  return text
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripYear(value) {
  return String(value || "")
    .replace(/\s*\(((?:19|20)\d{2})\)\s*$/i, "")
    .trim();
}

function yearFromTitle(value) {
  var m = String(value || "").match(/\(((?:19|20)\d{2})\)\s*$/);
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

function buildQueries(details) {
  var out = [];

  function add(v) {
    v = String(v || "").trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  }

  add(details.title);
  add(details.originalTitle);

  (details.alternativeTitles || []).slice(0, 3).forEach(add);
  return out.slice(0, 5);
}

function parseSearchResults(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var results = [];

  $("div.display-item").each(function (_, element) {
    var box = $(element);
    var anchor = box.find("div.item-box > a[href], a.ml-mask[href], a[href]").first();
    var href = absoluteUrl(pageUrl, anchor.attr("href"));
    if (!href) return;

    var rawTitle = String(
      anchor.attr("title") ||
      box.find(".item-desc-title h3, .item-data h3, h3").first().text() ||
      ""
    ).replace(/\s+/g, " ").trim();

    if (!rawTitle) return;

    var typeAttr = String(anchor.attr("data-ptype") || "").toLowerCase();
    var isTv = typeAttr.indexOf("tv") >= 0 || /\/tvshows\//i.test(href);

    results.push({
      title: stripYear(rawTitle),
      rawTitle: rawTitle,
      year: yearFromTitle(rawTitle),
      url: href,
      mediaType: isTv ? "tv" : "movie"
    });
  });

  return results;
}

function searchSite(base, query) {
  var url = base + "/?s=" + encodeURIComponent(query);

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    return parseSearchResults(html, url);
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

function scoreCandidate(item, details, mediaType) {
  if (!item || item.mediaType !== mediaType) return null;

  var targets = acceptedTitleSet(details);
  var title = normalizeTitle(item.title);

  if (!targets[title]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(item.year || 0);

  if (
    mediaType === "movie" &&
    targetYear &&
    itemYear &&
    Math.abs(targetYear - itemYear) > 1
  ) {
    return null;
  }

  var score = 100;
  if (title === normalizeTitle(details.title)) score += 40;
  if (targetYear && itemYear && targetYear === itemYear) score += 30;
  return score;
}

function findBestTitle(base, details, mediaType) {
  var queries = buildQueries(details);

  return Promise.all(queries.map(function (query) {
    return searchSite(base, query).catch(function (error) {
      console.log("[MSM21] search failed query='" + query + "' error=" + error.message);
      return [];
    });
  })).then(function (groups) {
    var map = {};

    groups.forEach(function (items) {
      items.forEach(function (item) {
        if (!map[item.url]) map[item.url] = item;
      });
    });

    var ranked = Object.keys(map).map(function (key) {
      var item = map[key];
      return {
        item: item,
        score: scoreCandidate(item, details, mediaType)
      };
    }).filter(function (x) {
      return typeof x.score === "number";
    }).sort(function (a, b) {
      return b.score - a.score;
    });

    if (!ranked.length) {
      var sample = Object.keys(map).slice(0, 8).map(function (key) {
        var x = map[key];
        return x.rawTitle + " [" + x.mediaType + "]";
      }).join(" | ");

      console.log(
        "[MSM21] no title match for '" + details.title + "'" +
        (sample ? " candidates=" + sample : "")
      );
      return null;
    }

    console.log(
      "[MSM21] matched title='" + ranked[0].item.rawTitle +
      "' url=" + ranked[0].item.url
    );

    return ranked[0].item;
  });
}

function episodeNumberFromElement($, el) {
  var node = $(el);
  var text = node.find(".ep-num").first().text() || node.text() || "";
  var m = String(text).match(/(\d+)/);
  if (m) return Number(m[1]);

  var href = String(node.attr("href") || "");
  m = href.match(/(?:episode|ep)[-_\/]?(\d+)/i);
  return m ? Number(m[1]) : null;
}

function findEpisodeUrl(html, pageUrl, season, episode) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var wantedSeason = Number(season || 1);
  var wantedEpisode = Number(episode || 1);
  var found = "";

  $("ul.episodes-list").each(function (_, listEl) {
    if (found) return;

    var list = $(listEl);
    var id = String(list.attr("id") || "");
    var seasonMatch = id.match(/(\d+)\s*$/);
    var listSeason = seasonMatch ? Number(seasonMatch[1]) : 1;

    if (listSeason !== wantedSeason) return;

    list.find("li a[href]").each(function (_, aEl) {
      if (found) return;
      var ep = episodeNumberFromElement($, aEl);
      if (ep === wantedEpisode) {
        found = absoluteUrl(pageUrl, $(aEl).attr("href"));
      }
    });
  });

  if (found) return found;

  $("a[href]").each(function (_, aEl) {
    if (found) return;

    var a = $(aEl);
    var href = absoluteUrl(pageUrl, a.attr("href"));
    var text = String(a.text() || "").replace(/\s+/g, " ").trim();
    var combined = (href + " " + text).toLowerCase();

    var sOk =
      new RegExp("(?:season|s)[-_ /]?" + wantedSeason + "(?:\\D|$)", "i").test(combined) ||
      wantedSeason === 1;

    var eOk =
      new RegExp("(?:episode|ep|e)[-_ /]?" + wantedEpisode + "(?:\\D|$)", "i").test(combined);

    if (sOk && eOk) found = href;
  });

  return found;
}

function loadPlaybackPage(base, item, mediaType, season, episode) {
  return fetchText(item.url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    if (mediaType === "movie") {
      return {
        url: item.url,
        html: html
      };
    }

    var episodeUrl = findEpisodeUrl(html, item.url, season, episode);

    if (!episodeUrl) {
      console.log(
        "[MSM21] episode not found S" + Number(season || 1) +
        "E" + Number(episode || 1)
      );
      return null;
    }

    console.log("[MSM21] episode url=" + episodeUrl);

    return fetchText(episodeUrl, {
      headers: {
        "Accept": "text/html,*/*",
        "Referer": item.url,
        "User-Agent": USER_AGENT
      }
    }).then(function (episodeHtml) {
      return {
        url: episodeUrl,
        html: episodeHtml
      };
    });
  });
}

function collectStaticMirrors(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw, label) {
    var url = absoluteUrl(pageUrl, raw);
    if (!url || /youtube\.com|youtu\.be|facebook\.com|t\.me\//i.test(url)) return;
    found[url] = label || "MSM21";
  }

  $(
    ".player-display iframe[src], .player-display iframe[data-src]," +
    " iframe.metaframe[src], iframe.metaframe[data-src]," +
    " video[src], video source[src], iframe[src], iframe[data-src]"
  ).each(function (_, el) {
    var node = $(el);
    add(node.attr("data-src") || node.attr("src"), "MSM21");
  });

  return Object.keys(found).map(function (url) {
    return { url: url, label: found[url] };
  });
}

function extractPlayerOptions(html) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var out = [];

  $("li.zetaflix_player_option[data-post][data-nume][data-type]").each(function (_, el) {
    var node = $(el);
    var nume = String(node.attr("data-nume") || "").trim();
    var post = String(node.attr("data-post") || "").trim();
    var type = String(node.attr("data-type") || "").trim();

    if (!nume || /^fake$/i.test(nume) || !post || !type) return;

    var label = [
      node.find(".opt-titl").first().text(),
      node.find(".opt-name").first().text()
    ].join(" ").replace(/\s+/g, " ").trim() || ("Server " + nume);

    out.push({
      post: post,
      nume: nume,
      type: type,
      label: label
    });
  });

  var seen = {};
  return out.filter(function (x) {
    var key = x.post + "|" + x.nume + "|" + x.type;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function extractUrlsFromEmbedHtml(embedHtml, pageUrl) {
  var cheerio = getCheerio();
  var html = String(embedHtml || "").trim();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw) {
    var url = absoluteUrl(pageUrl, raw);
    if (!url || /youtube\.com|youtu\.be|facebook\.com|t\.me\//i.test(url)) return;
    found[url] = true;
  }

  if (/^https?:\/\//i.test(html)) add(html);

  $("iframe[src], iframe[data-src], video[src], source[src]").each(function (_, el) {
    var node = $(el);
    add(node.attr("data-src") || node.attr("src"));
  });

  var clean = html.replace(/\\\//g, "/");
  var matches = clean.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
  matches.slice(0, 20).forEach(add);

  return Object.keys(found);
}

function fetchOptionMirrors(base, pageUrl, option) {
  var body =
    "action=zeta_player_ajax" +
    "&post=" + encodeURIComponent(option.post) +
    "&nume=" + encodeURIComponent(option.nume) +
    "&type=" + encodeURIComponent(option.type);

  return fetchText(base + "/wp-admin/admin-ajax.php", {
    method: "POST",
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": pageUrl,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": USER_AGENT
    },
    body: body
  }).then(function (text) {
    var data;

    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    var embed = data && (
      data.embed_url ||
      data.embedUrl ||
      data.url ||
      data.result
    );

    if (!embed) embed = text;

    return extractUrlsFromEmbedHtml(embed, pageUrl).map(function (url) {
      return {
        url: url,
        label: option.label
      };
    });
  }).catch(function (error) {
    console.log(
      "[MSM21] ajax option failed " + option.label + " error=" + error.message
    );
    return [];
  });
}

function collectMirrors(base, playback) {
  var options = extractPlayerOptions(playback.html);

  if (!options.length) {
    var staticMirrors = collectStaticMirrors(playback.html, playback.url);
    console.log("[MSM21] static mirrors=" + staticMirrors.length);
    return Promise.resolve(staticMirrors);
  }

  var selected = options.slice(0, 8);

  return Promise.all(selected.map(function (option) {
    return fetchOptionMirrors(base, playback.url, option);
  })).then(function (groups) {
    var map = {};

    groups.forEach(function (group) {
      group.forEach(function (mirror) {
        if (!map[mirror.url]) map[mirror.url] = mirror;
      });
    });

    var mirrors = Object.keys(map).map(function (key) { return map[key]; });
    console.log("[MSM21] mirrors=" + mirrors.length);
    return mirrors;
  });
}

function mediaUrlsFromText(text, baseUrl) {
  var input = String(text || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  var found = {};

  function add(raw) {
    raw = String(raw || "").replace(/["'\\]+$/g, "");
    var url = absoluteUrl(baseUrl, raw);
    if (!url) return;

    if (/\.(?:m3u8|mp4|mkv|webm)(?:[?#]|$)/i.test(url)) {
      found[url] = true;
    }
  }

  var absolute = input.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
  absolute.forEach(add);

  var quoted = input.match(/["']([^"']+\.(?:m3u8|mp4|mkv|webm)(?:\?[^"']*)?)["']/ig) || [];
  quoted.forEach(function (value) {
    add(value.slice(1, -1));
  });

  return Object.keys(found);
}

function nestedFramesFromHtml(html, pageUrl) {
  var cheerio = getCheerio();
  var $ = cheerio.load(html);
  var found = {};

  function add(raw) {
    var url = absoluteUrl(pageUrl, raw);
    if (
      !url ||
      url === pageUrl ||
      /youtube\.com|youtu\.be|facebook\.com|googlesyndication|doubleclick/i.test(url)
    ) {
      return;
    }
    found[url] = true;
  }

  $("iframe[src], iframe[data-src], [data-video], [data-url], [data-embed]").each(function (_, el) {
    var node = $(el);
    add(
      node.attr("data-src") ||
      node.attr("src") ||
      node.attr("data-video") ||
      node.attr("data-url") ||
      node.attr("data-embed")
    );
  });

  return Object.keys(found).slice(0, 6);
}

function randomToken(length) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var out = "";
  for (var i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function resolveDood(url, referer) {
  if (!/(?:dood|dsvplay|ds2play|vide0\.net|myvidplay)/i.test(url)) {
    return Promise.resolve([]);
  }

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || url,
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var passMatch = html.match(/['"](\/pass_md5[^'"]+)['"]/i);
    var tokenMatch = html.match(/[?&]token=([a-z0-9]+)[&'"]/i);

    if (!passMatch || !tokenMatch) return [];

    var passUrl = absoluteUrl(url, passMatch[1]);
    return fetchText(passUrl, {
      headers: {
        "Accept": "*/*",
        "Referer": url,
        "User-Agent": USER_AGENT
      }
    }).then(function (prefix) {
      var finalUrl =
        String(prefix || "").trim() +
        randomToken(10) +
        "?token=" + tokenMatch[1] +
        "&expiry=" + Date.now();

      return [{
        url: finalUrl,
        referer: url,
        label: "Dood"
      }];
    });
  }).catch(function () {
    return [];
  });
}

function collectMediaFromObject(value, baseUrl, out, depth) {
  if (depth > 5 || value == null) return;

  if (typeof value === "string") {
    mediaUrlsFromText(value, baseUrl).forEach(function (url) {
      out[url] = true;
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(function (x) {
      collectMediaFromObject(x, baseUrl, out, depth + 1);
    });
    return;
  }

  if (typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      collectMediaFromObject(value[key], baseUrl, out, depth + 1);
    });
  }
}

function resolveAbyss(url) {
  if (!/(?:abyss\.|playhydrax\.com)/i.test(url)) {
    return Promise.resolve([]);
  }

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Origin": originOf(url),
      "Referer": originOf(url) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var m = html.match(/const\s+datas\s*=\s*"([^"]+)"/i);
    if (!m) return [];

    return fetchJson("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ text: m[1] })
    }).then(function (data) {
      if (!data || Number(data.status) !== 200) return [];

      var found = {};
      collectMediaFromObject(data.result, url, found, 0);

      return Object.keys(found).map(function (streamUrl) {
        return {
          url: streamUrl,
          referer: originOf(url) + "/",
          label: "Abyss"
        };
      });
    });
  }).catch(function () {
    return [];
  });
}

function resolveGeneric(url, referer, depth) {
  if (/\.(?:m3u8|mp4|mkv|webm)(?:[?#]|$)/i.test(url)) {
    return Promise.resolve([{
      url: url,
      referer: referer || originOf(url) + "/",
      label: "Direct"
    }]);
  }

  if (depth > 1) return Promise.resolve([]);

  return fetchResponse(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || originOf(url) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (response) {
    var finalUrl = response.url || url;
    var direct = mediaUrlsFromText(response.text, finalUrl).map(function (streamUrl) {
      return {
        url: streamUrl,
        referer: finalUrl,
        label: "Direct"
      };
    });

    if (direct.length) return direct;

    var frames = nestedFramesFromHtml(response.text, finalUrl).slice(0, 3);
    if (!frames.length) return [];

    return Promise.all(frames.map(function (frame) {
      return resolveMirror({
        url: frame,
        label: "Nested"
      }, finalUrl, depth + 1);
    })).then(function (groups) {
      var out = [];
      groups.forEach(function (group) {
        out = out.concat(group);
      });
      return out;
    });
  }).catch(function () {
    return [];
  });
}

function resolveMirror(mirror, pageUrl, depth) {
  var url = String(mirror && mirror.url || "");
  if (!url) return Promise.resolve([]);

  return resolveAbyss(url).then(function (streams) {
    if (streams.length) return streams;

    return resolveDood(url, pageUrl).then(function (doodStreams) {
      if (doodStreams.length) return doodStreams;
      return resolveGeneric(url, pageUrl, depth || 0);
    });
  }).then(function (streams) {
    return streams.map(function (stream) {
      if (!stream.label || stream.label === "Direct" || stream.label === "Nested") {
        stream.label = mirror.label || stream.label || "MSM21";
      }
      return stream;
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
    var label = String(stream.label || "MSM21").trim();

    out.push({
      name: PROVIDER,
      title: label + " • " + quality + " • MalaySub",
      url: url,
      quality: quality,
      headers: {
        "Referer": stream.referer || originOf(url) + "/",
        "User-Agent": USER_AGENT
      }
    });
  });

  return out;
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" ? "tv" : "movie";
  season = Number(season || 1);
  episode = Number(episode || 1);

  console.log(
    "[MSM21] TMDB=" + tmdbId +
    " type=" + mediaType +
    (mediaType === "tv" ? " S" + season + "E" + episode : "")
  );

  var base;

  return resolveBase()
    .then(function (resolved) {
      base = resolved;
      return getTmdbDetails(tmdbId, mediaType);
    })
    .then(function (details) {
      return findBestTitle(base, details, mediaType);
    })
    .then(function (item) {
      if (!item) return null;
      return loadPlaybackPage(base, item, mediaType, season, episode);
    })
    .then(function (playback) {
      if (!playback) return [];
      return collectMirrors(base, playback).then(function (mirrors) {
        return Promise.all(mirrors.slice(0, 8).map(function (mirror) {
          return resolveMirror(mirror, playback.url, 0).catch(function () {
            return [];
          });
        }));
      });
    })
    .then(function (groups) {
      if (!Array.isArray(groups)) return [];

      var flat = [];
      groups.forEach(function (group) {
        flat = flat.concat(group || []);
      });

      var streams = formatStreams(flat);
      console.log("[MSM21] v1.0.0 playable sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[MSM21] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
