var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://movies2watch.watch"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "Watch2Movies";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
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
    var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=en-US");
    var dataEn = resEn.ok ? await resEn.json() : null;

    var titleEn = dataEn ? (dataEn.title || dataEn.name) : "";
    var origTitle = (dataEn && dataEn.original_title) || (dataEn && dataEn.original_name) || "";
    var date = (dataEn && (dataEn.release_date || dataEn.first_air_date)) || "";
    var year = date ? parseInt(date.substring(0, 4), 10) : null;

    return {
      titleEn: titleEn || origTitle,
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
    title: label || "Watch2Movies",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "watch2movies"
  };
}

async function searchWatch2Movies(query, base) {
  var results = [];
  try {
    var searchUrl = base + "/search/" + encodeURIComponent(query).replace(/%20/g, "-");
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("div.flw-item").each(function(i, el) {
        var a = $(el).find("h3 a, a.film-poster-ahref").first();
        var href = a.attr("href");
        var title = $(el).find("h3 a").text() || a.attr("title");
        if (href && title) {
          results.push({
            title: sanitizeText(title),
            url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href,
            isTv: href.indexOf("/tv/") !== -1 || href.indexOf("/series/") !== -1
          });
        }
      });
    }
  } catch (e) {}
  return results;
}

async function resolveServer(srvUrl, referer) {
  var streams = [];
  try {
    var res = await fetch(srvUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/"
      }
    });
    if (!res.ok) return streams;
    var html = await res.text();

    var m3u8Match = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (m3u8Match && m3u8Match[1]) {
      streams.push(makeStream(m3u8Match[1], "W2M Fast", "1080p", true, {
        "User-Agent": USER_AGENT,
        "Referer": srvUrl
      }));
    }

    var mp4Match = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    if (mp4Match && mp4Match[1]) {
      streams.push(makeStream(mp4Match[1], "W2M MP4", "1080p", false, {
        "User-Agent": USER_AGENT,
        "Referer": srvUrl
      }));
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

  var titlesToSearch = [tmdb.titleEn, tmdb.originalTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var d = 0; d < DOMAINS.length; d++) {
    var base = DOMAINS[d];
    for (var t = 0; t < titlesToSearch.length; t++) {
      var query = titlesToSearch[t];
      var searchItems = await searchWatch2Movies(query, base);
      if (!searchItems || searchItems.length === 0) continue;

      var bestMatch = null;
      var bestScore = 999;
      var normEn = normalizeTitle(tmdb.titleEn);

      for (var i = 0; i < searchItems.length; i++) {
        var it = searchItems[i];
        if (isTv && !it.isTv) continue;
        if (!isTv && it.isTv) continue;
        var itemNorm = normalizeTitle(it.title);
        var dist = levenshteinDistance(itemNorm, normEn);
        if (itemNorm.indexOf(normEn) !== -1) {
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
        var pageRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
        if (pageRes.ok) {
          var pHtml = await pageRes.text();
          var plMatch = pHtml.match(/pl_url\s*=\s*['"]([^'"]+)['"]/);
          if (plMatch && plMatch[1]) {
            var plUrl = plMatch[1];
            var srvRes = await fetch(plUrl, {
              headers: {
                "User-Agent": USER_AGENT,
                "Referer": bestMatch.url
              }
            });
            if (srvRes.ok) {
              var srvHtml = await srvRes.text();
              var $srv = cheerio.load(srvHtml);
              var serverUrls = [];
              $srv("a.sv-item").each(function(i, el) {
                var sId = $srv(el).attr("data-id");
                if (sId) serverUrls.push(sId);
              });

              for (var si = 0; si < serverUrls.length; si++) {
                var sUrl = serverUrls[si];
                var resList = await resolveServer(sUrl, bestMatch.url);
                for (var r = 0; r < resList.length; r++) {
                  streams.push(resList[r]);
                }
              }
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
