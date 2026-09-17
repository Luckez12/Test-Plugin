"use strict";

var PROVIDER_NAME = "KissKH";
var VERSION = "1.0.9";
var PRIMARY_BASE_URL = "https://kisskh.do";
var FALLBACK_BASE_URL = "https://kisskh.id";
var BASE_URL = PRIMARY_BASE_URL;
var KISSKH_VERSION = "2.8.10";
var TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
var VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";

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

function buildSearchQueries(info) {
  var out = [];
  var seen = {};

  function add(value) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    var key = text.toLowerCase();
    if (!text || seen[key]) return;
    seen[key] = true;
    out.push(text);
  }

  // Keep discovery focused: official title first, then at most two meaningful
  // metadata alternatives, then one title+year fallback.
  add(info.title);

  if (info.originalTitle && normalizeTitle(info.originalTitle) !== normalizeTitle(info.title)) {
    add(info.originalTitle);
  }

  (info.aliases || []).some(function(alias) {
    if (out.length >= 3) return true;
    if (normalizeTitle(alias) === normalizeTitle(info.title)) return false;
    add(alias);
    return out.length >= 3;
  });

  // A punctuation-only spelling is useful for sites that index possessives
  // without an apostrophe, but never expand into a large variant matrix.
  if (out.length < 3 && /[’'`´]/.test(String(info.title || ""))) {
    add(String(info.title).replace(/[’'`´]/g, ""));
  }

  if (info.year) {
    add(info.title + " " + info.year);
  }

  return out.slice(0, 4);
}

function typeLabel(value) {
  if (!value || typeof value !== "object") return "";
  return String(
    value.typeName ||
    value.type ||
    value.dramaType ||
    value.category ||
    ""
  ).toLowerCase();
}

function typePenalty(value, mediaType) {
  var label = typeLabel(value);
  if (!label) return 0;

  if (mediaType === "movie") {
    if (/movie|film|webmovie/.test(label)) return 18;
    if (/tv|series|drama/.test(label)) return -70;
  } else {
    if (/tv|series|drama/.test(label)) return 18;
    if (/movie|film|webmovie/.test(label)) return -70;
  }
  return 0;
}

function yearScore(detailYear, expectedYear) {
  if (!detailYear || !expectedYear) return 0;
  var diff = Math.abs(Number(detailYear) - Number(expectedYear));
  if (diff === 0) return 35;
  if (diff === 1) return 8;
  return -90;
}

function candidateSummary(items) {
  return (items || []).slice(0, 8).map(function(item) {
    var year = item && (item.year || item.releaseYear || "");
    var label = typeLabel(item);
    return String(item && item.title || "?") +
      (year ? " (" + year + ")" : "") +
      (label ? " [" + label + "]" : "");
  }).join(" | ");
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

function aliasList(info) {
  return uniqueText([info.title, info.originalTitle].concat(info.aliases || []));
}

function acceptedTitleKeys(info, mediaType, season) {
  var keys = {};
  aliasList(info).forEach(function(title) {
    var key = normalizeTitle(title);
    if (key) keys[key] = true;

    if (mediaType === "tv" && Number(season || 1) > 1) {
      var seasonKey = normalizeTitle(title + " Season " + Number(season));
      if (seasonKey) keys[seasonKey] = true;
    }
  });
  return keys;
}

function titleMatchesExpected(value, info, mediaType, season) {
  var key = normalizeTitle(cleanCandidateTitle(value));
  if (!key) return false;
  return !!acceptedTitleKeys(info, mediaType, season)[key];
}

function mediaTypeMatches(value, mediaType) {
  var label = typeLabel(value);
  if (!label) return true;

  var saysMovie = /movie|film|webmovie/.test(label);
  var saysSeries = /tv|series|drama|anime/.test(label);

  if (mediaType === "movie") {
    if (saysSeries && !saysMovie) return false;
    return true;
  }

  if (saysMovie && !saysSeries) return false;
  return true;
}

function yearMatchesExpected(value, expectedYear) {
  var year = candidateYear(value);
  if (!expectedYear || !year) return true;
  var diff = Math.abs(Number(expectedYear) - Number(year));
  return Number.isFinite(diff) && diff <= 1;
}

function candidateStrictRank(item, info, mediaType, season) {
  if (!item || !titleMatchesExpected(item.title, info, mediaType, season)) return -1;
  if (!yearMatchesExpected(item, info.year)) return -1;
  if (!mediaTypeMatches(item, mediaType)) return -1;

  var clean = normalizeTitle(cleanCandidateTitle(item.title));
  var score = 100;
  if (clean === normalizeTitle(info.title)) score += 40;
  else if (info.originalTitle && clean === normalizeTitle(info.originalTitle)) score += 25;

  var year = candidateYear(item);
  if (info.year && year && Number(info.year) === Number(year)) score += 20;
  if (typeLabel(item)) score += 5;
  return score;
}

function rejectSearchGroup(group, info, mediaType, season, query) {
  var rejected = (group || []).filter(function(item) {
    return candidateStrictRank(item, info, mediaType, season) < 0;
  });

  rejected.slice(0, 2).forEach(function(item) {
    var reason = "title-mismatch";
    if (titleMatchesExpected(item && item.title, info, mediaType, season)) {
      if (!yearMatchesExpected(item, info.year)) reason = "year-mismatch";
      else if (!mediaTypeMatches(item, mediaType)) reason = "type-mismatch";
    }
    console.log(
      "[KissKH] REJECT query='" + query +
      "' title='" + String(item && item.title || "") +
      "' reason=" + reason
    );
  });

  return rejected.length;
}

function verifyCandidateDetail(base, candidate, info, mediaType, season) {
  return getDramaDetail(base, candidate.id)
    .then(function(detail) {
      var title = String(detail && detail.title || candidate && candidate.title || "");
      var detailYear = candidateYear(detail) || candidateYear(candidate);

      if (!titleMatchesExpected(title, info, mediaType, season)) {
        console.log(
          "[KissKH] REJECT title='" + title + "' reason=title-mismatch"
        );
        return null;
      }

      if (!yearMatchesExpected(detailYear ? { year: detailYear } : candidate, info.year)) {
        console.log(
          "[KissKH] REJECT title='" + title + "' year=" + (detailYear || "?") +
          " reason=year-mismatch"
        );
        return null;
      }

      if (!mediaTypeMatches(detail, mediaType) || !mediaTypeMatches(candidate, mediaType)) {
        console.log(
          "[KissKH] REJECT title='" + title + "' reason=type-mismatch"
        );
        return null;
      }

      console.log(
        "[KissKH] MATCH host=" + base +
        " title='" + title +
        "' year=" + (detailYear || "?") +
        " strict=true"
      );

      BASE_URL = base;
      return detail;
    })
    .catch(function(error) {
      console.log(
        "[KissKH] detail reject id=" + String(candidate && candidate.id || "?") +
        " reason=" + String(error && error.message || "detail-error")
      );
      return null;
    });
}

function findBestDrama(info, mediaType, season) {
  var queries = buildSearchQueries(info);
  var bases = [PRIMARY_BASE_URL, FALLBACK_BASE_URL];

  function searchBase(baseIndex) {
    if (baseIndex >= bases.length) return Promise.resolve(null);

    var base = bases[baseIndex];

    function runQuery(index) {
      if (index >= queries.length) return Promise.resolve(null);

      var query = queries[index];
      return searchKissKh(base, query)
        .catch(function() { return []; })
        .then(function(group) {
          var ranked = (group || []).map(function(item) {
            return { item: item, score: candidateStrictRank(item, info, mediaType, season) };
          }).filter(function(row) {
            return row.score >= 0;
          }).sort(function(a, b) {
            return b.score - a.score;
          });

          var rejectedCount = rejectSearchGroup(group, info, mediaType, season, query);
          console.log(
            "[KissKH] filter query='" + query +
            "' accepted=" + ranked.length +
            " rejected=" + rejectedCount
          );

          // Only candidates that already passed strict title/year/type checks
          // are allowed to trigger a detail request. Verify at most three
          // duplicates/remakes before moving to the next focused query.
          function verifyRanked(i) {
            if (i >= ranked.length || i >= 3) return Promise.resolve(null);
            return verifyCandidateDetail(base, ranked[i].item, info, mediaType, season)
              .then(function(detail) {
                return detail || verifyRanked(i + 1);
              });
          }

          return verifyRanked(0).then(function(detail) {
            if (detail) return detail;
            return runQuery(index + 1);
          });
        });
    }

    return runQuery(0).then(function(detail) {
      if (detail) return detail;
      console.log(
        "[KissKH] no strict match host=" + base +
        " queries=" + queries.length
      );
      return searchBase(baseIndex + 1);
    });
  }

  return searchBase(0).then(function(detail) {
    if (detail) return detail;
    throw new Error(
      "No strict match for " + info.title + " (" + (info.year || "?") + ")"
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

function getVideoKey(episodeId) {
  var url = VIDEO_KEY_API + encodeURIComponent(episodeId) +
    "&version=" + encodeURIComponent(KISSKH_VERSION);
  var started = Date.now();
  return fetchJson(url, {}).then(function(data) {
    if (!data || !data.key) throw new Error("Empty KissKH video key");
    console.log("[KissKH] video key=stable elapsed=" +
      (Date.now() - started) + "ms");
    return data.key;
  });
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
      return getVideoKey(selected.id).then(function(key) {
        return getSources(selected.id, key);
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
