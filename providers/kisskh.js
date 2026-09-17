"use strict";

var PROVIDER_NAME = "KissKH";
var VERSION = "1.0.13";
var PRIMARY_BASE_URL = "https://kisskh.is";
var FALLBACK_BASE_URL = "https://kisskh.do";
var BASE_URL = PRIMARY_BASE_URL;
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";

// Current KissKH requires a reusable stream kkey. Prefer a key supplied by
// VUEO or captured from KissKH's own episode page. The old Google Apps Script
// is retained only as a bounded compatibility fallback.
var LEGACY_VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
var LEGACY_KISSKH_VERSION = "2.8.10";
var VIDEO_KEY_CACHE_SLOT = "__VUEO_KISSKH_VIDEO_KEY_CACHE__";
var VIDEO_KEY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
var WEBVIEW_KEY_TIMEOUT_MS = 3600;
var LEGACY_KEY_TIMEOUT_MS = 2400;
var LOCAL_VIDEO_KEY_CACHE = {};

var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
var DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*"
};

function headersFor(baseUrl, extra) {
  return Object.assign({}, DEFAULT_HEADERS, {
    "Referer": String(baseUrl || BASE_URL).replace(/\/+$/, "") + "/"
  }, extra || {});
}

function fetchJson(url, headers) {
  return fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow"
  }).then(function(response) {
    if (!response.ok) {
      throw new Error("HTTP " + response.status + " for " + url);
    }
    return response.json();
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/([a-z0-9])'s\b/g, "$1s")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function uniqueText(values) {
  var out = [];
  var seen = {};
  (values || []).forEach(function(value) {
    var text = String(value || "").trim();
    var key = normalizeTitle(text);
    if (!text || !key || seen[key]) return;
    seen[key] = true;
    out.push(text);
  });
  return out;
}

function collectTmdbAliases(data, mediaType) {
  var values = [
    data && (data.title || data.name),
    data && (data.original_title || data.original_name)
  ];

  var alt = data && data.alternative_titles;
  var altItems = alt && Array.isArray(alt.titles)
    ? alt.titles
    : alt && Array.isArray(alt.results)
      ? alt.results
      : [];

  altItems.forEach(function(item) {
    if (item) values.push(item.title || item.name);
  });

  var translations = data && data.translations && Array.isArray(data.translations.translations)
    ? data.translations.translations
    : [];

  translations.forEach(function(item) {
    var row = item && item.data;
    if (row) values.push(row.title || row.name);
  });

  return uniqueText(values).slice(0, 12);
}

function inferQuality(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf("2160") !== -1 || value.indexOf("4k") !== -1) return "2160p";
  if (value.indexOf("1080") !== -1) return "1080p";
  if (value.indexOf("720") !== -1) return "720p";
  if (value.indexOf("480") !== -1) return "480p";
  if (value.indexOf("360") !== -1) return "360p";
  return "Auto";
}

function isDirectStream(url) {
  var value = String(url || "").toLowerCase();
  return value.indexOf(".m3u8") !== -1 || value.indexOf(".mp4") !== -1;
}

function getTmdbInfo(tmdbId, mediaType) {
  var started = Date.now();
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  function parseContext(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch (_) { return null; }
    }
    return typeof raw === "object" ? raw : null;
  }

  function normalizeData(data, context) {
    data = data || {};
    context = context || {};
    return {
      title: data.title || data.name || context.title || "",
      originalTitle: data.original_title || data.original_name || context.originalTitle || "",
      year: String(
        data.release_date ||
        data.first_air_date ||
        context.year ||
        ""
      ).split("-")[0],
      aliases: uniqueText(
        collectTmdbAliases(data, mediaType).concat(
          Array.isArray(context.aliases) ? context.aliases : []
        )
      )
    };
  }

  try {
    if (typeof globalThis !== "undefined") {
      var directContext = parseContext(globalThis.VUEO_DISCOVERY_CONTEXT);
      if (directContext) {
        var directTmdb = directContext.tmdb && typeof directContext.tmdb === "object"
          ? directContext.tmdb
          : {
              title: mediaType === "movie" ? directContext.title : undefined,
              name: mediaType === "tv" ? directContext.title : undefined,
              original_title: mediaType === "movie" ? directContext.originalTitle : undefined,
              original_name: mediaType === "tv" ? directContext.originalTitle : undefined,
              release_date: mediaType === "movie" && directContext.year
                ? String(directContext.year) + "-01-01" : "",
              first_air_date: mediaType === "tv" && directContext.year
                ? String(directContext.year) + "-01-01" : ""
            };

        var directInfo = normalizeData(directTmdb, directContext);

        // Some VUEO builds expose VUEO_DISCOVERY_CONTEXT before its title/TMDB
        // payload is populated. Do not accept an empty shell as valid metadata.
        if (directInfo && directInfo.title) {
          console.log("[KissKH] metadata=shared-direct elapsed=" +
            (Date.now() - started) + "ms");
          return Promise.resolve(directInfo);
        }

        console.log("[KissKH] metadata=shared-direct-empty fallback=true");
      }

      if (typeof globalThis.vueoDiscoveryContext === "function") {
        return Promise.resolve(globalThis.vueoDiscoveryContext(url))
          .then(function(context) {
            context = parseContext(context);
            if (context) {
              var data = context.tmdb && typeof context.tmdb === "object"
                ? context.tmdb
                : {};
              var sharedInfo = normalizeData(data, context);
              if (sharedInfo && sharedInfo.title) {
                console.log("[KissKH] metadata=shared-fn elapsed=" +
                  (Date.now() - started) + "ms");
                return sharedInfo;
              }
              console.log("[KissKH] metadata=shared-fn-empty fallback=true");
            }
            throw new Error("shared metadata unavailable");
          })
          .catch(function() {
            var tmdbStarted = Date.now();
            return fetchJson(url, {}).then(function(data) {
              console.log("[KissKH] metadata=tmdb elapsed=" +
                (Date.now() - tmdbStarted) + "ms");
              return normalizeData(data, null);
            });
          });
      }
    }
  } catch (_) {}

  var tmdbStarted = Date.now();
  return fetchJson(url, {}).then(function(data) {
    console.log("[KissKH] metadata=tmdb elapsed=" +
      (Date.now() - tmdbStarted) + "ms");
    return normalizeData(data, null);
  });
}

function searchKissKh(baseUrl, query) {
  var base = String(baseUrl || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Search?q=" + encodeURIComponent(query) + "&type=0";
  var started = Date.now();
  return fetchJson(url, headersFor(base, {})).then(function(data) {
    var rows = Array.isArray(data) ? data : [];
    console.log("[KissKH] search host=" + base + " query='" + query +
      "' items=" + rows.length + " elapsed=" + (Date.now() - started) + "ms");
    return rows;
  });
}

function getDramaDetail(baseUrl, id) {
  var base = String(baseUrl || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Drama/" + encodeURIComponent(id) + "?isq=false";
  var started = Date.now();
  return fetchJson(url, headersFor(base, {})).then(function(detail) {
    if (detail && typeof detail === "object") detail.__baseUrl = base;
    console.log("[KissKH] detail id=" + id + " elapsed=" +
      (Date.now() - started) + "ms");
    return detail;
  });
}


function candidateYear(item) {
  if (!item || typeof item !== "object") return "";
  var direct = item.year || item.releaseYear || item.releaseDate || item.release_date || "";
  var directYear = String(direct || "").match(/\b((?:19|20)\d{2})\b/);
  if (directYear) return directYear[1];

  var titleYear = String(item.title || "").match(/\b((?:19|20)\d{2})\b/);
  return titleYear ? titleYear[1] : "";
}

function cleanCandidateTitle(value) {
  return String(value || "")
    .replace(/\s*[\(\[\{]\s*(?:19|20)\d{2}\s*[\)\]\}]\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:19|20)\d{2}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchesExact(value, info) {
  var actual = normalizeTitle(cleanCandidateTitle(value));
  var expected = normalizeTitle(info && info.title);
  return !!actual && !!expected && actual === expected;
}

function parseTvSeasonTitle(value) {
  var title = cleanCandidateTitle(value);
  var season = null;
  var explicit = false;
  var match;

  // KissKH commonly stores each TV season as a separate drama entry, e.g.
  // "Reacher - Season 2", "Kingdom: Season 2", or "Season 2" without a dash.
  match = title.match(/(?:\s*[-–—:]\s*|\s+)season\s*(\d+)\s*$/i);
  if (match) {
    season = Number(match[1]);
    explicit = true;
    title = title.slice(0, match.index).trim();
  } else {
    // Also support suffixes such as "2nd Season" / "3rd Season".
    match = title.match(/(?:\s*[-–—:]\s*|\s+)(\d+)(?:st|nd|rd|th)\s+season\s*$/i);
    if (match) {
      season = Number(match[1]);
      explicit = true;
      title = title.slice(0, match.index).trim();
    }
  }

  return {
    baseTitle: title,
    season: season,
    explicit: explicit
  };
}

function exactTitleCandidates(items, info) {
  return (items || []).filter(function(item) {
    return item && item.id !== undefined && titleMatchesExact(item.title, info);
  });
}

function exactTvSeasonCandidates(items, info, requestedSeason) {
  var expected = normalizeTitle(info && info.title);
  var seasonNumber = Math.max(1, Number(requestedSeason || 1));
  var rows = [];

  (items || []).forEach(function(item) {
    if (!item || item.id === undefined) return;
    var parsed = parseTvSeasonTitle(item.title);
    if (!parsed.baseTitle || normalizeTitle(parsed.baseTitle) !== expected) return;

    // For S2+, only an explicit matching season is safe. A bare base title is
    // treated as S1 because many KissKH shows store their first season that way.
    var itemSeason = parsed.explicit ? parsed.season : 1;
    if (itemSeason !== seasonNumber) return;

    rows.push({ item: item, parsed: parsed });
  });

  return rows;
}

function loadSelectedDetail(base, candidate, info, selectionReason) {
  console.log(
    "[KissKH] SELECT title='" + String(candidate && candidate.title || "") +
    "' year=" + (candidateYear(candidate) || "?") +
    " reason=" + selectionReason
  );

  return getDramaDetail(base, candidate.id)
    .then(function(detail) {
      BASE_URL = base;
      if (detail && typeof detail === "object") {
        detail.__dramaId = candidate.id;
        detail.__selectedTitle = String(candidate.title || detail.title || "");
        detail.__selectedUrl = String(candidate.url || candidate.link || candidate.slug || "");
      }
      return detail;
    })
    .catch(function(error) {
      console.log(
        "[KissKH] detail failed id=" + String(candidate && candidate.id || "?") +
        " reason=" + String(error && error.message || "detail-error")
      );
      return null;
    });
}

function resolveDuplicateByYear(base, candidates, info) {
  var expectedYear = String(info && info.year || "").match(/\b((?:19|20)\d{2})\b/);
  expectedYear = expectedYear ? expectedYear[1] : "";

  if (!expectedYear) {
    return loadSelectedDetail(base, candidates[0], info, "exact-title-no-year");
  }

  var directYearMatches = candidates.filter(function(candidate) {
    return candidateYear(candidate) === expectedYear;
  });

  if (directYearMatches.length > 0) {
    return loadSelectedDetail(base, directYearMatches[0], info, "exact-title-year");
  }

  var unknownYearCandidates = candidates.filter(function(candidate) {
    return !candidateYear(candidate);
  });

  if (unknownYearCandidates.length === 0) {
    console.log(
      "[KissKH] exact title duplicates=" + candidates.length +
      " but no year=" + expectedYear + " match"
    );
    return Promise.resolve(null);
  }

  function inspect(index) {
    if (index >= unknownYearCandidates.length) return Promise.resolve(null);
    var candidate = unknownYearCandidates[index];
    return getDramaDetail(base, candidate.id)
      .then(function(detail) {
        var detailYear = candidateYear(detail);
        console.log(
          "[KissKH] duplicate detail title='" + String(candidate.title || "") +
          "' year=" + (detailYear || "?") +
          " expected=" + expectedYear
        );
        if (detailYear === expectedYear) {
          BASE_URL = base;
          console.log(
            "[KissKH] SELECT title='" + String(candidate.title || "") +
            "' year=" + detailYear + " reason=exact-title-year-detail"
          );
          return detail;
        }
        return inspect(index + 1);
      })
      .catch(function() {
        return inspect(index + 1);
      });
  }

  return inspect(0);
}

function selectExactTitle(base, group, info) {
  var exact = exactTitleCandidates(group, info);
  console.log(
    "[KissKH] exact title query='" + info.title +
    "' matches=" + exact.length +
    " total=" + (group || []).length
  );

  if (exact.length === 0) return Promise.resolve(null);

  // User-selected rule: if there is only one exact title, use it immediately.
  // The release year is consulted only when multiple exact-title results exist.
  if (exact.length === 1) {
    return loadSelectedDetail(base, exact[0], info, "exact-title-single");
  }

  return resolveDuplicateByYear(base, exact, info);
}

function selectTvSeason(base, group, info, requestedSeason) {
  var seasonNumber = Math.max(1, Number(requestedSeason || 1));
  var matches = exactTvSeasonCandidates(group, info, seasonNumber);

  console.log(
    "[KissKH] exact tv title query='" + info.title +
    "' season=" + seasonNumber +
    " matches=" + matches.length +
    " total=" + (group || []).length
  );

  if (matches.length === 0) return Promise.resolve(null);

  // Prefer an explicit "Season 1" entry over a bare title when both exist.
  // For S2+ every match is already explicit by exactTvSeasonCandidates().
  if (seasonNumber === 1) {
    var explicitS1 = matches.filter(function(row) {
      return row.parsed.explicit && row.parsed.season === 1;
    });
    if (explicitS1.length > 0) matches = explicitS1;
  }

  var candidates = matches.map(function(row) { return row.item; });
  if (candidates.length === 1) {
    return loadSelectedDetail(base, candidates[0], info, "exact-tv-season-single");
  }

  // If duplicate entries exist for the same title+season, use the series year
  // only as a tie-breaker when it directly matches one candidate. Do not reject
  // all candidates when season release year differs from the series premiere year.
  var expectedYear = String(info && info.year || "").match(/\b((?:19|20)\d{2})\b/);
  expectedYear = expectedYear ? expectedYear[1] : "";
  if (expectedYear) {
    var yearMatches = candidates.filter(function(candidate) {
      return candidateYear(candidate) === expectedYear;
    });
    if (yearMatches.length > 0) {
      return loadSelectedDetail(base, yearMatches[0], info, "exact-tv-season-year");
    }
  }

  return loadSelectedDetail(base, candidates[0], info, "exact-tv-season-first");
}

function findBestDrama(info, mediaType, season) {
  var query = String(info && info.title || "").replace(/\s+/g, " ").trim();
  if (!query) return Promise.reject(new Error("KissKH title is empty"));

  // One search only: the VUEO/TMDB title. Do not fan out into aliases,
  // title+year variants, or score unrelated search results.
  return searchKissKh(PRIMARY_BASE_URL, query)
    .then(function(group) {
      return mediaType === "tv"
        ? selectTvSeason(PRIMARY_BASE_URL, group, info, season)
        : selectExactTitle(PRIMARY_BASE_URL, group, info);
    }, function(primaryError) {
      // The fallback domain is only for an actual primary-host failure.
      // A successful search with zero exact titles is a valid negative result.
      console.log(
        "[KissKH] primary search failed; fallback host reason=" +
        String(primaryError && primaryError.message || "search-error")
      );
      return searchKissKh(FALLBACK_BASE_URL, query)
        .then(function(group) {
          return mediaType === "tv"
            ? selectTvSeason(FALLBACK_BASE_URL, group, info, season)
            : selectExactTitle(FALLBACK_BASE_URL, group, info);
        });
    })
    .then(function(detail) {
      if (detail) return detail;
      throw new Error(
        mediaType === "tv"
          ? "No exact title/season match for " + info.title + " S" + Math.max(1, Number(season || 1))
          : "No exact title match for " + info.title + " (" + (info.year || "?") + ")"
      );
    });
}

function selectEpisode(detail, mediaType, season, episode) {
  var episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
  if (episodes.length === 0) throw new Error("No KissKH episodes");

  if (mediaType === "movie") {
    return episodes[0];
  }

  var requestedEpisode = Number(episode || 1);
  var exact = episodes.find(function(item) {
    return Number(item.number) === requestedEpisode;
  });

  if (!exact) throw new Error("Episode " + requestedEpisode + " not found on KissKH");
  return exact;
}

function getVideoKeyCache() {
  var store = LOCAL_VIDEO_KEY_CACHE;

  if (typeof globalThis === "object" && globalThis) {
    if (!globalThis[VIDEO_KEY_CACHE_SLOT] ||
        typeof globalThis[VIDEO_KEY_CACHE_SLOT] !== "object") {
      globalThis[VIDEO_KEY_CACHE_SLOT] = {};
    }
    store = globalThis[VIDEO_KEY_CACHE_SLOT];
  }

  if (!store.stream || typeof store.stream !== "object") {
    store.stream = { key: "", fetchedAt: 0, promise: null };
  }
  return store.stream;
}

function clearVideoKeyCache(expectedKey) {
  var cache = getVideoKeyCache();
  if (!expectedKey || cache.key === expectedKey) {
    cache.key = "";
    cache.fetchedAt = 0;
  }
}

function readInjectedVideoKey() {
  if (typeof globalThis !== "object" || !globalThis) return "";

  var direct = [
    globalThis.KISSKH_STREAM_KEY,
    globalThis.VUEO_KISSKH_STREAM_KEY
  ];

  var context = globalThis.VUEO_DISCOVERY_CONTEXT;
  if (context && typeof context === "object") {
    direct.push(context.kisskhStreamKey);
    direct.push(context.KISSKH_STREAM_KEY);
    if (context.providerKeys && context.providerKeys.kisskh) {
      direct.push(context.providerKeys.kisskh.stream || context.providerKeys.kisskh.streamKey);
    }
  }

  for (var i = 0; i < direct.length; i++) {
    var key = String(direct[i] || "").trim();
    if (key.length >= 16) return key;
  }
  return "";
}

function fetchJsonWithTimeout(url, headers, timeoutMs) {
  var timeout = Math.max(250, Number(timeoutMs || 0));
  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer;

  var request = fetch(url, {
    method: "GET",
    headers: Object.assign({}, DEFAULT_HEADERS, headers || {}),
    redirect: "follow",
    signal: controller ? controller.signal : undefined
  }).then(function(response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
    return response.json();
  });

  var deadline = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      try { if (controller) controller.abort(); } catch (_) {}
      reject(new Error("timeout after " + timeout + "ms"));
    }, timeout);
  });

  return Promise.race([request, deadline]).then(function(value) {
    clearTimeout(timer);
    return value;
  }, function(error) {
    clearTimeout(timer);
    throw error;
  });
}

function dramaSlug(value) {
  return cleanCandidateTitle(value)
    .replace(/[’‘`´']/g, "")
    .replace(/&/g, " and ")
    .replace(/[\s\/\?\#\:]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "Drama";
}

function dramaPageBase(detail) {
  var base = String(detail && detail.__baseUrl || BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var raw = String(detail && detail.__selectedUrl || "").trim();
  var id = detail && detail.__dramaId;

  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\/Episode-[^/?#]+.*$/i, "").replace(/[?#].*$/, "");
  }

  if (raw && raw.indexOf("/Drama/") !== -1) {
    return base + (raw.charAt(0) === "/" ? raw : "/" + raw).replace(/[?#].*$/, "");
  }

  var slug = raw && raw.indexOf("/") === -1 ? raw : dramaSlug(detail && detail.__selectedTitle || detail && detail.title);
  return base + "/Drama/" + encodeURIComponent(slug).replace(/%2D/gi, "-") +
    (id !== undefined && id !== null ? "?id=" + encodeURIComponent(id) : "");
}

function episodePageUrl(detail, selected) {
  var basePage = dramaPageBase(detail).replace(/[?#].*$/, "");
  var dramaId = detail && detail.__dramaId;
  var number = Math.max(1, Number(selected && selected.number || 1));
  var episodeId = selected && selected.id;
  return basePage + "/Episode-" + number +
    "?id=" + encodeURIComponent(dramaId) +
    "&ep=" + encodeURIComponent(episodeId) +
    "&page=0&pageSize=100";
}

function extractKkey(url) {
  var match = String(url || "").match(/[?&]kkey=([^&#]+)/i);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
}

function captureVideoKeyFromKissKh(selected, detail) {
  if (typeof globalThis !== "object" || !globalThis ||
      typeof globalThis.webviewResolve !== "function") {
    return Promise.reject(new Error("webviewResolve unavailable"));
  }

  var pageUrl = episodePageUrl(detail, selected);
  var base = String(detail && detail.__baseUrl || BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var started = Date.now();

  console.log("[KissKH] video key=webview-start host=" + base);
  return globalThis.webviewResolve(pageUrl, {
    referer: base + "/",
    directLoad: true,
    timeoutMs: WEBVIEW_KEY_TIMEOUT_MS,
    finishAfterFirstMs: 120,
    suppressPopups: true,
    lockMainFrameHost: true,
    interactionTexts: [
      "episode " + Math.max(1, Number(selected && selected.number || 1)),
      "play",
      "watch"
    ],
    match: ["/api/DramaList/Episode/"]
  }).then(function(result) {
    var rows = result && Array.isArray(result.streams) ? result.streams : [];
    for (var i = 0; i < rows.length; i++) {
      var key = extractKkey(rows[i] && rows[i].url);
      if (key) {
        console.log("[KissKH] video key=webview elapsed=" +
          (Date.now() - started) + "ms");
        return key;
      }
    }
    throw new Error("KissKH webview did not capture kkey");
  });
}

function getLegacyVideoKey(episodeId) {
  var url = LEGACY_VIDEO_KEY_API + encodeURIComponent(episodeId) +
    "&version=" + encodeURIComponent(LEGACY_KISSKH_VERSION);
  var started = Date.now();
  return fetchJsonWithTimeout(url, {}, LEGACY_KEY_TIMEOUT_MS).then(function(data) {
    if (!data || !data.key) throw new Error("Empty legacy KissKH video key");
    console.log("[KissKH] video key=legacy-fallback elapsed=" +
      (Date.now() - started) + "ms");
    return String(data.key);
  });
}

function getVideoKey(selected, detail, forceRefresh) {
  var cache = getVideoKeyCache();
  var now = Date.now();
  var age = cache.fetchedAt ? now - cache.fetchedAt : Infinity;

  if (!forceRefresh) {
    var injected = readInjectedVideoKey();
    if (injected) {
      cache.key = injected;
      cache.fetchedAt = now;
      console.log("[KissKH] video key=injected");
      return Promise.resolve(injected);
    }

    if (cache.key && age < VIDEO_KEY_CACHE_TTL_MS) {
      console.log("[KissKH] video key=cache-hit age=" + age + "ms");
      return Promise.resolve(cache.key);
    }

    if (cache.promise) {
      console.log("[KissKH] video key=shared-inflight");
      return cache.promise;
    }
  }

  var episodeId = selected && selected.id;
  var request = captureVideoKeyFromKissKh(selected, detail)
    .catch(function(webviewError) {
      console.log("[KissKH] video key webview miss reason=" +
        String(webviewError && webviewError.message || webviewError));
      return getLegacyVideoKey(episodeId);
    })
    .then(function(key) {
      if (!key) throw new Error("Empty KissKH video key");
      cache.key = key;
      cache.fetchedAt = Date.now();
      return key;
    });

  cache.promise = request.then(function(key) {
    cache.promise = null;
    return key;
  }, function(error) {
    cache.promise = null;
    throw error;
  });
  return cache.promise;
}

function isVideoKeyAuthError(error) {
  return /\bHTTP\s+(?:401|403)\b/i.test(
    String(error && error.message || error || "")
  );
}

function getSources(episodeId, key) {
  var base = String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Episode/" + encodeURIComponent(episodeId) +
    ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(key);
  var started = Date.now();
  return fetchJson(url, headersFor(base, {
    "Origin": base,
    "Referer": base + "/"
  })).then(function(data) {
    console.log("[KissKH] sources elapsed=" + (Date.now() - started) + "ms");
    return data;
  });
}

function buildStreams(source, info, season, episode) {
  var urls = [source && source.Video, source && source.ThirdParty]
    .map(function(value) { return String(value || "").trim(); })
    .filter(function(value, index, array) {
      return value && isDirectStream(value) && array.indexOf(value) === index;
    });

  return urls.map(function(url, index) {
    var quality = inferQuality(url);
    var episodeLabel = episode ? " S" + String(season || 1).padStart(2, "0") +
      "E" + String(episode).padStart(2, "0") : "";

    return {
      name: PROVIDER_NAME + (urls.length > 1 ? " Server " + (index + 1) : ""),
      title: (info.title || PROVIDER_NAME) + episodeLabel,
      url: url,
      quality: quality,
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "") + "/",
        "Origin": String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "")
      }
    };
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = mediaType === "movie" ? "movie" : "tv";
  console.log("[KissKH] v" + VERSION + " TMDB=" + tmdbId + " type=" + type +
    (type === "tv" ? " S" + (season || 1) + "E" + (episode || 1) : ""));

  var info;
  var requestStarted = Date.now();
  return getTmdbInfo(tmdbId, type)
    .then(function(value) {
      info = value;
      if (!info.title) throw new Error("TMDB title is empty");
      console.log("[KissKH] title='" + info.title + "' year=" + (info.year || "?") + " aliases=" + (info.aliases || []).length);
      return findBestDrama(info, type, season || 1);
    })
    .then(function(detail) {
      var selected = selectEpisode(detail, type, season, episode);
      if (!selected || selected.id === undefined) throw new Error("KissKH episode ID is missing");
      return getVideoKey(selected, detail, false).then(function(key) {
        return getSources(selected.id, key).catch(function(error) {
          if (!isVideoKeyAuthError(error)) throw error;
          clearVideoKeyCache(key);
          console.log("[KissKH] video key rejected; refreshing once");
          return getVideoKey(selected, detail, true).then(function(freshKey) {
            return getSources(selected.id, freshKey);
          });
        });
      });
    })
    .then(function(source) {
      var streams = buildStreams(source, info, type === "tv" ? season || 1 : null, type === "tv" ? episode || 1 : null);
      console.log("[KissKH] Direct streams found=" + streams.length +
        " elapsed=" + (Date.now() - requestStarted) + "ms");
      return streams;
    })
    .catch(function(error) {
      console.error("[KissKH] " + error.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
