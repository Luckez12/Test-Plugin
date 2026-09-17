"use strict";

var PROVIDER_NAME = "KissKH";
var VERSION = "1.0.11";
var PRIMARY_BASE_URL = "https://kisskh.do";
var FALLBACK_BASE_URL = "https://kisskh.id";
var BASE_URL = PRIMARY_BASE_URL;
var KISSKH_VERSION = "2.8.10";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
var VIDEO_KEY_CACHE_SLOT = "__VUEO_KISSKH_VIDEO_KEY_CACHE__";
var VIDEO_KEY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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

function exactTitleCandidates(items, info) {
  return (items || []).filter(function(item) {
    return item && item.id !== undefined && titleMatchesExact(item.title, info);
  });
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

function findBestDrama(info, mediaType, season) {
  var query = String(info && info.title || "").replace(/\s+/g, " ").trim();
  if (!query) return Promise.reject(new Error("KissKH title is empty"));

  // One search only: the VUEO/TMDB title. Do not fan out into aliases,
  // title+year variants, or score unrelated search results.
  return searchKissKh(PRIMARY_BASE_URL, query)
    .then(function(group) {
      return selectExactTitle(PRIMARY_BASE_URL, group, info);
    }, function(primaryError) {
      // The fallback domain is only for an actual primary-host failure.
      // A successful search with zero exact titles is a valid negative result.
      console.log(
        "[KissKH] primary search failed; fallback host reason=" +
        String(primaryError && primaryError.message || "search-error")
      );
      return searchKissKh(FALLBACK_BASE_URL, query)
        .then(function(group) {
          return selectExactTitle(FALLBACK_BASE_URL, group, info);
        });
    })
    .then(function(detail) {
      if (detail) return detail;
      throw new Error(
        "No exact title match for " + info.title + " (" + (info.year || "?") + ")"
      );
    });
}

function selectEpisode(detail, mediaType, season, episode) {
  var episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
  if (episodes.length === 0) throw new Error("No KissKH episodes");

  if (mediaType === "movie" || episodes.length === 1) {
    return episodes[0];
  }

  var requestedEpisode = Number(episode || 1);
  var exact = episodes.find(function(item) {
    return Number(item.number) === requestedEpisode;
  });

  if (!exact) throw new Error("Episode " + requestedEpisode + " not found on KissKH");
  if (Number(season || 1) > 1) {
    console.log("[KissKH] Source does not expose seasons; matching by episode number only");
  }
  return exact;
}

function getVideoKeyCache() {
  var base = String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var bucketId = base + "|" + KISSKH_VERSION;
  var store = LOCAL_VIDEO_KEY_CACHE;

  if (typeof globalThis === "object" && globalThis) {
    if (!globalThis[VIDEO_KEY_CACHE_SLOT] ||
        typeof globalThis[VIDEO_KEY_CACHE_SLOT] !== "object") {
      globalThis[VIDEO_KEY_CACHE_SLOT] = {};
    }
    store = globalThis[VIDEO_KEY_CACHE_SLOT];
  }

  if (!store[bucketId] || typeof store[bucketId] !== "object") {
    store[bucketId] = { key: "", fetchedAt: 0, promise: null };
  }
  return store[bucketId];
}

function clearVideoKeyCache(expectedKey) {
  var cache = getVideoKeyCache();
  if (!expectedKey || cache.key === expectedKey) {
    cache.key = "";
    cache.fetchedAt = 0;
  }
}

function getVideoKey(episodeId, forceRefresh) {
  var cache = getVideoKeyCache();
  var now = Date.now();
  var age = cache.fetchedAt ? now - cache.fetchedAt : Infinity;

  if (!forceRefresh && cache.key && age < VIDEO_KEY_CACHE_TTL_MS) {
    console.log("[KissKH] video key=cache-hit age=" + age + "ms");
    return Promise.resolve(cache.key);
  }

  if (!forceRefresh && cache.promise) {
    console.log("[KissKH] video key=shared-inflight");
    return cache.promise;
  }

  var url = VIDEO_KEY_API + encodeURIComponent(episodeId) +
    "&version=" + encodeURIComponent(KISSKH_VERSION);
  var started = Date.now();
  var request = fetchJson(url, {}).then(function(data) {
    if (!data || !data.key) throw new Error("Empty KissKH video key");
    cache.key = data.key;
    cache.fetchedAt = Date.now();
    console.log("[KissKH] video key=remote elapsed=" +
      (Date.now() - started) + "ms");
    return data.key;
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
      return getVideoKey(selected.id, false).then(function(key) {
        return getSources(selected.id, key).catch(function(error) {
          if (!isVideoKeyAuthError(error)) throw error;
          clearVideoKeyCache(key);
          console.log("[KissKH] video key rejected; refreshing once");
          return getVideoKey(selected.id, true).then(function(freshKey) {
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
