"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://kultfilmler.net"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "KültFilmler";

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
    title: label || "KültFilmler",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "kultfilmler"
  };
}

async function searchKultFilmler(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/?s=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("a.mcard, article.card, a[href*='filmler']").each(function(_, el) {
        var href = $(el).attr("href");
        var title = $(el).find("div.mtx h3").text().trim() || $(el).find("img.pimg").attr("alt") || $(el).attr("title");
        if (href && title && href.indexOf(BASE_URL) !== -1) {
          results.push({
            title: sanitizeText(title),
            url: href,
            isMovie: href.indexOf("/dizi/") === -1
          });
        }
      });
    }
  } catch (e) {}
  return results;
}

async function resolveVidPapiPlayer(iframeUrl) {
  var streams = [];
  try {
    var videoId = iframeUrl.split("/").filter(Boolean).pop();
    var pRes = await fetch(iframeUrl, { headers: BASE_HEADERS });
    var cookie = pRes.headers.get("set-cookie") || "";

    var apiRes = await fetch("https://vidpapi.xyz/player/index.php?data=" + videoId + "&do=getVideo", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": iframeUrl,
        "Cookie": cookie
      },
      body: "data=" + videoId + "&do=getVideo"
    });

    if (apiRes.ok) {
      var apiData = await apiRes.json();
      var videoUrl = apiData.securedLink || apiData.videoSource;
      if (videoUrl) {
        streams.push(makeStream(videoUrl, "VidPapi Player", "1080p", videoUrl.indexOf(".m3u8") !== -1, {
          "User-Agent": USER_AGENT,
          "Referer": BASE_URL + "/"
        }));
      }
    }
  } catch (e) {}
  return streams;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
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
    var searchItems = await searchKultFilmler(query);
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
    try {
      var mRes = await fetch(targetUrl, { headers: BASE_HEADERS });
      if (mRes.ok) {
        var mHtml = await mRes.text();
        var $m = cheerio.load(mHtml);
        var iframes = [];

        $m("div#player iframe, div.kf-embed iframe, iframe").each(function(_, el) {
          var src = $m(el).attr("src") || $m(el).attr("data-src");
          if (src) {
            var full = src.startsWith("//") ? "https:" + src : (src.startsWith("http") ? src : BASE_URL + src);
            if (iframes.indexOf(full) === -1) iframes.push(full);
          }
        });

        var srcJson = $m("script#kf-srcdata").html();
        if (srcJson) {
          var matches = srcJson.match(/src=\\?"([^"\\]+)/g) || [];
          for (var mi = 0; mi < matches.length; mi++) {
            var u = matches[mi].replace(/src=\\?"/, "").replace(/\\/g, "");
            if (u.startsWith("//")) u = "https:" + u;
            if (u.startsWith("http") && iframes.indexOf(u) === -1) iframes.push(u);
          }
        }

        var streams = [];
        for (var ii = 0; ii < iframes.length; ii++) {
          var ifr = iframes[ii];
          if (ifr.indexOf("vidpapi") !== -1) {
            var pStreams = await resolveVidPapiPlayer(ifr);
            for (var psi = 0; psi < pStreams.length; psi++) {
              pStreams[psi].title = titleTr + " • Türkçe Dublaj / Altyazılı (1080p)" + (psi > 0 ? " #" + (psi + 1) : "");
              streams.push(pStreams[psi]);
            }
          } else if (ifr.indexOf(".m3u8") !== -1 || ifr.indexOf(".mp4") !== -1) {
            streams.push(makeStream(ifr, titleTr + " • Türkçe Dublaj / Altyazılı (1080p)", "1080p", ifr.indexOf(".m3u8") !== -1, {
              "User-Agent": USER_AGENT,
              "Referer": targetUrl
            }));
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
