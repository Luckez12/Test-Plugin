"use strict";

var PROVIDER_NAME = "KissKH";
var VERSION = "1.0.8";
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
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, expected) {
  var left = normalizeTitle(candidate);
  var right = normalizeTitle(expected);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.indexOf(right) !== -1 || right.indexOf(left) !== -1) return 75;

  var expectedWords = right.split(" ");
  var candidateWords = new Set(left.split(" "));
  var matched = expectedWords.filter(function(word) {
    return word.length > 1 && candidateWords.has(word);
  }).length;

  return Math.round((matched / Math.max(expectedWords.length, 1)) * 60);
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
  var seeds = uniqueText(
    [info.title, info.originalTitle].concat(info.aliases || [])
  ).slice(0, 8);

  var out = [];
  var seen = {};

  function add(value) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    var key = text.toLowerCase();
    if (!text || seen[key]) return;
    seen[key] = true;
    out.push(text);
  }

  seeds.forEach(function(title) {
    add(title);

    // KissKH search has historically behaved differently around apostrophes.
    add(title.replace(/[’'`]/g, ""));
    add(title.replace(/[’'`]s\b/gi, ""));
    add(title.replace(/[’'`]/g, " "));

    if (info.year) {
      add(title + " " + info.year);
    }
  });

  return out.slice(0, 10);
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

function candidateQuickScore(item, info, mediaType) {
  var aliases = aliasList(info);
  var title = cleanCandidateTitle(item && item.title);
  var score = 0;

  aliases.forEach(function(alias) {
    score = Math.max(score, titleScore(title, alias));
  });

  var year = candidateYear(item);
  if (info.year && year) {
    var diff = Math.abs(Number(info.year) - Number(year));
    if (diff === 0) score += 35;
    else if (diff === 1) score += 5;
    else score -= 90;
  }

  score += typePenalty(item, mediaType);
  return score;
}

function verifyCandidateDetail(base, candidate, info, mediaType) {
  return getDramaDetail(base, candidate.id)
    .then(function(detail) {
      var aliases = aliasList(info);
      var score = 0;

      aliases.forEach(function(alias) {
        score = Math.max(
          score,
          titleScore(cleanCandidateTitle(detail && detail.title), alias)
        );
      });

      var detailYear = candidateYear(detail) || candidateYear(candidate);
      score += yearScore(detailYear, info.year);
      score += typePenalty(detail, mediaType);
      score += typePenalty(candidate, mediaType);

      if (
        mediaType === "movie" &&
        detail &&
        Array.isArray(detail.episodes) &&
        detail.episodes.length === 1
      ) {
        score += 15;
      }

      if (
        score < 75 ||
        (
          info.year &&
          detailYear &&
          Math.abs(Number(info.year) - Number(detailYear)) > 1
        )
      ) {
        return null;
      }

      console.log(
        "[KissKH] MATCH host=" + base +
        " title='" + String(detail && detail.title || "") +
        "' year=" + (detailYear || "?") +
        " score=" + Math.round(score)
      );

      BASE_URL = base;
      return detail;
    })
    .catch(function() {
      return null;
    });
}

function findBestDrama(info, mediaType) {
  var queries = buildSearchQueries(info);
  var bases = [PRIMARY_BASE_URL, FALLBACK_BASE_URL];

  function searchBase(baseIndex) {
    if (baseIndex >= bases.length) {
      return Promise.resolve(null);
    }

    var base = bases[baseIndex];
    var seen = {};
    var candidates = [];

    function addGroup(group) {
      (group || []).forEach(function(item) {
        if (!item || item.id === undefined) return;
        var key = String(item.id);
        if (seen[key]) return;
        seen[key] = true;
        candidates.push(item);
      });
    }

    function bestDirectCandidate(group) {
      var list = (group || []).slice().sort(function(a, b) {
        return candidateQuickScore(b, info, mediaType) -
          candidateQuickScore(a, info, mediaType);
      });

      // Exact/near-exact title hits are common even when KissKH returns 50 rows.
      // Verify only the strongest candidate first instead of fetching details
      // for every candidate and waiting for all requests.
      var best = list[0];
      if (!best) return null;

      var score = candidateQuickScore(best, info, mediaType);
      var bestYear = candidateYear(best);
      var cleanBest = normalizeTitle(cleanCandidateTitle(best.title));
      var exactAlias = aliasList(info).some(function(alias) {
        return cleanBest === normalizeTitle(alias);
      });

      if (
        exactAlias &&
        score >= 100 &&
        (
          !info.year ||
          !bestYear ||
          Math.abs(Number(info.year) - Number(bestYear)) <= 1
        )
      ) {
        return best;
      }

      return null;
    }

    function runQuery(index) {
      if (index >= queries.length) {
        // No direct exact hit. Verify only the top three accumulated candidates.
        var top = candidates.slice().sort(function(a, b) {
          return candidateQuickScore(b, info, mediaType) -
            candidateQuickScore(a, info, mediaType);
        }).slice(0, 3);

        function verifyTop(i) {
          if (i >= top.length) return Promise.resolve(null);
          return verifyCandidateDetail(base, top[i], info, mediaType)
            .then(function(detail) {
              return detail || verifyTop(i + 1);
            });
        }

        return verifyTop(0);
      }

      return searchKissKh(base, queries[index])
        .catch(function() { return []; })
        .then(function(group) {
          addGroup(group);

          var direct = bestDirectCandidate(group);
          if (direct) {
            console.log(
              "[KissKH] fast candidate query='" + queries[index] +
              "' title='" + String(direct.title || "") +
              "' year=" + (candidateYear(direct) || "?")
            );

            return verifyCandidateDetail(base, direct, info, mediaType)
              .then(function(detail) {
                if (detail) return detail;
                return runQuery(index + 1);
              });
          }

          return runQuery(index + 1);
        });
    }

    return runQuery(0).then(function(detail) {
      if (detail) return detail;

      console.log(
        "[KissKH] no match host=" + base +
        " candidates=" + candidates.length +
        (candidates.length ? " top=" + candidateSummary(
          candidates.slice().sort(function(a, b) {
            return candidateQuickScore(b, info, mediaType) -
              candidateQuickScore(a, info, mediaType);
          })
        ) : "")
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
      return findBestDrama(info, type);
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
