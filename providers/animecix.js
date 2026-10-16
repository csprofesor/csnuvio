var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://animecix.tv"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "AnimeciX";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";
var X_E_H = "7Y2ozlO+QysR5w9Q6Tupmtvl9jJp7ThFH8SB+Lo7NvZjgjqRSqOgcT2v4ISM9sP10LmnlYI8WQ==.xrlyOBFS5BHjQ2Lk";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "application/json, text/plain, */*",
  "x-e-h": X_E_H
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
  try {
    var type = mediaType === "movie" ? "movie" : "tv";
    var resTr = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=tr-TR");
    var dataTr = resTr.ok ? await resTr.json() : null;

    var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=en-US");
    var dataEn = resEn.ok ? await resEn.json() : null;

    var titleTr = dataTr ? (dataTr.title || dataTr.name) : "";
    var titleEn = dataEn ? (dataEn.title || dataEn.name) : "";
    var origTitle = (dataEn && dataEn.original_title) || (dataEn && dataEn.original_name) || "";
    var date = (dataEn && (dataEn.release_date || dataEn.first_air_date)) || "";
    var year = date ? parseInt(date.substring(0, 4), 10) : null;

    return {
      titleTr: titleTr || titleEn || origTitle,
      titleEn: titleEn || origTitle || titleTr,
      originalTitle: origTitle,
      year: year
    };
  } catch (e) {
    return null;
  }
}

function makeStream(url, label, quality, isHls, headers) {
  return {
    name: PROVIDER_NAME,
    title: label || "AnimeciX",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "animecix"
  };
}

async function searchAnimeciX(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/secure/search/" + encodeURIComponent(query) + "?limit=20";
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var json = await res.json();
      var list = json.results || [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        var name = it.name || it.title || it.name_english || it.name_romanji;
        if (name && it.id) {
          results.push({
            id: it.id,
            title: sanitizeText(name)
          });
        }
      }
    }
  } catch (e) {}
  return results;
}

async function resolveTauVideo(tauUrl) {
  var streams = [];
  try {
    var videoKey = tauUrl.split("/").filter(Boolean).pop();
    var apiUrl = "https://tau-video.xyz/api/video/" + videoKey;
    var res = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://tau-video.xyz/"
      }
    });
    if (res.ok) {
      var json = await res.json();
      var urls = json.urls || [];
      for (var i = 0; i < urls.length; i++) {
        var u = urls[i];
        if (u.url) {
          streams.push(makeStream(u.url, "TauVideo - " + (u.label || "1080p"), u.label || "1080p", u.url.indexOf(".m3u8") !== -1, {
            "User-Agent": USER_AGENT,
            "Referer": "https://tau-video.xyz/"
          }));
        }
      }
    }
  } catch (e) {}
  return streams;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
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
    var searchItems = await searchAnimeciX(query);
    if (!searchItems || searchItems.length === 0) continue;

    var bestMatch = null;
    var bestScore = 999;
    var normTr = normalizeTitle(tmdb.titleTr);
    var normEn = normalizeTitle(tmdb.titleEn);

    for (var i = 0; i < searchItems.length; i++) {
      var it = searchItems[i];
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
      var titleUrl = BASE_URL + "/secure/titles/" + bestMatch.id + "?titleId=" + bestMatch.id;
      var titleRes = await fetch(titleUrl, { headers: BASE_HEADERS });
      if (titleRes.ok) {
        var tJson = await titleRes.json();
        var titleData = tJson.title || {};

        var targetVideoUrl = null;
        if (titleData.titleType === "anime" || isTv) {
          var relUrl = BASE_URL + "/secure/related-videos?episode=1&season=" + sNum + "&videoId=0&titleId=" + bestMatch.id;
          var relRes = await fetch(relUrl, { headers: BASE_HEADERS });
          if (relRes.ok) {
            var relJson = await relRes.json();
            var videos = relJson.videos || [];
            for (var vi = 0; vi < videos.length; vi++) {
              var vid = videos[vi];
              var vidS = vid.season_num || vid.seasonNum || 1;
              var vidE = vid.episode_num || vid.episodeNum || 1;
              if (vidS == sNum && vidE == eNum) {
                targetVideoUrl = vid.url;
                break;
              }
            }
          }
        } else {
          if (titleData.videos && titleData.videos[0]) {
            targetVideoUrl = titleData.videos[0].url;
          }
        }

        if (targetVideoUrl) {
          var directPageUrl = targetVideoUrl.startsWith("http") ? targetVideoUrl : BASE_URL + "/" + targetVideoUrl;
          var pageRes = await fetch(directPageUrl, {
            headers: {
              "User-Agent": USER_AGENT,
              "Referer": BASE_URL + "/"
            },
            redirect: "follow"
          });

          var finalUrl = pageRes.url;
          if (finalUrl && finalUrl.indexOf("tau-video") !== -1) {
            var tauStreams = await resolveTauVideo(finalUrl);
            for (var si = 0; si < tauStreams.length; si++) {
              streams.push(tauStreams[si]);
            }
          } else {
            var pHtml = await pageRes.text();
            var tauM = pHtml.match(/https?:\/\/(?:www\.)?tau-video\.xyz\/[^\s"'<>]+/i);
            if (tauM) {
              var tauStreams2 = await resolveTauVideo(tauM[0]);
              for (var s2 = 0; s2 < tauStreams2.length; s2++) {
                streams.push(tauStreams2[s2]);
              }
            } else {
              var m3u8M = pHtml.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                          pHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
              if (m3u8M && m3u8M[1]) {
                streams.push(makeStream(m3u8M[1], "AnimeciX Fast", "1080p", true, {
                  "User-Agent": USER_AGENT,
                  "Referer": directPageUrl
                }));
              }
            }
          }
        }
      }
    } catch (err) {}

    if (streams.length > 0) {
      for (var si = 0; si < streams.length; si++) {
        streams[si].title = (tmdb.titleTr || "AnimeciX") + " • Türkçe Altyazılı (" + (streams[si].quality || "1080p") + ")" + (si > 0 ? " #" + (si + 1) : "");
      }
      return streams;
    }
  }

  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
