var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://www.dizibox.live",
  "https://www.dizibox.de",
  "https://www.dizibox.tv"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "DiziBox";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cookie": "LockUser=true; isTrustedUser=true; dbxu=1744054959089"
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
    title: label || "DiziBox",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "dizibox"
  };
}

async function searchDiziBox(query, base) {
  var results = [];
  try {
    var ajaxUrl = base + "/wp-admin/admin-ajax.php?s=" + encodeURIComponent(query) + "&action=dwls_search";
    var res = await fetch(ajaxUrl, {
      headers: Object.assign({}, BASE_HEADERS, {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": base + "/?s=" + encodeURIComponent(query)
      })
    });
    if (res.ok) {
      var json = await res.json();
      if (json && json.results && Array.isArray(json.results)) {
        for (var i = 0; i < json.results.length; i++) {
          var item = json.results[i];
          if (item.permalink) {
            results.push({
              title: sanitizeText(item.post_title || ""),
              url: item.permalink
            });
          }
        }
      }
    }
  } catch (e) {}

  if (results.length === 0) {
    try {
      var htmlRes = await fetch(base + "/?s=" + encodeURIComponent(query), { headers: BASE_HEADERS });
      if (htmlRes.ok) {
        var html = await htmlRes.text();
        var $ = cheerio.load(html);
        $("article.detailed-article, article.article-episode-card, div.post-title a").each(function(i, el) {
          var a = $(el).is("a") ? $(el) : $(el).find("h3 a, div.post-title a, a").first();
          var href = a.attr("href");
          var title = a.attr("title") || a.text();
          if (href && title) {
            results.push({
              title: sanitizeText(title),
              url: href
            });
          }
        });
      }
    } catch (e) {}
  }
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
    if (m && m[1]) {
      return m[1];
    }
  } catch (e) {}
  return null;
}

async function extractVideoFromIframe(iframeUrl, referer) {
  var streams = [];
  try {
    if (iframeUrl.indexOf("moly.php") !== -1 || iframeUrl.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(iframeUrl, referer);
      if (m3u8) {
        streams.push(makeStream(m3u8, "VidMoly [DiziBox]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": iframeUrl
        }));
      }
      return streams;
    }

    var fetchUrl = iframeUrl;
    if (fetchUrl.indexOf("php?v=") !== -1) {
      fetchUrl = fetchUrl.replace("php?v=", "php?wmode=opaque&v=");
    }

    var res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/",
        "Cookie": "LockUser=true; isTrustedUser=true"
      }
    });
    if (!res.ok) return streams;
    var html = await res.text();

    var $ = cheerio.load(html);
    var subFrame = $("div#Player iframe, iframe").first().attr("src");
    if (subFrame) {
      if (subFrame.startsWith("//")) subFrame = "https:" + subFrame;
      if (subFrame.indexOf("vidmoly") !== -1 || subFrame.indexOf("molystream") !== -1) {
        var subM3u8 = await resolveVidMoly(subFrame, fetchUrl);
        if (subM3u8) {
          streams.push(makeStream(subM3u8, "VidMoly [DiziBox]", "1080p", true, {
            "User-Agent": USER_AGENT,
            "Referer": subFrame
          }));
        }
      }
    }

    var m3u8Match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) || html.match(/file:\s*["']([^"']+)["']/i);
    if (m3u8Match && m3u8Match[1] && m3u8Match[1].startsWith("http")) {
      streams.push(makeStream(m3u8Match[1], "DiziBox Player", "1080p", m3u8Match[1].indexOf(".m3u8") !== -1, {
        "User-Agent": USER_AGENT,
        "Referer": fetchUrl
      }));
    }
  } catch (e) {}
  return streams;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === "movie") {
    return [];
  }

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
      var searchItems = await searchDiziBox(query, base);
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

      var epUrl = bestMatch.url.replace(/\/$/, "") + "/" + sNum + "-sezon-" + eNum + "-bolum-izle/";
      var streams = [];

      try {
        var epRes = await fetch(epUrl, { headers: BASE_HEADERS });
        if (!epRes.ok) {
          var seriesRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
          if (seriesRes.ok) {
            var sHtml = await seriesRes.text();
            var $s = cheerio.load(sHtml);
            var seasonLink = null;
            $s("div#seasons-list a").each(function(idx, el) {
              var sText = $s(el).text();
              if (sText.indexOf(sNum + ". Sezon") !== -1 || sText.indexOf(sNum + " Sezon") !== -1) {
                seasonLink = $s(el).attr("href");
              }
            });
            if (seasonLink) {
              var seasonRes = await fetch(seasonLink, { headers: BASE_HEADERS });
              if (seasonRes.ok) {
                var seaHtml = await seasonRes.text();
                var $sea = cheerio.load(seaHtml);
                $sea("article.grid-box").each(function(idx, el) {
                  var epLink = $sea(el).find("div.post-title a.season-episode").first();
                  var t = epLink.text();
                  if (t.indexOf(eNum + ". Bölüm") !== -1 || t.indexOf(eNum + " Bölüm") !== -1) {
                    epUrl = epLink.attr("href");
                  }
                });
                epRes = await fetch(epUrl, { headers: BASE_HEADERS });
              }
            }
          }
        }

        if (epRes && epRes.ok) {
          var epHtml = await epRes.text();
          var $ep = cheerio.load(epHtml);

          var iframes = [];
          var mainIframe = $ep("div#video-area iframe").attr("src");
          if (mainIframe) iframes.push(mainIframe);

          $ep("div.video-toolbar option[value]").each(function(idx, el) {
            var val = $ep(el).attr("value");
            if (val && iframes.indexOf(val) === -1) {
              iframes.push(val);
            }
          });

          for (var ifrIdx = 0; ifrIdx < iframes.length; ifrIdx++) {
            var src = iframes[ifrIdx];
            if (src.startsWith("//")) src = "https:" + src;
            else if (src.startsWith("/")) src = base + src;

            var resolvedStreams = await extractVideoFromIframe(src, epUrl);
            for (var s = 0; s < resolvedStreams.length; s++) {
              streams.push(resolvedStreams[s]);
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
  module.exports = { getStreams: hardCapGetStreams };
} else {
  global.getStreams = hardCapGetStreams;
}

function hardCapGetStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.race([
    _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum),
    new Promise(function(resolve) {
      setTimeout(function() { resolve([]); }, 3500);
    })
  ]);
}
