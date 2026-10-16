"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://dizikorea3.com"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "DiziKorea";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
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

function makeStream(url, label, quality, isHls, headers) {
  return {
    name: PROVIDER_NAME,
    title: label || "DiziKorea",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "dizikorea"
  };
}

async function searchDiziKorea(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/ara?q=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var json = await res.json();
      var items = json.items || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.title && it.url) {
          results.push({
            title: sanitizeText(it.title),
            url: it.url,
            isMovie: it.url.indexOf("/film/") !== -1
          });
        }
      }
    }
  } catch (e) {}
  return results;
}

async function resolveVidMoly(molyUrl) {
  try {
    var res = await fetch(molyUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL + "/"
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
    if (iframeUrl.indexOf("playerdkorea.xyz") !== -1 || iframeUrl.indexOf("/player/index.php") !== -1) {
      var pRes = await fetch(iframeUrl, { headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" } });
      if (pRes.ok) {
        var pHtml = await pRes.text();
        var allKeys = pHtml.match(/\b[a-f0-9]{32}\b/g) || [];
        for (var k = 0; k < allKeys.length; k++) {
          var key = allKeys[k];
          if (key === "00000000000000000000000000000000") continue;
          try {
            var params = new URLSearchParams();
            params.append("hash", key);
            params.append("r", BASE_URL + "/");

            var postRes = await fetch("https://playerdkorea.xyz/player/index.php?data=" + key + "&do=getVideo", {
              method: "POST",
              headers: {
                "User-Agent": USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://playerdkorea.xyz",
                "Referer": "https://playerdkorea.xyz/video/" + key
              },
              body: params.toString()
            });

            if (postRes.ok) {
              var text = await postRes.text();
              var postData = JSON.parse(text);
              var videoUrl = postData.securedLink || postData.videoSource;
              if (videoUrl) {
                streams.push(makeStream(videoUrl, "DiziKorea Player", "1080p", videoUrl.indexOf(".m3u8") !== -1, {
                  "User-Agent": USER_AGENT,
                  "Referer": "https://playerdkorea.xyz/"
                }));
                break;
              }
            }
          } catch (errK) {}
        }
      }
      if (streams.length > 0) return streams;
    }

    if (iframeUrl.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(iframeUrl, referer);
      if (m3u8) {
        streams.push(makeStream(m3u8, "VidMoly [DiziKorea]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": iframeUrl
        }));
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

    var m = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
            html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
    if (m && m[1]) {
      streams.push(makeStream(m[1], "DiziKorea Player", "1080p", true, {
        "User-Agent": USER_AGENT,
        "Referer": iframeUrl
      }));
    }
  } catch (e) {}
  return streams;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var resTr = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=tr-TR").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=en-US").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

  var titleTr = resTr ? (resTr.title || resTr.name) : "";
  var titleEn = resEn ? (resEn.title || resEn.name) : "";
  var origTitle = (resEn && resEn.original_title) || (resEn && resEn.original_name) || "";

  var isTv = mediaType === "tv" || mediaType === "series";
  var sNum = parseInt(seasonNum, 10) || 1;
  var eNum = parseInt(episodeNum, 10) || 1;

  var titlesToSearch = [titleTr, titleEn, origTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var t = 0; t < titlesToSearch.length; t++) {
    var query = titlesToSearch[t];
    var searchItems = await searchDiziKorea(query);
    if (!searchItems || searchItems.length === 0) continue;

    var bestMatch = null;
    var bestScore = 999;
    var normTr = normalizeTitle(titleTr);
    var normEn = normalizeTitle(titleEn);

    for (var i = 0; i < searchItems.length; i++) {
      var it = searchItems[i];
      if (isTv && it.isMovie) continue;
      if (!isTv && !it.isMovie) continue;
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

    var targetUrl = bestMatch.url;
    if (isTv) {
      try {
        var pageRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
        if (pageRes.ok) {
          var pHtml = await pageRes.text();
          var $p = cheerio.load(pHtml);
          var epCandidate = null;

          $p("div.episode-list a.episode-item, a.episode-item").each(function(_, el) {
            var href = $p(el).attr("href");
            if (!href) return;
            var sM = href.match(/sezon-(\d+)/i);
            var eM = href.match(/bolum-(\d+)/i);
            if (sM && eM && parseInt(sM[1], 10) === sNum && parseInt(eM[1], 10) === eNum) {
              epCandidate = href.startsWith("http") ? href : BASE_URL + (href.startsWith("/") ? "" : "/") + href;
            }
          });

          if (epCandidate) {
            targetUrl = epCandidate;
          } else {
            targetUrl = bestMatch.url.replace(/\/$/, "") + "/sezon-" + sNum + "/bolum-" + eNum;
          }
        }
      } catch (e) {}
    }

    try {
      var epRes = await fetch(targetUrl, { headers: BASE_HEADERS });
      if (epRes.ok) {
        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);
        var iframes = [];

        $ep("div.player-source iframe, iframe").each(function(_, el) {
          var src = $ep(el).attr("data-src") || $ep(el).attr("src");
          if (src) {
            var fullSrc = src.startsWith("http") ? src : (src.startsWith("//") ? "https:" + src : BASE_URL + src);
            if (iframes.indexOf(fullSrc) === -1) iframes.push(fullSrc);
          }
        });

        var streams = [];
        for (var ii = 0; ii < iframes.length; ii++) {
          var resS = await resolveIframe(iframes[ii], targetUrl);
          for (var si = 0; si < resS.length; si++) {
            streams.push(resS[si]);
          }
        }

        if (streams.length > 0) {
          return streams;
        }
      }
    } catch (e) {}
  }

  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
