"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://www.setfilmizle.ltd"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "SetFilmİzle";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

function calcXSp(sp, spT, offsetSec) {
  var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  var num = Math.floor(Math.random() * 2176782336);
  var r = "";
  while (num > 0) {
    r = chars[num % 36] + r;
    num = Math.floor(num / 36);
  }
  if (!r) r = "0";

  var tNow = (spT || 0) + (offsetSec || 0);
  var s = (sp || "") + "|" + tNow + "|" + r;
  var t = 2166136261;
  for (var i = 0; i < s.length; i++) {
    t = t ^ s.charCodeAt(i);
    t = Math.imul(t, 16777619) >>> 0;
  }
  var hashHex = (t >>> 0).toString(16);
  return tNow + "." + r + "." + hashHex;
}

function decryptSpgXor(encText, encKey) {
  try {
    var r = Buffer.from(encText, "base64").toString("binary");
    var o = Buffer.from(encKey, "base64").toString("binary");
    var i = "";
    for (var c = 0; c < r.length; c++) {
      i += String.fromCharCode(r.charCodeAt(c) ^ o.charCodeAt(c % o.length));
    }
    return i.split("|");
  } catch (e) {
    return [];
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
    title: label || "SetFilmİzle",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": "https://fastplay.mom/"
    },
    provider: "setfilmizle"
  };
}

async function searchSetFilm(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/wp-admin/admin-ajax.php?action=stf_live_search&keyword=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var json = await res.json();
      var keys = Object.keys(json || {});
      for (var i = 0; i < keys.length; i++) {
        var item = json[keys[i]];
        if (item && item.title && item.url) {
          results.push({
            title: sanitizeText(item.title),
            url: item.url,
            isMovie: item.url.indexOf("/dizi/") === -1
          });
        }
      }
    }
  } catch (e) {}
  return results;
}

async function resolveSetPlayPlayer(embedUrl, referer) {
  var streams = [];
  try {
    var pRes = await fetch(embedUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/"
      }
    });
    if (!pRes.ok) return streams;
    var pHtml = await pRes.text();

    var cerceveMatch = pHtml.match(/SPG\.cerceve\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/) ||
                       pHtml.match(/cerceve\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/);

    var targetUrl = embedUrl;
    if (cerceveMatch) {
      var dec = decryptSpgXor(cerceveMatch[2], cerceveMatch[3]);
      if (dec && dec[0]) {
        targetUrl = dec[0];
      }
    }

    var fastRes = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://setplay.shop/"
      }
    });
    if (!fastRes.ok) return streams;
    var fastHtml = await fastRes.text();

    var spgMatch = fastHtml.match(/window\.SPG_A\s*=\s*(\{.*?\}|\{.*\});/s);
    var sp = "", spT = 0;
    if (spgMatch) {
      try {
        var spgObj = JSON.parse(spgMatch[1]);
        sp = spgObj.sp || "";
        spT = spgObj.spT || 0;
      } catch (errSpg) {}
    }

    var kopruMatch = fastHtml.match(/window\.STF_KOPRU\s*=\s*(\{.*?\}|\{.*\});/s);
    if (kopruMatch) {
      var srcMatch = kopruMatch[1].match(/src:\s*"([^"]+)"/);
      if (srcMatch) {
        var manifestPath = srcMatch[1];
        var manifestUrl = manifestPath.startsWith("http") ? manifestPath : "https://fastplay.mom" + manifestPath;
        var xSp = calcXSp(sp, spT, 0);

        streams.push(makeStream(manifestUrl, "SetPlay Master HLS", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": targetUrl,
          "X-Sp": xSp
        }));
        return streams;
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
    var searchItems = await searchSetFilm(query);
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
        var seriesRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
        if (seriesRes.ok) {
          var seriesHtml = await seriesRes.text();
          var $s = cheerio.load(seriesHtml);
          var epFound = null;

          $s("a[href*='/bolum/']").each(function(_, el) {
            var href = $s(el).attr("href");
            if (!href) return;
            var sM = href.match(/(\d+)-sezon/i);
            var eM = href.match(/(\d+)-bolum/i);
            if (sM && eM && parseInt(sM[1], 10) === sNum && parseInt(eM[1], 10) === eNum) {
              epFound = href;
            }
          });

          if (epFound) {
            targetUrl = epFound;
          }
        }
      } catch (e) {}
    }

    try {
      var mRes = await fetch(targetUrl, { headers: BASE_HEADERS });
      if (mRes.ok) {
        var mHtml = await mRes.text();
        var $m = cheerio.load(mHtml);

        var nonceMatch = mHtml.match(/video:\s*"([^"]+)"/);
        var nonce = nonceMatch ? nonceMatch[1] : $m("div#playex").attr("data-nonce");
        var postId = $m("div.fplayer").attr("data-post-id");

        if (postId) {
          var params = new URLSearchParams();
          params.append("action", "get_video_url");
          params.append("nonce", nonce || "");
          params.append("post_id", postId);
          params.append("player_name", "SetPlay");
          params.append("part_key", "");

          var pRes = await fetch(BASE_URL + "/wp-admin/admin-ajax.php", {
            method: "POST",
            headers: {
              "User-Agent": USER_AGENT,
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": targetUrl
            },
            body: params.toString()
          });

          if (pRes.ok) {
            var pData = await pRes.json();
            var embedUrl = pData?.data?.stream?.url || pData?.data?.url;
            if (embedUrl) {
              var resolvedStreams = await resolveSetPlayPlayer(embedUrl, targetUrl);
              if (resolvedStreams && resolvedStreams.length > 0) {
                for (var si = 0; si < resolvedStreams.length; si++) {
                  resolvedStreams[si].title = titleTr + " • Türkçe Dublaj / Altyazılı (1080p)" + (si > 0 ? " #" + (si + 1) : "");
                }
                return resolvedStreams;
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: hardCapGetStreams, getMainPage: getMainPage, getCatalog: getMainPage };
} else {
  global.getStreams = hardCapGetStreams;
global.getMainPage = getMainPage;
global.getCatalog = getMainPage;
}

function hardCapGetStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.race([
    _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum),
    new Promise(function(resolve) {
      setTimeout(function() { resolve([]); }, 2200);
    })
  ]);
}


async function getMainPage(page, category) {
  var p = page || 1;
  var url = BASE_URL + (p > 1 ? "/page/" + p + "/" : "/");
  try {
    var res = await fetch(url, { headers: BASE_HEADERS });
    if (!res.ok) return [];
    var html = await res.text();
    var $ = cheerio.load(html);
    var items = [];
    $("a.card-link, article.card").each(function(_, el) {
      var a = $(el).is("a") ? $(el) : $(el).find("a").first();
      var href = a.attr("href");
      var img = $(el).find("img").first();
      var title = $(el).find("h2, h3").text().trim() || img.attr("alt") || a.attr("title");
      var poster = img.attr("src") || img.attr("data-src");
      if (href && title && !items.some(function(i) { return i.url === href; })) {
        var clean = sanitizeText(title);
        if (clean && clean.length > 2) {
          items.push({
            title: clean,
            url: href.startsWith("http") ? href : BASE_URL + href,
            posterUrl: poster ? (poster.startsWith("//") ? "https:" + poster : (poster.startsWith("http") ? poster : BASE_URL + poster)) : null,
            type: href.indexOf("/dizi/") !== -1 ? "series" : "movie"
          });
        }
      }
    });
    return items;
  } catch (e) { return []; }
}

