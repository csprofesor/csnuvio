var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://dizigom3.top",
  "https://dizigom.tv",
  "https://dizigom.org"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "DiziGom";
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
    title: label || "DiziGom",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "dizigom"
  };
}

async function searchDiziGom(query, base) {
  var results = [];
  try {
    var searchUrl = base + "/ara?q=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("a[href*='/dizi/'], a[href*='/film/'], a[href*='/anime/'], div.item a").each(function(i, el) {
        var href = $(el).attr("href");
        if (!href) return;
        if (href.indexOf("/sezon-") !== -1 || href.indexOf("/bolum-") !== -1) return;
        var title = $(el).find("h3, h2").first().text() || $(el).attr("title") || $(el).text();
        title = title.replace(/\s*(Dizi|Film|Anime)\s*izle/gi, "").trim();
        if (title && href) {
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

async function resolveVidMoly(molyUrl, referer) {
  try {
    var res = await fetch(molyUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/"
      }
    });
    if (!res.ok) return null;
    var html = await res.text();
    var m = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) || html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/i);
    if (m && m[1]) return m[1];
  } catch (e) {}
  return null;
}

async function extractStreams(playerUrl, pageUrl) {
  var streams = [];
  try {
    if (playerUrl.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(playerUrl, pageUrl);
      if (m3u8) {
        streams.push(makeStream(m3u8, "VidMoly [DiziGom]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": playerUrl
        }));
      }
      return streams;
    }

    var res = await fetch(playerUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": pageUrl
      }
    });
    if (!res.ok) return streams;
    var html = await res.text();

    var streamMatch = html.match(/["']stream["']\s*:\s*["']([^"']+)["']/i) ||
                      html.match(/file:\s*["']([^"']+)["']/i) ||
                      html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);

    if (streamMatch && streamMatch[1]) {
      var directUrl = streamMatch[1].replace(/\\u0026/g, "&").replace(/u0026/g, "&").replace(/\\\//g, "/").replace(/\\/g, "");
      var isHls = directUrl.indexOf(".m3u8") !== -1 || directUrl.indexOf("stream.php") !== -1;
      streams.push(makeStream(directUrl, "DiziGom Player", "1080p", isHls, {
        "User-Agent": USER_AGENT,
        "Referer": playerUrl
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

  var titlesToSearch = [tmdb.titleTr, tmdb.titleEn, tmdb.originalTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var d = 0; d < DOMAINS.length; d++) {
    var base = DOMAINS[d];
    for (var t = 0; t < titlesToSearch.length; t++) {
      var query = titlesToSearch[t];
      var searchItems = await searchDiziGom(query, base);
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

      var targetPageUrl = bestMatch.url;
      if (isTv) {
        try {
          var showRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
          if (showRes.ok) {
            var showHtml = await showRes.text();
            var $show = cheerio.load(showHtml);
            var epFound = null;
            $show("a[href*='/sezon-'][href*='/bolum-']").each(function(idx, el) {
              var href = $show(el).attr("href");
              if (!href) return;
              var sM = href.match(/sezon-(\d+)/i);
              var eM = href.match(/bolum-(\d+)/i);
              if (sM && eM && parseInt(sM[1], 10) === sNum && parseInt(eM[1], 10) === eNum) {
                epFound = href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href;
              }
            });
            if (epFound) {
              targetPageUrl = epFound;
            } else {
              targetPageUrl = bestMatch.url.replace(/\/$/, "") + "/sezon-" + sNum + "/bolum-" + eNum;
            }
          }
        } catch (e) {}
      }

      var streams = [];
      try {
        var pageRes = await fetch(targetPageUrl, { headers: BASE_HEADERS });
        if (pageRes.ok) {
          var pageHtml = await pageRes.text();
          var $p = cheerio.load(pageHtml);
          var playerUrls = [];

          $p("[data-pv]").each(function(idx, el) {
            var pv = $p(el).attr("data-pv");
            if (pv) {
              playerUrls.push("https://play2.pilavyerplay.top/assets/js/s.php?s=" + pv);
            }
          });

          $p("iframe[src], iframe[data-src], [data-embed], [data-player]").each(function(idx, el) {
            var src = $p(el).attr("src") || $p(el).attr("data-src") || $p(el).attr("data-embed") || $p(el).attr("data-player");
            if (src && playerUrls.indexOf(src) === -1) {
              playerUrls.push(src);
            }
          });

          for (var pi = 0; pi < playerUrls.length; pi++) {
            var pUrl = playerUrls[pi];
            if (pUrl.startsWith("//")) pUrl = "https:" + pUrl;
            else if (pUrl.startsWith("/")) pUrl = base + pUrl;

            var resStreams = await extractStreams(pUrl, targetPageUrl);
            for (var si = 0; si < resStreams.length; si++) {
              streams.push(resStreams[si]);
            }
          }
        }
      } catch (e) {}

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
