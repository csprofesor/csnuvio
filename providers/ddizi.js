var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://www.ddizi.tel",
  "https://www.ddizi.pro",
  "https://www.ddizi.pw"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "DDizi";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Ch-Ua": "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": "\"Windows\"",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1"
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
    var trUrl = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=tr-TR";
    var enUrl = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=en-US";

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
    title: label || "DDizi",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "ddizi"
  };
}

async function searchDDizi(query, base) {
  var results = [];
  try {
    var res = await fetch(base + "/arama/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        "Referer": base + "/"
      },
      body: "arama=" + encodeURIComponent(query)
    });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("a[href*='/diziler/']").each(function(i, el) {
        var href = $(el).attr("href");
        var title = $(el).text().trim() || $(el).attr("title") || "";
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
  if (mediaType === "movie") return [];

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
      var searchItems = await searchDDizi(query, base);
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

      var epUrl = bestMatch.url;
      try {
        var seriesRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
        if (seriesRes.ok) {
          var sHtml = await seriesRes.text();
          var $s = cheerio.load(sHtml);
          var epCandidate = null;
          $s("div.dizi-boxpost a, div.dizi-boxpost-cat a, table a, li a").each(function(idx, el) {
            var t = $s(el).text();
            var h = $s(el).attr("href");
            if (!h) return;
            var sM = t.match(/(\d+)\.\s*Sezon/i) || h.match(/(\d+)-sezon/i);
            var eM = t.match(/(\d+)\.\s*Bölüm/i) || h.match(/(\d+)-bolum/i);
            if (sM && eM) {
              if (parseInt(sM[1], 10) === sNum && parseInt(eM[1], 10) === eNum) {
                epCandidate = h.startsWith("http") ? h : base + (h.startsWith("/") ? "" : "/") + h;
              }
            } else if (eM && sNum === 1 && parseInt(eM[1], 10) === eNum) {
              epCandidate = h.startsWith("http") ? h : base + (h.startsWith("/") ? "" : "/") + h;
            }
          });
          if (epCandidate) epUrl = epCandidate;
        }
      } catch (e) {}

      var streams = [];
      try {
        var epRes = await fetch(epUrl, { headers: BASE_HEADERS });
        if (epRes.ok) {
          var epHtml = await epRes.text();
          var $ep = cheerio.load(epHtml);

          var playerUrls = [];
          var ogVideo = $ep("meta[property='og:video']").attr("content");
          if (ogVideo) playerUrls.push(ogVideo);

          $ep("iframe[src]").each(function(idx, el) {
            var s = $ep(el).attr("src");
            if (s && playerUrls.indexOf(s) === -1) playerUrls.push(s);
          });

          for (var pi = 0; pi < playerUrls.length; pi++) {
            var pUrl = playerUrls[pi];
            if (pUrl.startsWith("//")) pUrl = "https:" + pUrl;
            else if (pUrl.startsWith("/")) pUrl = base + pUrl;

            try {
              var pRes = await fetch(pUrl, {
                headers: {
                  "User-Agent": USER_AGENT,
                  "Referer": epUrl
                }
              });
              if (pRes.ok) {
                var pHtml = await pRes.text();
                var sourcesM = pHtml.match(/sources:\s*\[([\s\S]*?)\]/);
                if (sourcesM) {
                  var blockRegex = /\{([\s\S]*?)\}/g;
                  var match;
                  while ((match = blockRegex.exec(sourcesM[1])) !== null) {
                    var blk = match[1];
                    var fileM = blk.match(/file:\s*["']([^"']+)["']/);
                    var labelM = blk.match(/label:\s*["']([^"']+)["']/);
                    var typeM = blk.match(/type:\s*["']([^"']+)["']/);

                    if (fileM && fileM[1]) {
                      var vidUrl = fileM[1].replace(/\\\//g, "/");
                      var label = labelM ? labelM[1] : "1080p";
                      var isHls = (typeM && (typeM[1] === "hls" || typeM[1] === "m3u8")) ||
                                  vidUrl.indexOf(".m3u8") !== -1 || vidUrl.indexOf("master.txt") !== -1;

                      streams.push(makeStream(vidUrl, "DDizi - " + label, label, isHls, {
                        "User-Agent": USER_AGENT,
                        "Referer": pUrl
                      }));
                    }
                  }
                }

                var directM = pHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
                if (directM && directM[1]) {
                  streams.push(makeStream(directM[1], "DDizi Direct", "1080p", directM[1].indexOf(".m3u8") !== -1, {
                    "User-Agent": USER_AGENT,
                    "Referer": pUrl
                  }));
                }
              }
            } catch (errP) {}
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
