
function base64ToBytes(b64) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  b64 = String(b64).replace(/=+$/, "");
  var bytes = [];
  for (var bc = 0, bs, buffer, idx = 0; buffer = b64.charAt(idx++);
    ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? bytes.push(255 & bs >> (-2 * bc & 6)) : 0
  ) {
    buffer = chars.indexOf(buffer);
  }
  return new Uint8Array(bytes);
}

function safeBufferFrom(str, enc) {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    try { return safeBufferFrom(str, enc); } catch (_) {}
  }
  if (enc === "utf8" || enc === "ascii") {
    var arr = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
    return arr;
  }
  return base64ToBytes(str);
}

function safeBufferAlloc(len) {
  if (typeof Buffer !== "undefined" && typeof Buffer.alloc === "function") {
    try { return safeBufferAlloc(len, 0); } catch (_) {}
  }
  return new Uint8Array(len);
}

"use strict";

var cheerio = require("cheerio-without-node-native");
var crypto = null; try { crypto = require("crypto"); } catch (_) { crypto = null; }

var DOMAINS = [
  "https://dizilla.now"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "Dizilla";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

function decryptDizillaResponse(base64Str) {
  try {
    var key = safeBufferFrom("9bYMCNQiWsXIYFWYAu7EkdsSbmGBTyUI", "utf8");
    var iv = safeBufferAlloc(16, 0);
    var decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    var decrypted = decipher.update(base64Str, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    return null;
  }
}

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
    title: label || "Dizilla",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "dizilla"
  };
}

async function searchDizilla(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/api/bg/searchContent?searchterm=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": BASE_URL + "/"
      }
    });

    if (res.ok) {
      var json = await res.json();
      if (json && json.response) {
        var decrypted = decryptDizillaResponse(json.response);
        if (decrypted) {
          var data = JSON.parse(decrypted);
          var list = data.result || [];
          for (var i = 0; i < list.length; i++) {
            var item = list[i];
            var title = item.object_name || item.title || item.original_title;
            if (title && item.used_slug) {
              results.push({
                title: sanitizeText(title),
                slug: item.used_slug
              });
            }
          }
        }
      }
    }
  } catch (e) {}
  return results;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var resTr = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=tr-TR").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=en-US").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

  var titleTr = resTr ? (resTr.title || resTr.name) : "";
  var titleEn = resEn ? (resEn.title || resEn.name) : "";
  var origTitle = (resEn && resEn.original_title) || (resEn && resEn.original_name) || "";

  var sNum = parseInt(seasonNum, 10) || 1;
  var eNum = parseInt(episodeNum, 10) || 1;

  var titlesToSearch = [titleTr, titleEn, origTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var t = 0; t < titlesToSearch.length; t++) {
    var query = titlesToSearch[t];
    var searchItems = await searchDizilla(query);
    if (!searchItems || searchItems.length === 0) continue;

    var bestMatch = null;
    var bestScore = 999;
    var normTr = normalizeTitle(titleTr);
    var normEn = normalizeTitle(titleEn);

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

    var seriesUrl = BASE_URL + (bestMatch.slug.startsWith("/") ? "" : "/") + bestMatch.slug;
    try {
      var seriesRes = await fetch(seriesUrl, { headers: BASE_HEADERS });
      if (seriesRes.ok) {
        var seriesHtml = await seriesRes.text();
        var $s = cheerio.load(seriesHtml);
        var script = $s("script#__NEXT_DATA__").html();

        var epSlug = null;
        if (script) {
          try {
            var sJson = JSON.parse(script);
            var secData = sJson.props?.pageProps?.secureData;
            if (secData) {
              var dec = decryptDizillaResponse(secData);
              if (dec) {
                var decObj = JSON.parse(dec);
                var rr = decObj.RelatedResults || decObj.content?.result?.RelatedResults;
                var seasons = rr?.getSerieSeasonAndEpisodes?.result || [];
                for (var si = 0; si < seasons.length; si++) {
                  var seasonObj = seasons[si];
                  if (seasonObj.season_no == sNum) {
                    var eps = seasonObj.episodes || [];
                    for (var ei = 0; ei < eps.length; ei++) {
                      var epObj = eps[ei];
                      if (epObj.episode_no == eNum) {
                        epSlug = epObj.used_slug;
                        break;
                      }
                    }
                  }
                }
              }
            }
          } catch (errDec) {}
        }

        if (!epSlug) {
          epSlug = bestMatch.slug + "/" + sNum + "-sezon-" + eNum + "-bolum";
        }

        var epUrl = BASE_URL + (epSlug.startsWith("/") ? "" : "/") + epSlug;
        var epRes = await fetch(epUrl, { headers: BASE_HEADERS });
        if (epRes.ok) {
          var epHtml = await epRes.text();
          var $ep = cheerio.load(epHtml);
          var epScript = $ep("script#__NEXT_DATA__").html();

          var streams = [];
          if (epScript) {
            try {
              var epJson = JSON.parse(epScript);
              var epSecData = epJson.props?.pageProps?.secureData;
              if (epSecData) {
                var epDec = decryptDizillaResponse(epSecData);
                if (epDec) {
                  var contentRegex = /"source_content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
                  var match;
                  while ((match = contentRegex.exec(epDec)) !== null) {
                    var rawHtml = match[1].replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\\\/g, "\\");
                    var $c = cheerio.load(rawHtml);
                    var iframe = $c("iframe").attr("src");
                    if (iframe) {
                      var fullIframe = iframe.startsWith("//") ? "https:" + iframe : (iframe.startsWith("http") ? iframe : BASE_URL + iframe);
                      streams.push(makeStream(fullIframe, "Dizilla Player", "1080p", fullIframe.indexOf(".m3u8") !== -1, {
                        "User-Agent": USER_AGENT,
                        "Referer": epUrl
                      }));
                    }
                  }
                }
              }
            } catch (errEp) {}
          }

          if (streams.length > 0) {
            for (var si = 0; si < streams.length; si++) {
              streams[si].title = titleTr + " • Türkçe Altyazılı / Dublaj (" + (streams[si].quality || "1080p") + ")" + (si > 0 ? " #" + (si + 1) : "");
            }
            return streams;
          }
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
