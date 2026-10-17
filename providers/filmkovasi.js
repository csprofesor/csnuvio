"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_DOMAINS = [
  "https://filmkovasi.co",
  "https://filmkovasi.org",
  "https://filmkovasi.net"
];
var BASE_URL = BASE_DOMAINS[0];

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

function tmdbDetails(tmdbId, type, seasonNum, episodeNum) {
  var idStr = String(tmdbId || "").trim();
  if (!/^\d+$/.test(idStr)) {
    return Promise.resolve({
      title: idStr,
      titleTr: idStr,
      titleEn: idStr,
      originalTitle: idStr,
      year: ""
    });
  }
  var apiKey = "1c29a5198ee1854bd5eb45dbe8d17d92";
  var endpoint = (type === "tv" || type === "series") ? "tv" : "movie";
  var trUrl = "https://api.themoviedb.org/3/" + endpoint + "/" + idStr + "?api_key=" + apiKey + "&language=tr-TR";
  var enUrl = "https://api.themoviedb.org/3/" + endpoint + "/" + idStr + "?api_key=" + apiKey + "&language=en-US";

  var pTr = fetch(trUrl).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  var pEn = fetch(enUrl).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

  return Promise.all([pTr, pEn]).then(function(res) {
    var dTr = res[0] || {};
    var dEn = res[1] || {};

    var titleTr = sanitizeText(endpoint === "tv" ? (dTr.name || dEn.name) : (dTr.title || dEn.title));
    var titleEn = sanitizeText(endpoint === "tv" ? (dEn.name || dTr.name) : (dEn.title || dTr.title));
    var origTitle = sanitizeText(endpoint === "tv" ? (dEn.original_name || dTr.original_name) : (dEn.original_title || dTr.original_title));
    var dateStr = (endpoint === "tv" ? (dEn.first_air_date || dTr.first_air_date) : (dEn.release_date || dTr.release_date)) || "";
    var yearStr = dateStr.slice(0, 4);

    return {
      title: titleTr || titleEn || origTitle,
      titleTr: titleTr || titleEn || origTitle,
      titleEn: titleEn || titleTr || origTitle,
      originalTitle: origTitle || titleTr || titleEn,
      year: yearStr
    };
  });
}

function searchSite(title, year) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);

  function tryDomain(idx) {
    if (idx >= BASE_DOMAINS.length) return Promise.resolve(null);
    var domain = BASE_DOMAINS[idx];
    var searchUrl = domain + "/?s=" + q;

    return getText(searchUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
      var $ = cheerio.load(html);
      var candidates = [];
      var normTitle = normalize(cleanTitle);

      $("div.movie-box, article.card, div.film-kutusu").each(function(_, el) {
        var a = $(el).find("div.film-ismi a, a[href]").first();
        var href = abs(a.attr("href"), domain);
        if (!href) return;

        var rawName = $(el).find("div.film-ismi a, h2 a, .title").text() || $(el).find("img").attr("alt") || a.attr("title") || "";
        var yearInName = (rawName.match(/\b(19\d\d|20\d\d)\b/) || [])[1];
        var name = rawName
          .replace(/\s*\(\s*\d{4}\s*\)/g, "")
          .replace(/\s*(?:İzle|izle|İZLE|Filmi izle|Film izle)$/gi, "")
          .trim();
        name = sanitizeText(name);
        if (!name) return;

        var normName = normalize(name);
        var dist = distance(normName, normTitle);

        if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
          var score = dist;
          if (year && yearInName && yearInName === year) {
            score -= 20;
          }
          candidates.push({ href: href, name: name, score: score, domain: domain });
        }
      });

      if (candidates.length) {
        candidates.sort(function(a, b) { return a.score - b.score; });
        return candidates[0];
      }

      return tryDomain(idx + 1);
    }).catch(function() {
      return tryDomain(idx + 1);
    });
  }

  return tryDomain(0);
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

function extractAtobIframes(rawHtml) {
  var urls = [];
  var regex = /atob\(["']([A-Za-z0-9+/=]+)["']\)/g;
  var m;
  while ((m = regex.exec(rawHtml)) !== null) {
    try {
      var decoded = atob(m[1]);
      var parsed = JSON.parse(decoded);
      if (Array.isArray(parsed)) {
        parsed.forEach(function(u) {
          if (u && urls.indexOf(u) === -1) urls.push(u.replace(/\\\//g, "/"));
        });
      } else if (typeof parsed === "string") {
        urls.push(parsed.replace(/\\\//g, "/"));
      }
    } catch (_) {}
  }
  return urls;
}

function resolveFilmKovasi(movieUrl, domain) {
  return getText(movieUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var iframes = extractAtobIframes(html);

    var mainIframe = abs($("iframe").first().attr("src"), movieUrl);
    if (mainIframe && mainIframe !== "about:blank" && iframes.indexOf(mainIframe) === -1) {
      iframes.push(mainIframe);
    }

    var sourceLinks = [];
    $("div.sources a").each(function(_, el) {
      var href = abs($(el).attr("href"), movieUrl);
      if (href && sourceLinks.indexOf(href) === -1) sourceLinks.push(href);
    });

    var altPromises = sourceLinks.map(function(sUrl) {
      return getText(sUrl, { headers: { Referer: movieUrl } }).then(function(sHtml) {
        var s$ = cheerio.load(sHtml);
        var extra = extractAtobIframes(sHtml);
        var iffi = abs(s$("iframe").first().attr("src"), sUrl);
        if (iffi && iffi !== "about:blank" && extra.indexOf(iffi) === -1) extra.push(iffi);
        return extra;
      }).catch(function() { return []; });
    });

    return Promise.all(altPromises).then(function(extraArrays) {
      extraArrays.forEach(function(arr) {
        arr.forEach(function(ifr) {
          if (ifr && iframes.indexOf(ifr) === -1) iframes.push(ifr);
        });
      });

      var resolvePromises = iframes.map(function(ifr) {
        return resolvePlayerScript(ifr).then(function(streams) {
          if (streams.length) return streams;
          if (ifr && ifr.startsWith("http")) {
            return [ifr];
          }
          return [];
        });
      });

      return Promise.all(resolvePromises).then(function(resultsArray) {
        var finalStreams = [];
        resultsArray.forEach(function(arr) {
          arr.forEach(function(u) {
            if (u && finalStreams.indexOf(u) === -1) finalStreams.push(u);
          });
        });
        if (!finalStreams.length && iframes.length) {
          finalStreams = iframes;
        }
        return finalStreams;
      });
    });
  }).catch(function() { return []; });
}

function makeStream(url, title, referer, index) {
  var lower = url.toLowerCase();
  var quality = "HD";
  var q = lower.match(/(?:2160|1440|1080|720|576|480|360)p/);
  if (q) quality = q[0];
  else if (lower.indexOf("4k") !== -1) quality = "4K";

  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "FilmKovası",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "filmkovasi"
  };
}

function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === "tv" || mediaType === "series") return Promise.resolve([]);

  return tmdbDetails(tmdbId, mediaType).then(function(info) {
    if (!info || !info.title) return [];

    var searchNames = [info.title];
    if (info.originalTitle && info.originalTitle !== info.title) searchNames.push(info.originalTitle);

    function tryName(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i], info.year).then(function(res) {
        if (res && res.href) return res;
        return tryName(i + 1);
      }).catch(function() { return tryName(i + 1); });
    }

    return tryName(0).then(function(searchResult) {
      if (!searchResult || !searchResult.href) return [];

      var domain = searchResult.domain || BASE_URL;
      return resolveFilmKovasi(searchResult.href, domain).then(function(streams) {
        var label = info.title + (info.year ? " (" + info.year + ")" : "");
        return streams.map(function(u, idx) {
          return makeStream(u, label, searchResult.href, idx);
        });
      });
    });
  }).catch(function() { return []; });
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
      setTimeout(function() { resolve([]); }, 2200);
    })
  ]);
}
