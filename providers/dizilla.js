var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://dizilla.now",
  "https://dizilla.club",
  "https://dizilla.vip"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "Dizilla";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";
var AES_KEY_STR = "9bYMCNQiWsXIYFWYAu7EkdsSbmGBTyUI";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
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

function b64ToBuf(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

async function decryptDizillaAES(encryptedB64) {
  if (!encryptedB64) return null;
  if (encryptedB64.startsWith("eyJ")) {
    try {
      return atob(encryptedB64);
    } catch (e) {}
  }
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      var enc = new TextEncoder();
      var keyBuf = enc.encode(AES_KEY_STR);
      var key = await globalThis.crypto.subtle.importKey("raw", keyBuf, { name: "AES-CBC" }, false, ["decrypt"]);
      var iv = new Uint8Array(16);
      var ctBuf = b64ToBuf(encryptedB64);
      var decrypted = await globalThis.crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, ctBuf);
      return new TextDecoder().decode(decrypted);
    }
  } catch (e) {}
  return null;
}

async function searchDizilla(query, base) {
  var results = [];
  try {
    var searchUrl = base + "/api/bg/searchContent?searchterm=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": base + "/"
      }
    });

    if (res.ok) {
      var json = await res.json();
      var enc = json.response;
      if (enc) {
        var dec = await decryptDizillaAES(enc);
        if (dec) {
          if (!dec.startsWith("{") && dec.indexOf('"result"') !== -1) {
            dec = dec.substring(dec.indexOf("{"));
          }
          var parsed = JSON.parse(dec);
          var items = parsed.result || [];
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var title = it.title || it.backupTitle || it.originalTitle;
            var slug = it.slug || it.used_slug;
            if (title && slug) {
              results.push({
                title: sanitizeText(title),
                url: slug.startsWith("http") ? slug : base + (slug.startsWith("/") ? "" : "/") + slug
              });
            }
          }
        }
      }
    }
  } catch (e) {}

  if (results.length === 0) {
    try {
      var htmlRes = await fetch(base + "/arsiv?q=" + encodeURIComponent(query), { headers: BASE_HEADERS });
      if (htmlRes.ok) {
        var html = await htmlRes.text();
        var $ = cheerio.load(html);
        $("a[href*='/dizi/'], a.poster").each(function(i, el) {
          var href = $(el).attr("href");
          var title = $(el).find("h2, h3, .title").text() || $(el).text();
          if (href && title) {
            results.push({
              title: sanitizeText(title),
              url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href
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
    if (m && m[1]) return m[1];
  } catch (e) {}
  return null;
}

async function extractStreamsFromIframe(iframeUrl, referer) {
  var streams = [];
  try {
    var cleanIfr = iframeUrl.replace(/sn\.dplayer\d*\.site/, "sn.hotlinger.com").replace(/(four\.|v\.)?pichive\.online/, "sn.hotlinger.com");
    if (cleanIfr.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(cleanIfr, referer);
      if (m3u8) {
        streams.push(makeStream(m3u8, "VidMoly [Dizilla]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": cleanIfr
        }));
      }
      return streams;
    }

    var res = await fetch(cleanIfr, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/"
      }
    });
    if (!res.ok) return streams;
    var html = await res.text();

    var m3u8Match = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
                    html.match(/src:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (m3u8Match && m3u8Match[1]) {
      streams.push(makeStream(m3u8Match[1], "Dizilla Fast", "1080p", true, {
        "User-Agent": USER_AGENT,
        "Referer": cleanIfr
      }));
    }

    var mp4Match = html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
    if (mp4Match && mp4Match[1]) {
      streams.push(makeStream(mp4Match[1], "Dizilla MP4", "1080p", false, {
        "User-Agent": USER_AGENT,
        "Referer": cleanIfr
      }));
    }
  } catch (e) {}
  return streams;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
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
      var searchItems = await searchDizilla(query, base);
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

      var epUrl = bestMatch.url.replace(/\/$/, "") + "/" + sNum + "-sezon-" + eNum + "-bolum";
      var streams = [];

      try {
        var epRes = await fetch(epUrl, { headers: BASE_HEADERS });
        if (!epRes.ok) {
          var seriesRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
          if (seriesRes.ok) {
            var sHtml = await seriesRes.text();
            var nextDataMatch = sHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (nextDataMatch) {
              try {
                var nd = JSON.parse(nextDataMatch[1]);
                var secData = nd.props && nd.props.pageProps && nd.props.pageProps.secureData;
                if (secData) {
                  var decSec = await decryptDizillaAES(secData);
                  if (decSec) {
                    var decObj = JSON.parse(decSec);
                    var seasons = (decObj.RelatedResults && decObj.RelatedResults.getSerieSeasonAndEpisodes && decObj.RelatedResults.getSerieSeasonAndEpisodes.result) || [];
                    for (var si = 0; si < seasons.length; si++) {
                      if (seasons[si].season_no == sNum) {
                        var eps = seasons[si].episodes || [];
                        for (var ei = 0; ei < eps.length; ei++) {
                          if (eps[ei].episode_no == eNum) {
                            var epSlug = eps[ei].used_slug || eps[ei].slug;
                            if (epSlug) {
                              epUrl = epSlug.startsWith("http") ? epSlug : base + (epSlug.startsWith("/") ? "" : "/") + epSlug;
                              epRes = await fetch(epUrl, { headers: BASE_HEADERS });
                              break;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              } catch (e) {}
            }
          }
        }

        if (epRes && epRes.ok) {
          var epHtml = await epRes.text();
          var iframes = [];

          var ndMatch = epHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
          if (ndMatch) {
            try {
              var ndEp = JSON.parse(ndMatch[1]);
              var secDataEp = ndEp.props && ndEp.props.pageProps && ndEp.props.pageProps.secureData;
              if (secDataEp) {
                var decEp = await decryptDizillaAES(secDataEp);
                if (decEp) {
                  var srcMatches = decEp.matchAll(/"source_content"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
                  for (var m of srcMatches) {
                    var rawHtml = m[1].replace(/\\"/g, '"').replace(/\\\//g, "/").replace(/\\\\/g, "\\");
                    var ifrM = rawHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                    if (ifrM && ifrM[1]) {
                      iframes.push(ifrM[1]);
                    }
                  }
                }
              }
            } catch (e) {}
          }

          var $ = cheerio.load(epHtml);
          $("iframe").each(function(i, el) {
            var src = $(el).attr("src");
            if (src && iframes.indexOf(src) === -1) {
              iframes.push(src);
            }
          });

          for (var k = 0; k < iframes.length; k++) {
            var ifr = iframes[k];
            if (ifr.startsWith("//")) ifr = "https:" + ifr;
            else if (ifr.startsWith("/")) ifr = base + ifr;

            var resolved = await extractStreamsFromIframe(ifr, epUrl);
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
