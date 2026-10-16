var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://belgeselx.com"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "BelgeselX";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
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
    title: label || "BelgeselX",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "belgeselx"
  };
}

async function searchBelgeselX(query, base) {
  var results = [];
  try {
    var res = await fetch(base + "/?s=" + encodeURIComponent(query), { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("a.px-card, div.px-grid a").each(function(i, el) {
        var href = $(el).attr("href");
        var title = $(el).find(".px-card-title, h3, h2").text() || $(el).attr("title");
        if (href && title) {
          results.push({
            title: sanitizeText(title),
            url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href
          });
        }
      });
    }
  } catch (e) {}
  return results;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var tmdb = await fetchTmdbDetails(tmdbId, mediaType);
  if (!tmdb) return [];

  var sNum = parseInt(seasonNum, 10) || 1;
  var eNum = parseInt(episodeNum, 10) || 1;

  var titlesToSearch = [tmdb.titleTr, tmdb.titleEn, tmdb.originalTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var d = 0; d < DOMAINS.length; d++) {
    var base = DOMAINS[d];
    for (var t = 0; t < titlesToSearch.length; t++) {
      var query = titlesToSearch[t];
      var searchItems = await searchBelgeselX(query, base);
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
        var docRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
        if (docRes.ok) {
          var docHtml = await docRes.text();
          var $d = cheerio.load(docHtml);

          var episodeId = null;
          $d("a.px-ep-card, a.px-ep-row").each(function(idx, el) {
            var onClickStr = $d(el).attr("onclick") || "";
            var paramsM = onClickStr.match(/diziGetir\((.*?)\)/);
            if (paramsM) {
              var params = paramsM[1].split(",").map(function(p) { return p.trim().replace(/['"]/g, ""); });
              var sParam = parseInt(params[7], 10) || 1;
              var eParam = parseInt(params[8], 10) || 1;
              if (sParam === sNum && eParam === eNum) {
                episodeId = params[0];
              }
            } else {
              var idM = onClickStr.match(/\(\s*['"]?(\d+)['"]?\s*\)/);
              if (idM && idx + 1 === eNum) {
                episodeId = idM[1];
              }
            }
          });

          if (!episodeId) {
            var bolumM = docHtml.match(/bolumId\s*:\s*(\d+)/);
            if (bolumM) episodeId = bolumM[1];
          }

          if (episodeId) {
            var endpoints = [
              "https://belgeselx.com/video/data/new3.php?id=" + episodeId + "&sira=2",
              "https://belgeselx.com/video/data/new1.php?id=" + episodeId + "&sira=2",
              "https://belgeselx.com/video/data/new5.php?id=" + episodeId + "&sira=1",
              "https://belgeselx.com/video/data/new4.php?id=" + episodeId + "&sira=1"
            ];

            for (var ei = 0; ei < endpoints.length; ei++) {
              var endUrl = endpoints[ei];
              try {
                var eRes = await fetch(endUrl, {
                  headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": bestMatch.url
                  }
                });
                if (eRes.ok) {
                  var eHtml = await eRes.text();
                  var $e = cheerio.load(eHtml);
                  var ifrSrc = $e("iframe").attr("src");
                  if (ifrSrc) {
                    var okIdM = ifrSrc.match(/(\d{10,})/);
                    if (okIdM) {
                      var okEmbed = "https://odnoklassniki.ru/videoembed/" + okIdM[1];
                      streams.push(makeStream(okEmbed, "Odnoklassniki [BelgeselX]", "720p", false, {
                        "User-Agent": USER_AGENT,
                        "Referer": endUrl
                      }));
                    } else {
                      streams.push(makeStream(ifrSrc, "Player [BelgeselX]", "1080p", ifrSrc.indexOf(".m3u8") !== -1, {
                        "User-Agent": USER_AGENT,
                        "Referer": endUrl
                      }));
                    }
                  }

                  var directM = eHtml.match(/file:\s*["']([^"']+)["']/i) ||
                                eHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                  if (directM && directM[1]) {
                    streams.push(makeStream(directM[1], "Fast Stream [BelgeselX]", "1080p", directM[1].indexOf(".m3u8") !== -1, {
                      "User-Agent": USER_AGENT,
                      "Referer": endUrl
                    }));
                  }
                }
              } catch (errEnd) {}
            }
          }
        }
      } catch (err) {}

      if (streams.length > 0) {
        return streams;
      }
    }
  }

  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
