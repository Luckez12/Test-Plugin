// src/kisskh/index.js
var PROVIDER = "KissKH";
var BASES = [
  "https://kisskh.do",
  "https://kisskh.id",
  "https://kisskh.co",
  "https://kisskh.li"
];
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var KISSKH_VERSION = "2.8.10";
var ENCDEC_API = "https://enc-dec.app/api";
var VIDEO_KEY_API = "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";
var SUBTITLE_KEY_API = "https://script.google.com/macros/s/AKfycbyq6hTj0ZhlinYC6xbggtgo166tp6XaDKBCGtnYk8uOfYBUFwwxBui0sGXiu_zIFmA/exec?id=";
var USER_AGENT = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Mobile Safari/537.36";
function fetchJson(url, options) {
  return fetch(url, options || {}).then(function(res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  }).then(function(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }).catch(function() {
    return null;
  });
}
function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/season\s*0*(\d+)/g, " season $1 ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function slugify(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function fixUrl(url, base) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.indexOf("//") === 0) return "https:" + value;
  if (value.indexOf("/") === 0) return base + value;
  return value;
}
function inferQuality(url) {
  const match = String(url || "").match(/(?:^|[^0-9])(2160|1440|1080|720|480|360)(?:p|[^0-9]|$)/i);
  return match ? match[1] + "p" : "Auto";
}
function isDirectVideo(url) {
  const value = String(url || "").toLowerCase();
  return value.indexOf(".m3u8") !== -1 || value.indexOf(".mp4") !== -1;
}
function fetchTmdbDetails(tmdbId, mediaType) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const url = TMDB_BASE + "/" + type + "/" + encodeURIComponent(tmdbId) + "?api_key=" + TMDB_API_KEY + "&append_to_response=external_ids";
  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT
    }
  }).then(function(data) {
    if (!data) return null;
    return {
      title: type === "movie" ? data.title || data.original_title : data.name || data.original_name,
      originalTitle: data.original_title || data.original_name || "",
      year: String(data.release_date || data.first_air_date || "").slice(0, 4)
    };
  });
}
function buildQueries(details, mediaType, season) {
  const out = [];
  function add(value) {
    value = String(value || "").trim();
    if (value && out.indexOf(value) === -1) out.push(value);
  }
  if (mediaType === "tv" && Number(season || 1) > 1) {
    add(details.title + " Season " + season);
    add(details.originalTitle + " Season " + season);
    add(details.title + " " + season);
    add(details.originalTitle + " " + season);
  }
  add(details.title);
  add(details.originalTitle);
  return out;
}
function searchBase(base, query) {
  const url = base + "/api/DramaList/Search?q=" + encodeURIComponent(query) + "&type=0";
  return fetchJson(url, {
    headers: {
      "Accept": "application/json",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  }).then(function(data) {
    return Array.isArray(data) ? data : null;
  });
}
function searchWorkingBase(queries) {
  let chain = Promise.resolve(null);
  BASES.forEach(function(base) {
    chain = chain.then(function(found) {
      if (found) return found;
      return searchBase(base, queries[0]).then(function(items) {
        if (items === null) return null;
        return { base, firstItems: items };
      });
    });
  });
  return chain;
}
function collectCandidates(base, queries, firstItems) {
  const map = {};
  (firstItems || []).forEach(function(item) {
    if (item && item.id != null) map[String(item.id)] = item;
  });
  let chain = Promise.resolve();
  queries.slice(1).forEach(function(query) {
    chain = chain.then(function() {
      return searchBase(base, query).then(function(items) {
        (items || []).forEach(function(item) {
          if (item && item.id != null) map[String(item.id)] = item;
        });
      });
    });
  });
  return chain.then(function() {
    return Object.keys(map).map(function(k) {
      return map[k];
    });
  });
}
function quickScore(item, details, mediaType, season) {
  const title = normalizeTitle(item && item.title);
  const target = normalizeTitle(details.title);
  const original = normalizeTitle(details.originalTitle);
  let score = 0;
  if (title === target || original && title === original) score += 100;
  else if (title.indexOf(target) !== -1 || target.indexOf(title) !== -1) score += 45;
  const type = String(item && item.type || "").toLowerCase();
  if (mediaType === "movie") {
    if (type === "movie" || type === "film") score += 25;
    else if (type) score -= 25;
  } else {
    if (type !== "movie" && type !== "film") score += 15;
  }
  if (mediaType === "tv" && Number(season || 1) > 1) {
    const seasonNorm = "season " + Number(season);
    if (title.indexOf(seasonNorm) !== -1 || title.endsWith(" " + Number(season))) score += 35;
  }
  return score;
}
function fetchDetail(base, id) {
  return fetchJson(base + "/api/DramaList/Drama/" + encodeURIComponent(id) + "?isq=false", {
    headers: {
      "Accept": "application/json",
      "Referer": base + "/",
      "User-Agent": USER_AGENT
    }
  });
}
function detailScore(detail, item, details, mediaType, season) {
  let score = quickScore(item, details, mediaType, season);
  if (!detail) return -999;
  const year = String(detail.releaseDate || "").slice(0, 4);
  if (details.year && year) {
    if (details.year === year) score += 35;
    else score -= 10;
  }
  const type = String(detail.type || "").toLowerCase();
  if (mediaType === "movie") {
    if (type === "movie" || type === "film") score += 20;
    else score -= 40;
  } else if (type === "movie" || type === "film") {
    score -= 40;
  }
  return score;
}
function chooseBestMatch(base, candidates, details, mediaType, season) {
  const ranked = (candidates || []).map(function(item) {
    return { item, score: quickScore(item, details, mediaType, season) };
  }).sort(function(a, b) {
    return b.score - a.score;
  }).slice(0, 6);
  return Promise.all(ranked.map(function(entry) {
    return fetchDetail(base, entry.item.id).then(function(detail) {
      return {
        item: entry.item,
        detail,
        score: detailScore(detail, entry.item, details, mediaType, season)
      };
    });
  })).then(function(items) {
    items.sort(function(a, b) {
      return b.score - a.score;
    });
    return items.length && items[0].score >= 60 ? items[0] : null;
  });
}
function pickEpisode(detail, mediaType, episode) {
  const episodes = detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  if (!episodes.length) return null;
  if (mediaType === "movie") {
    return episodes.find(function(e) {
      return e && e.id != null;
    }) || null;
  }
  const target = Number(episode || 1);
  return episodes.find(function(e) {
    return e && e.id != null && Math.abs(Number(e.number) - target) < 1e-3;
  }) || null;
}
function googleKey(episodeId, kind) {
  const endpoint = kind === "sub" ? SUBTITLE_KEY_API : VIDEO_KEY_API;
  return fetchJson(endpoint + encodeURIComponent(episodeId) + "&version=" + KISSKH_VERSION).then(function(data) {
    return data && data.key ? String(data.key) : "";
  });
}
function encDecKey(episodeId, kind) {
  return fetchJson(ENCDEC_API + "/enc-kisskh?text=" + encodeURIComponent(episodeId) + "&type=" + kind).then(function(data) {
    return data && data.status === 200 && data.result ? String(data.result) : "";
  });
}
function getKey(episodeId, kind) {
  return googleKey(episodeId, kind).then(function(key) {
    if (key) return key;
    return encDecKey(episodeId, kind);
  });
}
function subtitleLanguage(label) {
  const value = String(label || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "en" || value.indexOf("english") !== -1 || /(^|[^a-z])eng([^a-z]|$)/.test(value)) {
    return { language: "en", name: "English" };
  }
  if (value === "ms" || value === "msa" || value === "may" || value.indexOf("malay") !== -1 || value.indexOf("melayu") !== -1) {
    return { language: "ms", name: "Malay" };
  }
  if (value === "id" || value === "ind" || value.indexOf("indonesia") !== -1) {
    return { language: "id", name: "Indonesian" };
  }
  return null;
}
function fetchSubtitles(base, episodeId) {
  return getKey(episodeId, "sub").then(function(key) {
    if (!key) return [];
    return fetchJson(base + "/api/Sub/" + encodeURIComponent(episodeId) + "?kkey=" + encodeURIComponent(key), {
      headers: {
        "Accept": "application/json",
        "Referer": base + "/",
        "User-Agent": USER_AGENT
      }
    }).then(function(items) {
      if (!Array.isArray(items)) return [];
      const seen = {};
      const result = [];
      items.forEach(function(sub) {
        const lang = subtitleLanguage(sub && sub.label);
        let src = fixUrl(sub && sub.src, base);
        if (!lang || !src) return;
        if (/\.txt(?:\?|$)/i.test(src)) {
          src = ENCDEC_API + "/dec-kisskh?url=" + encodeURIComponent(src);
        }
        const key2 = lang.language + "|" + src;
        if (seen[key2]) return;
        seen[key2] = true;
        result.push({
          url: src,
          language: lang.language,
          name: lang.name,
          headers: { "Referer": base + "/", "User-Agent": USER_AGENT }
        });
      });
      return result;
    });
  }).catch(function() {
    return [];
  });
}
function fetchStreams(base, detail, episodeInfo, mediaType, season, episode, displayTitle) {
  const episodeId = episodeInfo.id;
  const episodeNumber = Number(episodeInfo.number || episode || 1);
  return Promise.all([
    getKey(episodeId, "vid"),
    fetchSubtitles(base, episodeId)
  ]).then(function(values) {
    const videoKey = values[0];
    const subtitles = values[1] || [];
    if (!videoKey) return [];
    const slug = slugify(detail.title || displayTitle);
    const referer = base + "/Drama/" + slug + "/Episode-" + episodeNumber + "?id=" + detail.id + "&ep=" + episodeId + "&page=0&pageSize=100";
    const apiUrl = base + "/api/DramaList/Episode/" + episodeId + ".png?err=false&ts=&time=&kkey=" + encodeURIComponent(videoKey);
    return fetchJson(apiUrl, {
      headers: {
        "Accept": "application/json",
        "Referer": referer,
        "User-Agent": USER_AGENT
      }
    }).then(function(source) {
      if (!source) return [];
      const rawLinks = [source.Video, source.ThirdParty].map(function(x) {
        return fixUrl(x, base);
      }).filter(function(x, i, arr) {
        return x && arr.indexOf(x) === i;
      });
      const streams = [];
      rawLinks.forEach(function(url) {
        if (!isDirectVideo(url)) return;
        const quality = inferQuality(url);
        const format = url.toLowerCase().indexOf(".m3u8") !== -1 ? "HLS" : "MP4";
        const suffix = mediaType === "tv" ? " S" + Number(season || 1) + "E" + Number(episode || 1) : "";
        streams.push({
          name: PROVIDER,
          title: (displayTitle || detail.title || PROVIDER) + suffix + " - " + quality + " [" + format + "]",
          url,
          quality,
          headers: {
            "Referer": base + "/",
            "Origin": base,
            "User-Agent": USER_AGENT
          },
          subtitles,
          provider: "kisskh"
        });
      });
      return streams;
    });
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "movie" ? "movie" : "tv";
  season = Number(season || 1);
  episode = Number(episode || 1);
  console.log("[KissKH] TMDB=" + tmdbId + " type=" + mediaType + " S" + season + "E" + episode);
  return fetchTmdbDetails(tmdbId, mediaType).then(function(details) {
    if (!details || !details.title) return [];
    const queries = buildQueries(details, mediaType, season);
    return searchWorkingBase(queries).then(function(working) {
      if (!working) return [];
      return collectCandidates(working.base, queries, working.firstItems).then(function(candidates) {
        return chooseBestMatch(working.base, candidates, details, mediaType, season);
      }).then(function(match) {
        if (!match || !match.detail) return [];
        const ep = pickEpisode(match.detail, mediaType, episode);
        if (!ep) {
          console.log("[KissKH] Episode not found");
          return [];
        }
        return fetchStreams(
          working.base,
          match.detail,
          ep,
          mediaType,
          season,
          episode,
          details.title
        );
      });
    });
  }).catch(function(error) {
    console.error("[KissKH] " + (error && error.message ? error.message : error));
    return [];
  });
}
module.exports = { getStreams };
