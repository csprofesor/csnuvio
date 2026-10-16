"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://filmkovasi.org";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

function abs(url, base) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  try { return new URL(url, base || BASE_URL).toString(); }
  catch (_) { return url; }
}

function getText(url, options) {
  options = options || {};
  var headers = Object.assign({}, HEADERS, options.headers || {});
  return fetch(url, {
    method: options.method || "GET",
    headers: headers,
    body: options.body,
    redirect: "follow"
  }).then(function(r) {
    if (!r.ok) throw new Error("HTTP " + r.status + " on " + url);
    return r.text();
  });
}

function sanitizeText(s) {
  return (s || "").replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, "").trim();
}

function normalize(s) {
  return (s || "").toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, "")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function distance(a, b) {
  a = normalize(a); b = normalize(b);
  var d = [];
  for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (var j = 0; j <= b.length; j++) d[0][j] = j;
  for (var x = 1; x <= a.length; x++) {
    for (var y = 1; y <= b.length; y++) {
      d[x][y] = Math.min(d[x - 1][y] + 1, d[x][y - 1] + 1, d[x - 1][y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function tmdbDetails(tmdbId, type) {
  var apiKey = "1c29a5198ee1854bd5eb45dbe8d17d92";
  var endpoint = type === "tv" || type === "series" ? "tv" : "movie";
  var mainUrl = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + apiKey + "&language=tr-TR";

  return fetch(mainUrl).then(function(r) { return r.json(); }).then(function(d) {
    return {
      title: sanitizeText(endpoint === "tv" ? d.name : d.title),
      originalTitle: sanitizeText(endpoint === "tv" ? d.original_name : d.original_title),
      year: ((endpoint === "tv" ? d.first_air_date : d.release_date) || "").slice(0, 4)
    };
  }).catch(function() { return null; });
}

function searchSite(title) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);
  var searchUrl = BASE_URL + "/?s=" + q;

  return getText(searchUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];
    var normTitle = normalize(cleanTitle);

    $("div.movie-box, article.card, div.film-kutusu").each(function(_, el) {
      var a = $(el).find("div.film-ismi a, h2 a, a").first();
      var href = abs(a.attr("href"));
      if (!href) return;

      var name = sanitizeText(a.text().replace(/\sizle$/i, "") || a.attr("title") || "");
      if (!name) return;

      var normName = normalize(name);
      var dist = distance(normName, normTitle);

      if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
        candidates.push({ href: href, name: name, score: dist });
      }
    });

    candidates.sort(function(a, b) { return a.score - b.score; });
    return candidates.length ? candidates[0].href : null;
  }).catch(function() { return null; });
}

function resolvePlayerScript(iframeUrl) {
  return getText(iframeUrl, { headers: { Referer: iframeUrl } }).then(function(html) {
    var urls = [];
    var ianaLink = iframeUrl.split("/watch/")[0];

    try {
      var vidMatch = html.match(/var\s+video\s*=\s*(\{.*?\});/);
      var srcMatch = html.match(/sources:\s*\[(\{.*?\})\]/);

      if (vidMatch && srcMatch) {
        var video = JSON.parse(vidMatch[1]);
        var fileObj = JSON.parse(srcMatch[1].replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":'));
        if (fileObj && fileObj.file) {
          var finalUrl = ianaLink + fileObj.file
            .replace("${video.uid}", video.uid || "")
            .replace("${video.md5}", video.md5 || "")
            .replace("${video.id}", video.id || "")
            .replace("${video.status}", video.status || "");
          urls.push(finalUrl);
        }
      }
    } catch (_) {}

    var m3u8Matches = html.match(/https?:\/\/[^"'`\s\\]+\.m3u8[^\s"'`\\]*/gi);
    if (m3u8Matches) {
      m3u8Matches.forEach(function(u) {
        var clean = u.replace(/\\\//g, "/");
        if (urls.indexOf(clean) === -1) urls.push(clean);
      });
    }

    var mp4Matches = html.match(/https?:\/\/[^"'`\s\\]+\.mp4[^\s"'`\\]*/gi);
    if (mp4Matches) {
      mp4Matches.forEach(function(u) {
        var clean = u.replace(/\\\//g, "/");
        if (urls.indexOf(clean) === -1) urls.push(clean);
      });
    }

    return urls;
  }).catch(function() { return []; });
}

function resolveFilmKovasi(movieUrl) {
  return getText(movieUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var iframes = [];

    var mainIframe = abs($("iframe").first().attr("src"), movieUrl);
    if (mainIframe) iframes.push(mainIframe);

    var sourceLinks = [];
    $("div.sources a").each(function(_, el) {
      var href = abs($(el).attr("href"), movieUrl);
      if (href && sourceLinks.indexOf(href) === -1) sourceLinks.push(href);
    });

    var altPromises = sourceLinks.map(function(sUrl) {
      return getText(sUrl, { headers: { Referer: movieUrl } }).then(function(sHtml) {
        var s$ = cheerio.load(sHtml);
        var iffi = abs(s$("iframe").first().attr("src"), sUrl);
        return iffi;
      }).catch(function() { return null; });
    });

    return Promise.all(altPromises).then(function(extraIframes) {
      extraIframes.forEach(function(ifr) {
        if (ifr && iframes.indexOf(ifr) === -1) iframes.push(ifr);
      });

      var resolvePromises = iframes.map(function(ifr) {
        return resolvePlayerScript(ifr);
      });

      return Promise.all(resolvePromises).then(function(resultsArray) {
        var finalStreams = [];
        resultsArray.forEach(function(arr) {
          arr.forEach(function(u) {
            if (u && finalStreams.indexOf(u) === -1) finalStreams.push(u);
          });
        });
        return finalStreams;
      });
    });
  }).catch(function() { return []; });
}

function makeStream(url, title, index) {
  var lower = url.toLowerCase();
  var quality = "HD";
  var q = lower.match(/(?:2160|1440|1080|720|576|480|360)p/);
  if (q) quality = q[0];
  else if (lower.indexOf("4k") !== -1) quality = "4K";

  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "FilmKovasi",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "filmkovasi"
  };
}

function getStreams(tmdbId, mediaType) {
  if (mediaType === "tv" || mediaType === "series") return Promise.resolve([]);

  return tmdbDetails(tmdbId, mediaType).then(function(info) {
    if (!info || !info.title) return [];

    var searchNames = [info.title];
    if (info.originalTitle && info.originalTitle !== info.title) searchNames.push(info.originalTitle);

    function trySearch(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i]).then(function(url) {
        if (url) return url;
        return trySearch(i + 1);
      }).catch(function() { return trySearch(i + 1); });
    }

    return trySearch(0).then(function(movieUrl) {
      if (!movieUrl) return [];

      return resolveFilmKovasi(movieUrl).then(function(streamUrls) {
        var label = info.title + (info.year ? " (" + info.year + ")" : "");
        return streamUrls.map(function(u, idx) {
          return makeStream(u, label, idx);
        });
      });
    });
  }).catch(function() {
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
