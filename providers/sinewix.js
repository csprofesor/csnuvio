var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://ydfvfdizipanel.ru/public/api";
var API_KEY = "9174121c-b15d-4d6b-9e64-5cee5389bfe9";
var PROVIDER_NAME = "SineWix";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "EasyPlex (Android 13; SM-A546E; samsung; tr)";
var SINEWIX_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json",
  "X-App-Id": "sinewix-mobile",
  "X-Platform": "android",
  "packagename": "com.wxsmash.game",
  "X-Device-Id": "android_1234567890abcdef"
};

function sanitizeText(str) {
  if (!str) return "";
  return str.replace(/&#(\d+);/g, function(match, dec) {
    return String.fromCharCode(dec);
  }).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").trim();
}

function normalizeTitle(str) {
  if (!str) return "";
  return str.toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(s1, s2) {
  var a = s1 || "";
  var b = s2 || "";
  var matrix = [];
  for (var i = 0; i <= b.length; i++) matrix[i] = [i];
  for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (var i = 1; i <= b.length; i++) {
    for (var j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

async function fetchTmdbDetails(tmdbId, mediaType) {
  var idStr = String(tmdbId || "").trim();
  if (!/^\d+$/.test(idStr)) {
    return {
      titleTr: idStr,
      titleEn: idStr,
      originalTitle: idStr,
      year: null
    };
  }
  try {
    var type = mediaType === "movie" ? "movie" : "tv";
    var trUrl = "https://api.themoviedb.org/3/" + type + "/" + idStr + "?api_key=" + TMDB_API_KEY + "&language=tr-TR";
    var enUrl = "https://api.themoviedb.org/3/" + type + "/" + idStr + "?api_key=" + TMDB_API_KEY + "&language=en-US";

    var pTr = fetch(trUrl).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    var pEn = fetch(enUrl).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

    var res = await Promise.all([pTr, pEn]);
    var dataTr = res[0] || {};
    var dataEn = res[1] || {};

    var titleTr = dataTr.title || dataTr.name || dataEn.title || dataEn.name || "";
    var titleEn = dataEn.title || dataEn.name || dataTr.title || dataTr.name || "";
    var origTitle = dataEn.original_title || dataEn.original_name || dataTr.original_title || dataTr.original_name || "";
    var date = dataEn.release_date || dataEn.first_air_date || dataTr.release_date || dataTr.first_air_date || "";
    var year = date ? parseInt(date.substring(0, 4), 10) : null;

    return {
      titleTr: titleTr || titleEn || origTitle,
      titleEn: titleEn || titleTr || origTitle,
      originalTitle: origTitle || titleTr || titleEn,
      year: year
    };
  } catch (e) {
    return null;
  }
}

function makeStream(url, label, quality, isHls, headers) {
  return {
    name: PROVIDER_NAME,
    title: label || "SineWix",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || SINEWIX_HEADERS,
    provider: "sinewix"
  };
}

async function searchSineWix(query) {
  var results = [];
  try {
    var url = BASE_URL + "/search/" + encodeURIComponent(query) + "/" + API_KEY;
    var res = await fetch(url, { headers: SINEWIX_HEADERS });
    if (res.ok) {
      var json = await res.json();
      var list = json.search || json.data || (Array.isArray(json) ? json : []);
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var title = it.title || it.name;
        var id = it.id;
        var type = (it.type || "").toLowerCase();
        if (title && id) {
          results.push({
            id: id,
            title: sanitizeText(title),
            isTv: type === "serie" || type === "series" || type === "tv" || type === "anime"
          });
        }
      }
    }
  } catch (e) {}
  return results;
}

async function resolveVidMoly(molyUrl, referer) {
  try {
    var res = await fetch(molyUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": referer || "https://vidmoly.me/"
      }
    });
    if (!res.ok) return null;
    var html = await res.text();
    var m = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) || html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/i);
    if (m && m[1]) return m[1];
  } catch (e) {}
  return null;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  var tmdb = await fetchTmdbDetails(tmdbId, mediaType);
  if (!tmdb) return [];

  var isTv = mediaType === "tv";
  var sNum = parseInt(seasonNum, 10) || 1;
  var eNum = parseInt(episodeNum, 10) || 1;

  var titlesToSearch = [tmdb.titleTr, tmdb.titleEn, tmdb.originalTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var t = 0; t < titlesToSearch.length; t++) {
    var query = titlesToSearch[t];
    var searchItems = await searchSineWix(query);
    if (!searchItems || searchItems.length === 0) continue;

    var bestMatch = null;
    var bestScore = 999;
    var normTr = normalizeTitle(tmdb.titleTr);
    var normEn = normalizeTitle(tmdb.titleEn);

    for (var i = 0; i < searchItems.length; i++) {
      var it = searchItems[i];
      if (isTv && !it.isTv) continue;
      if (!isTv && it.isTv) continue;
      var itemNorm = normalizeTitle(it.title);
      var dist = Math.min(levenshteinDistance(itemNorm, normTr), levenshteinDistance(itemNorm, normEn));
      if (itemNorm.indexOf(normTr) !== -1 || itemNorm.indexOf(normEn) !== -1) {
        dist = Math.floor(dist / 2);
      }
      if (dist < bestScore) {
        bestScore = dist;
        bestMatch = it;
      }
    }

    if (!bestMatch || bestScore > 10) continue;

    var streams = [];
    try {
      if (isTv) {
        var detailUrl = BASE_URL + "/series/show/" + bestMatch.id + "/" + API_KEY;
        var dRes = await fetch(detailUrl, { headers: SINEWIX_HEADERS });
        if (dRes.ok) {
          var dJson = await dRes.json();
          var seasons = dJson.seasons || [];
          for (var si = 0; si < seasons.length; si++) {
            var season = seasons[si];
            var seasonNumber = season.season_number || (si + 1);
            if (seasonNumber === sNum) {
              var episodes = season.episodes || [];
              for (var ei = 0; ei < episodes.length; ei++) {
                var ep = episodes[ei];
                var epNumber = ep.episode_number || (ei + 1);
                if (epNumber === eNum) {
                  var videos = ep.videos || ep.servers || [];
                  for (var vi = 0; vi < videos.length; vi++) {
                    var v = videos[vi];
                    var vidUrl = v.link || v.url || v.embed_url;
                    var server = v.server || v.name || "SineWix";
                    if (vidUrl) {
                      if (vidUrl.indexOf("vidmoly") !== -1) {
                        var molyM3u8 = await resolveVidMoly(vidUrl, BASE_URL);
                        if (molyM3u8) {
                          streams.push(makeStream(molyM3u8, "VidMoly [SineWix]", "1080p", true));
                        }
                      } else {
                        var isHls = v.hls === 1 || vidUrl.indexOf(".m3u8") !== -1;
                        streams.push(makeStream(vidUrl, "SineWix - " + server, "1080p", isHls));
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        var movieUrl = BASE_URL + "/media/detail/" + bestMatch.id + "/" + API_KEY;
        var mRes = await fetch(movieUrl, { headers: SINEWIX_HEADERS });
        if (mRes.ok) {
          var mJson = await mRes.json();
          var mVideos = mJson.videos || [];
          for (var mi = 0; mi < mVideos.length; mi++) {
            var mv = mVideos[mi];
            var mUrl = mv.link || mv.url || mv.embed_url;
            var mServer = mv.server || mv.name || "SineWix";
            if (mUrl) {
              if (mUrl.indexOf("vidmoly") !== -1) {
                var molyM3u8M = await resolveVidMoly(mUrl, BASE_URL);
                if (molyM3u8M) {
                  streams.push(makeStream(molyM3u8M, "VidMoly [SineWix]", "1080p", true));
                }
              } else {
                var isHlsM = mv.hls === 1 || mUrl.indexOf(".m3u8") !== -1;
                streams.push(makeStream(mUrl, "SineWix - " + mServer, "1080p", isHlsM));
              }
            }
          }
        }
      }
    } catch (errDetail) {}

    if (streams.length > 0) {
      return streams;
    }
  }

  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: hardCapGetStreams };
} else {
  global.getStreams = hardCapGetStreams;
}

function hardCapGetStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.race([
    _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum),
    new Promise(function(resolve) {
      setTimeout(function() { resolve([]); }, 2200);
    })
  ]);
}
