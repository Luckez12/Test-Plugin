const PROVIDER = "OneTouchTV";
const BASE = "https://api3.devcorp.me";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
const AES_KEY = "im72charPasswordofdInitVectorStm";
const AES_IV = "im72charPassword";
const USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";

function fetchText(url, options) {
  return fetch(url, options || {}).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("HTTP " + (res ? res.status : "unknown"));
    }
    return res.text();
  });
}

function sanitizeJsonControls(input) {
  var text = String(input == null ? "" : input).replace(/^\uFEFF/, "");
  var out = "";
  var inString = false;
  var escaped = false;

  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    var code = text.charCodeAt(i);

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }

      if (code < 0x20) {
        out += "\\u" + ("000" + code.toString(16)).slice(-4);
        continue;
      }

      out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") {
      out += " ";
      continue;
    }

    out += ch;
  }

  return out;
}

function parseJsonLenient(input, label) {
  var text = String(input == null ? "" : input).trim();

  try {
    return JSON.parse(text);
  } catch (firstError) {
    try {
      return JSON.parse(sanitizeJsonControls(text));
    } catch (secondError) {
      throw new Error(
        (label || "payload") + " JSON parse failed: " +
        (secondError && secondError.message ? secondError.message : String(secondError))
      );
    }
  }
}

function fetchJson(url, options) {
  return fetchText(url, options).then(function (text) {
    return parseJsonLenient(text, "TMDB");
  });
}

function getCryptoJS() {
  try {
    return require("crypto-js");
  } catch (error) {
    throw new Error("crypto-js module unavailable");
  }
}

function normalizeEncryptedBase64(input) {
  var value = String(input || "")
    .replace(/-_\./g, "/")
    .replace(/@/g, "+")
    .replace(/\s+/g, "");

  var remainder = value.length % 4;
  if (remainder) value += new Array(5 - remainder).join("=");
  return value;
}

function decryptString(encrypted) {
  var CryptoJS = getCryptoJS();
  var normalized = normalizeEncryptedBase64(encrypted);
  var cipherBytes = CryptoJS.enc.Base64.parse(normalized);
  var key = CryptoJS.enc.Utf8.parse(AES_KEY);
  var iv = CryptoJS.enc.Utf8.parse(AES_IV);
  var params = CryptoJS.lib.CipherParams.create({ ciphertext: cipherBytes });
  var decrypted = CryptoJS.AES.decrypt(params, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  var plain = decrypted.toString(CryptoJS.enc.Utf8);
  if (!plain) throw new Error("empty decrypted payload");

  var wrapper = parseJsonLenient(plain, "encrypted wrapper");
  if (!wrapper || wrapper.result == null) {
    throw new Error("decrypted payload missing result");
  }

  if (typeof wrapper.result === "string") {
    return wrapper.result;
  }

  return JSON.stringify(wrapper.result);
}

function decryptViaRemote(raw) {
  return fetch("https://enc-dec.app/api/dec-onetouchtv", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify({ text: String(raw || "") })
  }).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("remote decrypt HTTP " + (res ? res.status : "unknown"));
    }
    return res.text();
  }).then(function (body) {
    var envelope = parseJsonLenient(body, "remote decrypt response");

    if (!envelope || Number(envelope.status) !== 200) {
      throw new Error(
        "remote decrypt failed" +
        (envelope && envelope.error ? ": " + envelope.error : "")
      );
    }

    var result = envelope.result;

    if (typeof result === "string") {
      return parseJsonLenient(result, "remote decrypted result");
    }

    if (result && typeof result === "object") {
      return result;
    }

    throw new Error("remote decrypt returned empty result");
  });
}

function getDecryptedJson(url) {
  return fetchText(url, {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "Referer": BASE + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function (raw) {
    try {
      return parseJsonLenient(decryptString(raw), "decrypted result");
    } catch (localError) {
      console.log(
        "[OneTouchTV] local decrypt failed, trying remote fallback: " +
        (localError && localError.message ? localError.message : String(localError))
      );
      return decryptViaRemote(raw);
    }
  });
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingYear(value) {
  return normalizeTitle(value)
    .replace(/\s+(?:19|20)\d{2}$/, "")
    .trim();
}

function seasonTitleVariants(title, season) {
  var s = Number(season || 1);
  var base = String(title || "").trim();
  if (!base || s <= 1) return [];

  return [
    base + " Season " + s,
    base + " Season" + s,
    base + " S" + String(s).padStart(2, "0"),
    base + " S" + s,
    base + " " + s,
    base + " " + s + "nd Season",
    base + " " + s + "rd Season",
    base + " " + s + "th Season"
  ];
}

function inferQuality(value) {
  var match = String(value || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)(?:p|[^0-9]|$)/i);
  return match ? match[1] + "p" : "Auto";
}

function inferType(url) {
  var value = String(url || "").toLowerCase();
  if (value.indexOf(".m3u8") !== -1) return "m3u8";
  if (value.indexOf(".mp4") !== -1) return "mp4";
  return "m3u8";
}

function fetchTmdbDetails(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(tmdbId) +
    "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles";

  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT
    }
  }).then(function (data) {
    if (!data) return null;

    var altRoot = data.alternative_titles || {};
    var altItems = type === "movie"
      ? (Array.isArray(altRoot.titles) ? altRoot.titles : [])
      : (Array.isArray(altRoot.results) ? altRoot.results : []);

    var alternativeTitles = altItems.map(function (item) {
      return item && item.title ? String(item.title).trim() : "";
    }).filter(Boolean);

    return {
      title: type === "movie" ? (data.title || data.original_title || "") : (data.name || data.original_name || ""),
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").slice(0, 4),
      alternativeTitles: alternativeTitles
    };
  });
}

function buildQueries(details, mediaType, season) {
  var queries = [];

  function add(value) {
    value = String(value || "").trim();
    if (value && queries.indexOf(value) === -1) queries.push(value);
  }

  var titles = [details.title, details.originalTitle]
    .concat(Array.isArray(details.alternativeTitles) ? details.alternativeTitles : [])
    .filter(Boolean);

  if (mediaType === "tv" && Number(season || 1) > 1) {
    titles.slice(0, 4).forEach(function (title) {
      seasonTitleVariants(title, season).forEach(add);
    });
  }

  titles.forEach(add);
  return queries.slice(0, 12);
}

function parseSearchPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.result)) return payload.result;
  return [];
}

function search(query) {
  var url = BASE + "/vod/search?page=1&keyword=" + encodeURIComponent(query);
  return getDecryptedJson(url).then(parseSearchPayload);
}

function collectCandidates(queries) {
  var map = {};
  var chain = Promise.resolve();

  queries.forEach(function (query) {
    chain = chain.then(function () {
      return search(query).then(function (items) {
        (items || []).forEach(function (item) {
          var id = item && item.id != null ? String(item.id) : "";
          if (id) map[id] = item;
        });
      }).catch(function (error) {
        console.log("[OneTouchTV] search failed query='" + query + "' error=" + error.message);
      });
    });
  });

  return chain.then(function () {
    return Object.keys(map).map(function (id) { return map[id]; });
  });
}

function targetTitles(details, mediaType, season) {
  var set = {};

  function add(value) {
    var n = normalizeTitle(value);
    if (n) set[n] = true;
  }

  var titles = [details.title, details.originalTitle]
    .concat(Array.isArray(details.alternativeTitles) ? details.alternativeTitles : [])
    .filter(Boolean);

  titles.forEach(add);

  if (mediaType === "tv" && Number(season || 1) > 1) {
    titles.forEach(function (title) {
      seasonTitleVariants(title, season).forEach(add);
    });
  }

  return set;
}

function titleMatchesTargets(value, targets) {
  var exact = normalizeTitle(value);
  if (exact && targets[exact]) return true;

  var withoutYear = stripTrailingYear(value);
  return !!(withoutYear && targets[withoutYear]);
}

function itemTitleSet(item) {
  var set = {};
  function add(value) {
    var n = normalizeTitle(value);
    if (n) set[n] = true;
  }

  add(item && item.title);
  (Array.isArray(item && item.otherTitles) ? item.otherTitles : []).forEach(add);
  return set;
}

function mediaTypeCompatible(value, mediaType) {
  var type = String(value || "").trim().toLowerCase();
  if (!type) return true;
  var isMovie = type === "movie" || type === "film";
  if (mediaType === "movie") return isMovie;
  return !isMovie;
}

function candidateScore(item, details, mediaType, season) {
  if (!item || !mediaTypeCompatible(item.type, mediaType)) return null;

  var targets = targetTitles(details, mediaType, season);
  var values = [item.title]
    .concat(Array.isArray(item.otherTitles) ? item.otherTitles : [])
    .filter(Boolean);

  var matched = values.some(function (value) {
    return titleMatchesTargets(value, targets);
  });

  if (!matched) return null;

  var targetYear = Number(String(details.year || "").slice(0, 4));
  var itemYear = Number(String(item.year || "").slice(0, 4));
  var seasonNumber = Number(season || 1);

  // TMDB TV year is the show's first-air year. Do not reject later seasons
  // because their upstream item can use the season's actual release year.
  if (
    (mediaType === "movie" || seasonNumber <= 1) &&
    targetYear &&
    itemYear &&
    Math.abs(targetYear - itemYear) > 1
  ) {
    return null;
  }

  var score = 100;
  var normalizedMain = stripTrailingYear(item.title);

  if (normalizedMain === normalizeTitle(details.title)) score += 30;
  if (normalizedMain === normalizeTitle(details.originalTitle)) score += 20;

  if (mediaType === "tv" && seasonNumber > 1) {
    var seasonVariants = seasonTitleVariants(details.title, seasonNumber)
      .map(normalizeTitle);

    if (seasonVariants.indexOf(normalizedMain) !== -1) {
      score += 100;
    }

    // Prefer a later-year entry for later seasons, but never require it.
    if (targetYear && itemYear && itemYear > targetYear) score += 20;
  } else if (targetYear && itemYear) {
    score += targetYear === itemYear ? 50 : 20;
  }

  return score;
}

function fetchDetail(id) {
  return getDecryptedJson(BASE + "/vod/" + encodeURIComponent(id) + "/detail");
}

function detailScore(detail, item, details, mediaType, season) {
  var baseScore = candidateScore(item, details, mediaType, season);
  if (baseScore === null || !detail) return null;
  if (!mediaTypeCompatible(detail.type, mediaType)) return null;

  var targets = targetTitles(details, mediaType, season);
  var detailTitle = String(detail.title || "");

  if (detailTitle && !titleMatchesTargets(detailTitle, targets)) {
    var itemTitles = itemTitleSet(item);
    var normalizedDetail = normalizeTitle(detailTitle);
    var strippedDetail = stripTrailingYear(detailTitle);

    if (!itemTitles[normalizedDetail] && !itemTitles[strippedDetail]) {
      return null;
    }
  }

  var targetYear = Number(String(details.year || "").slice(0, 4));
  var resultYear = Number(String(detail.year || "").slice(0, 4));
  var seasonNumber = Number(season || 1);

  if (
    (mediaType === "movie" || seasonNumber <= 1) &&
    targetYear &&
    resultYear &&
    Math.abs(targetYear - resultYear) > 1
  ) {
    return null;
  }

  var score = baseScore;
  var strippedTitle = stripTrailingYear(detailTitle);

  if (strippedTitle === normalizeTitle(details.title)) score += 30;

  if (mediaType === "tv" && seasonNumber > 1) {
    var seasonVariants = seasonTitleVariants(details.title, seasonNumber)
      .map(normalizeTitle);

    if (seasonVariants.indexOf(strippedTitle) !== -1) score += 100;
    if (targetYear && resultYear && resultYear > targetYear) score += 20;
  } else if (targetYear && resultYear) {
    score += targetYear === resultYear ? 40 : 15;
  }

  return score;
}

function chooseBest(candidates, details, mediaType, season) {
  var ranked = (candidates || []).map(function (item) {
    return { item: item, score: candidateScore(item, details, mediaType, season) };
  }).filter(function (x) {
    return typeof x.score === "number";
  }).sort(function (a, b) {
    return b.score - a.score;
  }).slice(0, 8);

  if (!ranked.length) {
    var sample = (candidates || []).slice(0, 10).map(function (item) {
      return String(item && item.title || "?") +
        (item && item.year ? " (" + item.year + ")" : "") +
        (item && item.type ? " [" + item.type + "]" : "");
    }).join(" | ");

    console.log(
      "[OneTouchTV] no ranked match" +
      (sample ? " candidates=" + sample : "")
    );
    return Promise.resolve(null);
  }

  return Promise.all(ranked.map(function (entry) {
    return fetchDetail(entry.item.id).then(function (detail) {
      return {
        item: entry.item,
        detail: detail,
        score: detailScore(detail, entry.item, details, mediaType, season)
      };
    }).catch(function () {
      return null;
    });
  })).then(function (items) {
    var valid = items.filter(function (x) {
      return x && typeof x.score === "number";
    }).sort(function (a, b) {
      return b.score - a.score;
    });
    return valid.length ? valid[0] : null;
  });
}

function findPlayableEpisode(detail, mediaType, episode) {
  var episodes = Array.isArray(detail && detail.episodes) ? detail.episodes : [];
  var playable = episodes.filter(function (item) {
    return item && String(item.identifier || "").trim() && String(item.playId || "").trim();
  });

  if (mediaType === "movie") return playable.length ? playable[0] : null;

  var target = Number(episode || 1);
  var exact = playable.find(function (item) {
    var value = Number(item.episode);
    return Number.isFinite(value) && value === target;
  });
  return exact || null;
}

function parseStreams(payload) {
  var root = payload && payload.result && typeof payload.result === "object" ? payload.result : payload;
  var sources = root && Array.isArray(root.sources) ? root.sources : [];

  var seen = {};
  return sources.map(function (source) {
    var url = String(source && source.url || "").trim();
    if (!url) return null;

    var headerObj = source && source.headers && typeof source.headers === "object"
      ? source.headers
      : {};
    var headerKey = Object.keys(headerObj).sort().map(function (key) {
      return key + ":" + String(headerObj[key]);
    }).join("|");
    var dedupe = url + "|" + headerKey;
    if (seen[dedupe]) return null;
    seen[dedupe] = true;

    var quality = String(source.quality || "").trim() || inferQuality(source.name || url);
    var label = String(source.name || "Source").trim();

    return {
      name: PROVIDER,
      title: label + (quality && label.toLowerCase().indexOf(quality.toLowerCase()) === -1 ? " • " + quality : ""),
      url: url,
      quality: quality || "Auto",
      headers: headerObj,
      provider: PROVIDER,
      type: inferType(url)
    };
  }).filter(Boolean);
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "movie" ? "movie" : "tv";
  console.log(
    "[OneTouchTV] TMDB=" + tmdbId +
    " type=" + mediaType +
    (mediaType === "tv" ? " S" + Number(season || 1) + "E" + Number(episode || 1) : "")
  );

  var details;
  var match;

  return fetchTmdbDetails(tmdbId, mediaType)
    .then(function (value) {
      details = value;
      if (!details || !details.title) throw new Error("TMDB metadata unavailable");
      var queries = buildQueries(details, mediaType, season);
      return collectCandidates(queries);
    })
    .then(function (candidates) {
      return chooseBest(candidates, details, mediaType, season);
    })
    .then(function (value) {
      match = value;
      if (!match || !match.detail) {
        throw new Error("No matching title found");
      }

      console.log(
        "[OneTouchTV] matched id=" + match.item.id +
        " title='" + String(match.detail.title || match.item.title || "") +
        "' year=" + String(match.detail.year || match.item.year || "")
      );

      var selected = findPlayableEpisode(match.detail, mediaType, episode);
      if (!selected) throw new Error("Episode/stream entry not found");

      var streamUrl = BASE + "/vod/" + encodeURIComponent(selected.identifier) +
        "/episode/" + encodeURIComponent(selected.playId);
      return getDecryptedJson(streamUrl);
    })
    .then(function (payload) {
      var streams = parseStreams(payload);
      console.log("[OneTouchTV] v1.0.3 playable sources=" + streams.length);
      return streams;
    })
    .catch(function (error) {
      console.log("[OneTouchTV] " + (error && error.message ? error.message : String(error)));
      return [];
    });
}

module.exports = { getStreams };
