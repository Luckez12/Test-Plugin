const PROVIDER = "MSM21";
const BASE_CANDIDATES = [
  "https://pencurimoviesubmalay26.site",
  "https://movisubmalay.org"
];
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
const PLAYMATE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0";

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
  // The current MSM21 domain is already known. Avoid a homepage probe because
  // VUEO gives providers a short scan budget and that probe can cost 1-2s.
  if (!resolvedBasePromise) {
    resolvedBasePromise = Promise.resolve(BASE_CANDIDATES[0]);
  }
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

function parsePageIdentity(html) {
  var cheerio = getCheerio();
  var $ = cheerio.load(String(html || ""));
  var rawTitle = String(
    $(".details-title h3").first().text() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text() ||
    ""
  ).replace(/\s+/g, " ").trim();

  rawTitle = rawTitle
    .replace(/\s*[-–|]\s*movisubmalay(?:\.org)?\s*$/i, "")
    .trim();

  var year = yearFromTitle(rawTitle);
  if (!year) {
    $(".details-info p").each(function (_, el) {
      if (year) return;
      var row = $(el);
      var strong = String(row.find("strong").first().text() || "")
        .trim().replace(/:$/, "");
      if (/^year$/i.test(strong)) {
        var m = String(row.text() || "").match(/((?:19|20)\d{2})/);
        if (m) year = Number(m[1]);
      }
    });
  }

  return {
    title: stripYear(rawTitle),
    rawTitle: rawTitle,
    year: year
  };
}

function validateDirectPage(html, details, mediaType) {
  var identity = parsePageIdentity(html);
  if (!identity.title) return null;

  var accepted = acceptedTitleSet(details);
  if (!accepted[normalizeTitle(identity.title)]) return null;

  var targetYear = Number(details.year || 0);
  var itemYear = Number(identity.year || 0);
  if (
    mediaType === "movie" &&
    targetYear && itemYear &&
    Math.abs(targetYear - itemYear) > 1
  ) {
    return null;
  }

  return identity;
}

function tryDirectTitlePage(base, details, mediaType) {
  var slug = slugifyTitle(details.title || details.originalTitle || "");
  if (!slug) return Promise.resolve(null);

  var year = String(details.year || "").trim();
  var path = mediaType === "movie"
    ? "/movies/" + slug + (year ? "-" + year : "") + "/"
    : "/tvshows/" + slug + "/";
  var url = base + path;

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var identity = validateDirectPage(html, details, mediaType);
    if (!identity) return null;

    console.log("[MSM21] fast title='" + identity.rawTitle + "' url=" + url);
    return {
      title: identity.title,
      rawTitle: identity.rawTitle,
      year: identity.year,
      url: url,
      mediaType: mediaType,
      html: html
    };
  }).catch(function () {
    return null;
  });
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
  var index = 0;
  var seen = {};

  function next() {
    if (index >= queries.length) {
      var sample = Object.keys(seen).slice(0, 8).map(function (key) {
        var x = seen[key];
        return x.rawTitle + " [" + x.mediaType + "]";
      }).join(" | ");

      console.log(
        "[MSM21] no title match for '" + details.title + "'" +
        (sample ? " candidates=" + sample : "")
      );
      return Promise.resolve(null);
    }

    var query = queries[index++];
    return searchSite(base, query).then(function (items) {
      items.forEach(function (item) {
        if (!seen[item.url]) seen[item.url] = item;
      });

      var ranked = items.map(function (item) {
        return { item: item, score: scoreCandidate(item, details, mediaType) };
      }).filter(function (x) {
        return typeof x.score === "number";
      }).sort(function (a, b) {
        return b.score - a.score;
      });

      if (ranked.length) {
        console.log(
          "[MSM21] matched title='" + ranked[0].item.rawTitle +
          "' url=" + ranked[0].item.url
        );
        return ranked[0].item;
      }

      return next();
    }).catch(function (error) {
      console.log("[MSM21] search failed query='" + query + "' error=" + error.message);
      return next();
    });
  }

  return next();
}

function findTitleFast(base, details, mediaType) {
  return tryDirectTitlePage(base, details, mediaType).then(function (direct) {
    if (direct) return direct;
    return findBestTitle(base, details, mediaType);
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
  var pagePromise = item && item.html
    ? Promise.resolve(item.html)
    : fetchText(item.url, {
        headers: {
          "Accept": "text/html,*/*",
          "Referer": base + "/",
          "User-Agent": USER_AGENT
        }
      });

  return pagePromise.then(function (html) {
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

function playerOptionPriority(option) {
  var value = String(option && option.label || "").toLowerCase();
  if (/fire|wish|hgl/.test(value)) return 0;
  if (/playm/.test(value)) return 1;
  if (/byse/.test(value)) return 2;
  if (/voe/.test(value)) return 3;
  if (/mix/.test(value)) return 4;
  if (/dsv|dood/.test(value)) return 5;
  if (/abyss/.test(value)) return 6;
  if (/veev/.test(value)) return 7;
  if (/player|playe|ezpla|rpm|seek|p2p|upns/.test(value)) return 20;
  return 10;
}

function mirrorPriority(mirror) {
  var value = (String(mirror && mirror.label || "") + " " +
    String(mirror && mirror.url || "")).toLowerCase();
  if (/streamwish|hglink|wish|fire/.test(value)) return 0;
  if (/playm/.test(value)) return 1;
  if (/byse/.test(value)) return 2;
  if (/voe/.test(value)) return 3;
  if (/mixdrop|mixdr/.test(value)) return 4;
  if (/dsvplay|dood/.test(value)) return 5;
  if (/abyss|playhydrax/.test(value)) return 6;
  if (/playerx|p2pstream|upns|ezpla|rpmpl|seekp/.test(value)) return 20;
  return 10;
}

function isFastMirror(mirror) {
  var value = (String(mirror && mirror.label || "") + " " +
    String(mirror && mirror.url || "")).toLowerCase();

  return isLikelyStreamUrl(String(mirror && mirror.url || "")) ||
    /playmate|playm|streamwish|hglink|wish|fire|voe|mixdrop|mixdr|dsvplay|dood/.test(value);
}

function resolveMirrorsFastFirst(mirrors, pageUrl) {
  var limited = (mirrors || []).slice(0, 6);

  var playmate = limited.filter(function (mirror) {
    return /playmate\.to|playmate|playm/i.test(
      String(mirror && mirror.url || "") + " " + String(mirror && mirror.label || "")
    );
  });

  var reliable = limited.filter(function (mirror) {
    var value = (String(mirror && mirror.url || "") + " " +
      String(mirror && mirror.label || "")).toLowerCase();
    return playmate.indexOf(mirror) === -1 &&
      /dsvplay|dood|streamwish|hglink|wish|fire|voe/.test(value);
  });

  var fallback = limited.filter(function (mirror) {
    return playmate.indexOf(mirror) === -1 && reliable.indexOf(mirror) === -1;
  });

  function resolveGroup(group) {
    return Promise.all(group.map(function (mirror) {
      return resolveMirror(mirror, pageUrl, 0).catch(function () {
        return [];
      });
    }));
  }

  function streamCount(groups) {
    var count = 0;
    (groups || []).forEach(function (group) {
      count += Array.isArray(group) ? group.length : 0;
    });
    return count;
  }

  function tryReliable() {
    if (!reliable.length) return tryFallback();
    return resolveGroup(reliable).then(function (groups) {
      var count = streamCount(groups);
      if (count > 0) {
        console.log("[MSM21] reliable streams=" + count + " fallback mirrors skipped=" + fallback.length);
        return groups;
      }
      return tryFallback();
    });
  }

  function tryFallback() {
    if (!fallback.length) return Promise.resolve([]);
    console.log("[MSM21] reliable path empty, trying fallback mirrors=" + fallback.length);
    return resolveGroup(fallback);
  }

  if (!playmate.length) return tryReliable();

  console.log("[MSM21] Playmate priority host=" + hostOf(playmate[0].url));
  return resolveGroup(playmate).then(function (groups) {
    var count = streamCount(groups);
    if (count > 0) {
      console.log("[MSM21] Playmate streams=" + count + " other mirrors skipped=" + (reliable.length + fallback.length));
      return groups;
    }
    return tryReliable();
  });
}

function collectMirrors(base, playback) {
  var options = extractPlayerOptions(playback.html);

  if (!options.length) {
    var staticMirrors = collectStaticMirrors(playback.html, playback.url);
    console.log("[MSM21] static mirrors=" + staticMirrors.length);
    console.log(
      "[MSM21] mirror hosts=" +
      staticMirrors.map(function (x) {
        return hostOf(x.url) + "[" + String(x.label || "") + "]";
      }).join(" | ")
    );
    return Promise.resolve(staticMirrors.sort(function (a, b) {
      return mirrorPriority(a) - mirrorPriority(b);
    }));
  }

  var selected = options.slice().sort(function (a, b) {
    return playerOptionPriority(a) - playerOptionPriority(b);
  }).slice(0, 6);

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
    console.log(
      "[MSM21] mirror hosts=" +
      mirrors.map(function (x) {
        return hostOf(x.url) + "[" + String(x.label || "") + "]";
      }).join(" | ")
    );
    mirrors.forEach(function (x) {
      console.log("[MSM21] mirror " + String(x.label || "") + " -> " + x.url);
    });
    return mirrors.sort(function (a, b) {
      return mirrorPriority(a) - mirrorPriority(b);
    });
  });
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

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function hostOf(url) {
  var m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function unpackPacker(source) {
  var text = String(source || "");
  var marker = "eval(function(p,a,c,k,e,d)";
  if (text.indexOf(marker) === -1) return text;

  var re = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/;
  var match = re.exec(text);
  if (!match) return text;

  var payload = match[1]
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
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
    payload = payload.replace(
      new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"),
      symtab[i]
    );
  }

  return payload;
}

function resolveMixDrop(url, referer) {
  if (!/(?:mixdrop|mxdrop|mdy48tn97)/i.test(url)) {
    return Promise.resolve([]);
  }

  var embedUrl = String(url).replace("/f/", "/e/");

  return fetchText(embedUrl, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || embedUrl,
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var match = unpacked.match(/wurl.*?=.*?["']([^"']+)["'];?/i);
    if (!match) return [];

    var streamUrl = String(match[1] || "");
    if (/^\/\//.test(streamUrl)) streamUrl = "https:" + streamUrl;
    if (!/^https?:\/\//i.test(streamUrl)) return [];

    return [{
      url: streamUrl,
      referer: embedUrl,
      label: "MixDrop"
    }];
  }).catch(function () {
    return [];
  });
}

function resolveStreamWish(url, referer) {
  if (!/(?:streamwish|hglink|wish|filelions|filelion|rapidplayers|dwish|embedwish|flaswish|cdnwish|hlswish)/i.test(url)) {
    return Promise.resolve([]);
  }

  return fetchText(url, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || url,
      "User-Agent": USER_AGENT
    }
  }).then(function (html) {
    var unpacked = unpackPacker(html);
    var candidates = mediaUrlsFromText(unpacked, url);

    if (!candidates.length) {
      var matches = unpacked.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
      candidates = matches.filter(isLikelyStreamUrl);
    }

    return candidates.map(function (streamUrl) {
      return {
        url: streamUrl,
        referer: url,
        label: "StreamWish"
      };
    });
  }).catch(function () {
    return [];
  });
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

    var b1 = (e1 << 2) | (e2 >> 4);
    output += String.fromCharCode(b1);

    if (e3 !== 64 && e3 >= 0) {
      var b2 = ((e2 & 15) << 4) | (e3 >> 2);
      output += String.fromCharCode(b2);
    }

    if (e4 !== 64 && e4 >= 0 && e3 >= 0) {
      var b3 = ((e3 & 3) << 6) | e4;
      output += String.fromCharCode(b3);
    }
  }

  return output;
}

function binaryToUtf8(binary) {
  try {
    var encoded = "";
    for (var i = 0; i < binary.length; i++) {
      encoded += "%" + ("0" + binary.charCodeAt(i).toString(16)).slice(-2);
    }
    return decodeURIComponent(encoded);
  } catch (_) {
    return binary;
  }
}

function decryptVoe(encoded) {
  try {
    var step1 = rot13(encoded);
    var patterns = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];

    patterns.forEach(function (pattern) {
      step1 = step1.split(pattern).join("_");
    });

    var step2 = step1.replace(/_/g, "");
    var step3 = base64DecodeBinary(step2);
    var step4 = "";

    for (var i = 0; i < step3.length; i++) {
      step4 += String.fromCharCode(step3.charCodeAt(i) - 3);
    }

    var step5 = step4.split("").reverse().join("");
    var decoded = binaryToUtf8(base64DecodeBinary(step5));
    return JSON.parse(decoded);
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
      headers: {
        "Accept": "text/html,*/*",
        "Referer": referer || target,
        "User-Agent": USER_AGENT
      }
    });
  }

  return load(url).then(function (response) {
    var redirect = response.text.match(/window\.location\.href\s*=\s*'([^']+)'/i);

    if (redirect) {
      return load(absoluteUrl(response.url || url, redirect[1]));
    }

    return response;
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

    if (data.source && isLikelyStreamUrl(data.source)) {
      out.push({
        url: data.source,
        referer: response.url || url,
        label: "VOE"
      });
    }

    if (data.direct_access_url && isLikelyStreamUrl(data.direct_access_url)) {
      out.push({
        url: data.direct_access_url,
        referer: response.url || url,
        label: "VOE MP4"
      });
    }

    return out;
  }).catch(function () {
    return [];
  });
}

function mediaUrlsFromText(text, baseUrl) {
  var input = decodeHtmlEntities(String(text || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");

  var found = {};

  function add(raw) {
    raw = String(raw || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/["'\\]+$/g, "");

    var url = absoluteUrl(baseUrl, raw);
    if (!url) return;

    if (isLikelyStreamUrl(url)) {
      found[url] = true;
    }
  }

  var absolute = input.match(/https?:\/\/[^\s"'<>\\]+/ig) || [];
  absolute.forEach(add);

  var protocolRelative = input.match(/\/\/[a-z0-9.-]+\/[^\s"'<>\\]+/ig) || [];
  protocolRelative.forEach(add);

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

function resolvePlaymate(url) {
  if (!/playmate\.to/i.test(String(url || ""))) {
    return Promise.resolve([]);
  }

  var cleanUrl = String(url || "").split("#")[0].split("?")[0].replace(/\/+$/, "");
  var id = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
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

    console.log("[MSM21] Playmate direct=" + hostOf(streamUrl));
    return [{
      url: streamUrl,
      label: "Playmate",
      noReferer: true,
      headers: {
        "Accept": "*/*",
        "User-Agent": PLAYMATE_USER_AGENT
      }
    }];
  }).catch(function (error) {
    console.log("[MSM21] Playmate resolver error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function resolveDood(url, referer) {
  if (!/(?:dood|dsvplay|ds2play|vide0\.net|myvidplay)/i.test(url)) {
    return Promise.resolve([]);
  }

  var embedUrl = String(url).replace("/d/", "/e/");

  return fetchResponse(embedUrl, {
    headers: {
      "Accept": "text/html,*/*",
      "Referer": referer || originOf(embedUrl) + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (response) {
    var html = response.text;
    var finalEmbedUrl = response.url || embedUrl;
    var host = originOf(finalEmbedUrl);
    var passMatch = html.match(/\/pass_md5\/[^'"\s<]+/i);
    if (!passMatch) return [];

    var passPath = passMatch[0];
    var passUrl = /^https?:\/\//i.test(passPath) ? passPath : host + passPath;
    var token = passUrl.substring(passUrl.lastIndexOf("/") + 1);
    if (!token) return [];

    return fetchText(passUrl, {
      headers: {
        "Accept": "*/*",
        "Referer": finalEmbedUrl,
        "User-Agent": USER_AGENT
      }
    }).then(function (prefix) {
      var base = String(prefix || "").trim();
      if (!/^https?:\/\//i.test(base)) return [];

      var finalUrl = base + randomToken(10) + "?token=" + encodeURIComponent(token);
      console.log("[MSM21] Dood direct=" + hostOf(finalUrl));

      return [{
        url: finalUrl,
        referer: host + "/",
        label: "Dood",
        headers: {
          "Accept": "*/*",
          "Referer": host + "/",
          "User-Agent": USER_AGENT
        }
      }];
    });
  }).catch(function (error) {
    console.log("[MSM21] Dood resolver error=" + (error && error.message ? error.message : String(error)));
    return [];
  });
}

function collectMediaFromObject(value, baseUrl, out, depth) {
  if (depth > 7 || value == null) return;

  if (typeof value === "string") {
    var clean = decodeHtmlEntities(value).replace(/\\\//g, "/").trim();

    if (/^https?:\/\//i.test(clean) && isLikelyStreamUrl(clean)) {
      out[clean] = true;
    }

    mediaUrlsFromText(clean, baseUrl).forEach(function (url) {
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
      var child = value[key];

      if (
        typeof child === "string" &&
        /^(?:file|url|src|source|stream|playlist|hls|video)$/i.test(key)
      ) {
        var candidate = decodeHtmlEntities(child).replace(/\\\//g, "/").trim();
        if (/^https?:\/\//i.test(candidate) && isLikelyStreamUrl(candidate)) {
          out[candidate] = true;
        }
      }

      collectMediaFromObject(child, baseUrl, out, depth + 1);
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
    var match =
      html.match(/const\s+datas\s*=\s*"([^"]+)"/i) ||
      html.match(/datas\s*[:=]\s*'([^']+)'/i);

    if (!match) {
      console.log("[MSM21] Abyss datas not found host=" + hostOf(url));
      return [];
    }

    return fetchJson("https://enc-dec.app/api/dec-abyss", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT
      },
      body: JSON.stringify({ text: match[1] })
    }).then(function (data) {
      if (!data || Number(data.status) !== 200) {
        console.log("[MSM21] Abyss decrypt failed");
        return [];
      }

      var found = {};
      collectMediaFromObject(data.result, url, found, 0);

      var urls = Object.keys(found);
      console.log("[MSM21] Abyss streams=" + urls.length);

      return urls.map(function (streamUrl) {
        return {
          url: streamUrl,
          referer: url,
          label: "Abyss"
        };
      });
    });
  }).catch(function (error) {
    console.log(
      "[MSM21] Abyss resolver error=" +
      (error && error.message ? error.message : String(error))
    );
    return [];
  });
}

function resolveGeneric(url, referer, depth) {
  if (/(?:playerx\.|p2pstream\.|upns\.live|ezpla|rpmpl|seekp)/i.test(url)) {
    console.log("[MSM21] JS-only mirror skipped host=" + hostOf(url));
    return Promise.resolve([]);
  }
  if (isLikelyStreamUrl(url)) {
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

  var host = hostOf(url);

  function finish(streams) {
    return (streams || []).map(function (stream) {
      if (!stream.label || stream.label === "Direct" || stream.label === "Nested") {
        stream.label = mirror.label || stream.label || host || "MSM21";
      }
      return stream;
    });
  }

  return resolvePlaymate(url)
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveDood(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveAbyss(url);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveMixDrop(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveStreamWish(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveVoe(url, pageUrl);
    })
    .then(function (streams) {
      if (streams.length) return streams;
      return resolveGeneric(url, pageUrl, depth || 0);
    })
    .then(function (streams) {
      if (!streams.length) {
        console.log(
          "[MSM21] unresolved host=" + (host || "?") +
          " label='" + String(mirror.label || "") + "'"
        );
      }
      return finish(streams);
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
    var headers = {};
    var supplied = stream && stream.headers || {};

    Object.keys(supplied).forEach(function (key) {
      headers[key] = supplied[key];
    });

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
      return findTitleFast(base, details, mediaType);
    })
    .then(function (item) {
      if (!item) return null;
      return loadPlaybackPage(base, item, mediaType, season, episode);
    })
    .then(function (playback) {
      if (!playback) return [];
      return collectMirrors(base, playback).then(function (mirrors) {
        return resolveMirrorsFastFirst(mirrors, playback.url);
      });
    })
    .then(function (groups) {
      if (!Array.isArray(groups)) return [];

      var flat = [];
      groups.forEach(function (group) {
        flat = flat.concat(group || []);
      });

      var streams = formatStreams(flat);
      console.log("[MSM21] v1.0.4 playable sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[MSM21] error=" + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
