"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://movies2watch.watch",
  "https://movies2watch.tv"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "Watch2Movies";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
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

async function searchWatch2Movies(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/search?keyword=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("div.flw-item").each(function(i, el) {
        var a = $(el).find("h3 a, a.film-poster-ahref").first();
        var href = a.attr("href");
        var title = $(el).find("h3 a").text().trim() || a.attr("title");
        if (href && title) {
          results.push({
            title: sanitizeText(title),
            url: href.startsWith("http") ? href : BASE_URL + (href.startsWith("/") ? "" : "/") + href,
            isTv: href.indexOf("/tv/") !== -1 || href.indexOf("/series/") !== -1
          });
        }
      });
    }
  } catch (e) {}
  return results;
}

async function resolveServerEmbed(srvUrl, referer) {
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

    var m3u8Matches = html.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'>]*/gi) || [];
    for (var i = 0; i < m3u8Matches.length; i++) {
      var url = m3u8Matches[i];
      if (streams.indexOf(url) === -1) {
        streams.push(makeStream(url, "Watch2Movies HD", "1080p", url.indexOf(".m3u8") !== -1, {
          "User-Agent": USER_AGENT,
          "Referer": srvUrl
        }));
      }
    }
  } catch (e) {}
  return streams;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=en-US").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  if (!resEn) return [];

  var titleEn = resEn.title || resEn.name || resEn.original_title || "";
  var isTv = mediaType === "tv" || mediaType === "series";

  var searchItems = await searchWatch2Movies(titleEn);
  if (!searchItems || searchItems.length === 0) return [];

  var bestMatch = null;
  var bestScore = 999;
  var normEn = normalizeTitle(titleEn);

  for (var i = 0; i < searchItems.length; i++) {
    var it = searchItems[i];
    if (isTv && !it.isTv) continue;
    if (!isTv && it.isTv) continue;
    var itemNorm = normalizeTitle(it.title);
    var dist = levenshteinDistance(itemNorm, normEn);
    if (itemNorm.indexOf(normEn) !== -1 || normEn.indexOf(itemNorm) !== -1) {
      dist = Math.floor(dist / 2);
    }
    if (dist < bestScore) {
      bestScore = dist;
      bestMatch = it;
    }
  }

  if (!bestMatch || bestScore > 10) return [];

  var targetUrl = bestMatch.url;
  try {
    var pageRes = await fetch(targetUrl, { headers: BASE_HEADERS });
    if (pageRes.ok) {
      var pHtml = await pageRes.text();
      var plMatch = pHtml.match(/const\s+pl_url\s*=\s*['"]([^'"]+)['"]/);

      if (plMatch && plMatch[1]) {
        var plRes = await fetch(plMatch[1], {
          headers: {
            "User-Agent": USER_AGENT,
            "Referer": targetUrl,
            "X-Requested-With": "XMLHttpRequest"
          }
        });

        if (plRes.ok) {
          var plText = await plRes.text();
          var $p = cheerio.load(plText);

          var srvUrls = [];
          $p(".link-item, a[data-id], a[data-linkid]").each(function(_, el) {
            var dataId = $p(el).attr("data-id") || $p(el).attr("data-linkid");
            if (dataId && dataId.startsWith("http")) {
              if (srvUrls.indexOf(dataId) === -1) srvUrls.push(dataId);
            }
          });

          var streams = [];
          for (var si = 0; si < srvUrls.length; si++) {
            var sStreams = await resolveServerEmbed(srvUrls[si], targetUrl);
            for (var ssi = 0; ssi < sStreams.length; ssi++) {
              sStreams[ssi].title = titleEn + " • English (" + (sStreams[ssi].quality || "1080p") + ")" + (ssi > 0 ? " #" + (ssi + 1) : "");
              streams.push(sStreams[ssi]);
            }
          }

          if (streams.length > 0) {
            return streams;
          }
        }
      }
    }
  } catch (e) {}

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
  var url = BASE_URL + (p > 1 ? "/movie?page=" + p : "/movie");
  try {
    var res = await fetch(url, { headers: BASE_HEADERS });
    if (!res.ok) return [];
    var html = await res.text();
    var $ = cheerio.load(html);
    var items = [];
    $("div.flw-item a[href*='/movie/'], div.flw-item a[href*='/tv/']").each(function(_, el) {
      var href = $(el).attr("href");
      var img = $(el).find("img").first();
      var title = $(el).find("h3 a").text().trim() || img.attr("alt") || $(el).attr("title");
      var poster = img.attr("data-src") || img.attr("src");
      if (href && title && !items.some(function(i) { return i.url === href; })) {
        var clean = sanitizeText(title);
        if (clean && clean.length > 2) {
          items.push({
            title: clean,
            url: href.startsWith("http") ? href : BASE_URL + (href.startsWith("/") ? "" : "/") + href,
            posterUrl: poster ? (poster.startsWith("//") ? "https:" + poster : (poster.startsWith("http") ? poster : BASE_URL + poster)) : null,
            type: href.indexOf("/tv/") !== -1 ? "series" : "movie"
          });
        }
      }
    });
    return items;
  } catch (e) { return []; }
}

