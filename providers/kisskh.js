"use strict";

var PROVIDER_NAME = "KissKH";
var VERSION = "1.0.4";
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
  var endpoint = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + endpoint + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY +
    "&append_to_response=alternative_titles,translations,external_ids";

  function normalizeData(data, context) {
    return {
      title: data.title || data.name || context && context.title || "",
      originalTitle: data.original_title || data.original_name || context && context.originalTitle || "",
      year: String(
        data.release_date ||
        data.first_air_date ||
        context && context.year ||
        ""
      ).split("-")[0],
      aliases: uniqueText(
        collectTmdbAliases(data, mediaType).concat(
          context && Array.isArray(context.aliases) ? context.aliases : []
        )
      )
    };
  }

  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.vueoDiscoveryContext === "function"
  ) {
    return Promise.resolve(globalThis.vueoDiscoveryContext(url))
      .then(function(context) {
        if (context && context.tmdb) {
          return normalizeData(context.tmdb, context);
        }
        throw new Error("shared metadata unavailable");
      })
      .catch(function() {
        return fetchJson(url, {}).then(function(data) {
          return normalizeData(data, null);
        });
      });
  }

  return fetchJson(url, {}).then(function(data) {
    return normalizeData(data, null);
  });
}

function searchKissKh(baseUrl, query) {
  var base = String(baseUrl || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Search?q=" + encodeURIComponent(query) + "&type=0";
  return fetchJson(url, headersFor(base, {})).then(function(data) {
    var rows = Array.isArray(data) ? data : [];
    console.log("[KissKH] search host=" + base + " query='" + query + "' items=" + rows.length);
    return rows;
  });
}

function getDramaDetail(baseUrl, id) {
  var base = String(baseUrl || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Drama/" + encodeURIComponent(id) + "?isq=false";
  return fetchJson(url, headersFor(base, {})).then(function(detail) {
    if (detail && typeof detail === "object") detail.__baseUrl = base;
    return detail;
  });
}

function findBestDrama(info, mediaType) {
  var queries = buildSearchQueries(info);
  var bases = [PRIMARY_BASE_URL, FALLBACK_BASE_URL];

  function searchBase(baseIndex) {
    if (baseIndex >= bases.length) {
      throw new Error("No strict KissKH match");
    }

    var base = bases[baseIndex];

    return Promise.all(
      queries.map(function(query) {
        return searchKissKh(base, query).catch(function() { return []; });
      })
    ).then(function(groups) {
      var seen = {};
      var candidates = [];

      groups.forEach(function(group) {
        (group || []).forEach(function(item) {
          if (!item || item.id === undefined) return;
          var key = String(item.id);
          if (seen[key]) return;
          seen[key] = true;
          candidates.push(item);
        });
      });

      candidates.sort(function(a, b) {
        function quickScore(item) {
          var best = 0;
          var aliases = uniqueText([info.title, info.originalTitle].concat(info.aliases || []));
          aliases.forEach(function(alias) {
            best = Math.max(best, titleScore(item && item.title, alias));
          });
          return best + typePenalty(item, mediaType);
        }
        return quickScore(b) - quickScore(a);
      });

      console.log(
        "[KissKH] candidates host=" + base +
        " count=" + candidates.length +
        (candidates.length ? " top=" + candidateSummary(candidates) : "")
      );

      candidates = candidates.slice(0, 10);
      if (!candidates.length) return null;

      return Promise.all(candidates.map(function(candidate) {
        return getDramaDetail(base, candidate.id)
          .then(function(detail) {
            var aliases = uniqueText([info.title, info.originalTitle].concat(info.aliases || []));
            var score = 0;

            aliases.forEach(function(alias) {
              score = Math.max(score, titleScore(detail && detail.title, alias));
            });

            var detailYear = String(
              detail && (
                detail.releaseDate ||
                detail.release_date ||
                detail.year ||
                ""
              ) || ""
            ).split("-")[0];

            score += yearScore(detailYear, info.year);
            score += typePenalty(detail, mediaType);
            score += typePenalty(candidate, mediaType);

            // One-episode entries are strong movie evidence.
            if (
              mediaType === "movie" &&
              detail &&
              Array.isArray(detail.episodes) &&
              detail.episodes.length === 1
            ) {
              score += 15;
            }

            return {
              detail: detail,
              candidate: candidate,
              score: score,
              year: detailYear
            };
          })
          .catch(function() { return null; });
      })).then(function(matches) {
        matches = matches.filter(Boolean).sort(function(a, b) {
          return b.score - a.score;
        });

        var best = matches[0];
        if (!best || best.score < 75) {
          return null;
        }

        if (
          info.year &&
          best.year &&
          Math.abs(Number(info.year) - Number(best.year)) > 1
        ) {
          return null;
        }

        console.log(
          "[KissKH] MATCH host=" + base +
          " title='" + String(best.detail && best.detail.title || "") +
          "' year=" + (best.year || "?") +
          " score=" + Math.round(best.score)
        );

        BASE_URL = base;
        return best.detail;
      });
    }).then(function(match) {
      if (match) return match;
      return searchBase(baseIndex + 1);
    });
  }

  return searchBase(0).catch(function(error) {
    console.log(
      "[KissKH] No strict match for " +
      info.title + " (" + (info.year || "?") + ")" +
      " queries=" + queries.join(" | ")
    );
    throw error;
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
  var url = VIDEO_KEY_API + encodeURIComponent(episodeId) + "&version=" + encodeURIComponent(KISSKH_VERSION);
  return fetchJson(url, {}).then(function(data) {
    if (!data || !data.key) throw new Error("Empty KissKH video key");
    return data.key;
  });
}

function getSources(episodeId, key) {
  var base = String(BASE_URL || PRIMARY_BASE_URL).replace(/\/+$/, "");
  var url = base + "/api/DramaList/Episode/" + encodeURIComponent(episodeId) +
    ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(key);
  return fetchJson(url, headersFor(base, {
    "Origin": base,
    "Referer": base + "/"
  }));
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
      console.log("[KissKH] Direct streams found=" + streams.length);
      return streams;
    })
    .catch(function(error) {
      console.error("[KissKH] " + error.message);
      return [];
    });
}

module.exports = { getStreams: getStreams };
