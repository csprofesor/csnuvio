var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://sinematv.az"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "SinemaTV";
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
    title: label || "SinemaTV",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "sinematv"
  };
}

async function searchSinemaTV(query, base) {
  var results = [];
  try {
    var searchUrl = base + "/?do=search&subaction=search&story=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("a.poster-item, div.poster-item").each(function(i, el) {
        var a = $(el).is("a") ? $(el) : $(el).find("a").first();
        var href = a.attr("href");
        var title = $(el).find(".poster-item__title, .poster-title, .title").text() || a.attr("title");
        if (href && title) {
          results.push({
            title: sanitizeText(title),
            url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href,
            isTv: href.indexOf("/serial/") !== -1 || href.indexOf("/dorama/") !== -1
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

async function resolveIframe(iframeUrl, referer) {
  var streams = [];
  try {
    if (iframeUrl.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(iframeUrl, referer);
      if (m3u8) {
        streams.push(makeStream(m3u8, "VidMoly [SinemaTV]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": iframeUrl
        }));
      }
      return streams;
    }

    if (iframeUrl.indexOf("vv-player.php") !== -1) {
      var movieIdM = iframeUrl.match(/movie_id=([^&]+)/);
      if (movieIdM && movieIdM[1]) {
        var movieId = movieIdM[1];
        var apiUrl = BASE_URL + "/vv-api.php?path=/balancer-api/proxy/playlists/catalog-api/episodes&content-id=" + movieId;
        var apiRes = await fetch(apiUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            "Referer": iframeUrl,
            "X-Has-Token": "1"
          }
        });
        if (apiRes.ok) {
          var apiText = await apiRes.text();
          var m3u8Matches = apiText.matchAll(/https?:\/\/[^\s"'<>]+?(?:\.m3u8|parsed\.json)[^\s"'<>]*/g);
          for (var match of m3u8Matches) {
            var streamPath = match[0];
            if (streamPath.indexOf(".m3u8") !== -1) {
              streams.push(makeStream(streamPath, "SinemaTV VV", "1080p", true, {
                "User-Agent": USER_AGENT,
                "Referer": iframeUrl
              }));
            }
          }
        }
      }
      return streams;
    }

    var res = await fetch(iframeUrl, {
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
      streams.push(makeStream(m3u8Match[1], "Fast Player [SinemaTV]", "1080p", true, {
        "User-Agent": USER_AGENT,
        "Referer": iframeUrl
      }));
    }

    var mp4Match = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    if (mp4Match && mp4Match[1]) {
      streams.push(makeStream(mp4Match[1], "MP4 [SinemaTV]", "1080p", false, {
        "User-Agent": USER_AGENT,
        "Referer": iframeUrl
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
      var searchItems = await searchSinemaTV(query, base);
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

      var targetPageUrl = bestMatch.url;
      var streams = [];

      try {
        var pageRes = await fetch(targetPageUrl, { headers: BASE_HEADERS });
        if (pageRes.ok) {
          var pageHtml = await pageRes.text();
          var $p = cheerio.load(pageHtml);

          var iframes = [];
          $p("iframe").each(function(i, el) {
            var src = $p(el).attr("data-src") || $p(el).attr("src");
            var title = ($p(el).attr("title") || "").toLowerCase();
            if (src && title.indexOf("trailer") === -1 && title.indexOf("трейлер") === -1) {
              if (iframes.indexOf(src) === -1) iframes.push(src);
            }
          });

          for (var ii = 0; ii < iframes.length; ii++) {
            var ifr = iframes[ii];
            if (ifr.startsWith("//")) ifr = "https:" + ifr;
            else if (ifr.startsWith("/")) ifr = base + ifr;

            var resolved = await resolveIframe(ifr, targetPageUrl);
            for (var r = 0; r < resolved.length; r++) {
              streams.push(resolved[r]);
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
