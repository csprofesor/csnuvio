"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.hintfilmizle.com";
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

    $("a[href*='/film/']").each(function(_, el) {
      var href = abs($(el).attr("href"));
      if (!href || href === BASE_URL || href === BASE_URL + "/" || href.indexOf("/tur/") !== -1 || href.indexOf("/yapim/") !== -1 || href.indexOf("/koleksiyon/") !== -1) return;

      var name = sanitizeText($(el).attr("title") || $(el).text() || $(el).find("img").attr("alt") || "");
      name = name.replace(/\s*(?:İzle|izle|HD)$/gi, "").trim();
      if (!name) return;

      var normName = normalize(name);
      var dist = distance(normName, normTitle);

      if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
        if (!candidates.some(function(c) { return c.href === href; })) {
          candidates.push({ href: href, name: name, score: dist });
        }
      }
    });

    candidates.sort(function(a, b) { return a.score - b.score; });
    return candidates.length ? candidates[0].href : null;
  }).catch(function() { return null; });
}

function findIframes(pageUrl) {
  return getText(pageUrl, { headers: { Referer: pageUrl } }).then(function(html) {
    var $ = cheerio.load(html);
    var links = [];

    function addLink(rawUrl) {
      if (!rawUrl || rawUrl === "about:blank") return;
      var u = abs(rawUrl, pageUrl);
      if (!u || u.indexOf("youtube.com") !== -1 || u.indexOf("youtu.be") !== -1) return;
      if (links.indexOf(u) === -1) links.push(u);
    }

    $("iframe").each(function(_, el) {
      addLink($(el).attr("data-litespeed-src") || $(el).attr("data-src") || $(el).attr("src") || $(el).attr("data-lazy-src"));
    });

    $("[data-video], [data-url], [data-src], [data-litespeed-src]").each(function(_, el) {
      addLink($(el).attr("data-litespeed-src") || $(el).attr("data-video") || $(el).attr("data-url") || $(el).attr("data-src"));
    });

    return links;
  }).catch(function() { return []; });
}

function decryptVidrameXor(arr, key) {
  var o = '', i = 0;
  for (; i < arr.length; i++) {
    o += String.fromCharCode(arr[i] ^ key.charCodeAt(i % key.length) ^ ((i * 17 + 13) & 255));
  }
  return o;
}

function resolveEmbed(embedUrl, referer) {
  if (!embedUrl) return Promise.resolve([]);

  return getText(embedUrl, { headers: { Referer: referer || BASE_URL + "/" } }).then(function(html) {
    var urls = [];

    var fileFnMatch = html.match(/file\s*:\s*\(function\(d,k\)\{[\s\S]*?\}\)\s*\(\s*(\[[^\]]+\])\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (fileFnMatch) {
      try {
        var arrData = JSON.parse(fileFnMatch[1]);
        var key = fileFnMatch[2];
        var decUrl = decryptVidrameXor(arrData, key);
        if (decUrl && decUrl.startsWith("http")) urls.push(decUrl);
      } catch (_) {}
    }

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

function makeStream(url, title, quality, label) {
  var lower = url.toLowerCase();
  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "HintFilmİzle",
    title: label || title,
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "hintfilmizle"
  };
}

function getStreams(tmdbId, mediaType) {
  if (mediaType === "tv" || mediaType === "series") {
    return Promise.resolve([]);
  }

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

      return findIframes(movieUrl).then(function(iframes) {
        var resolvePromises = iframes.map(function(iframe) {
          return resolveEmbed(iframe, movieUrl);
        });

        return Promise.all(resolvePromises).then(function(results) {
          var streamUrls = [];
          results.forEach(function(arr) {
            arr.forEach(function(u) {
              if (u && streamUrls.indexOf(u) === -1) streamUrls.push(u);
            });
          });

          var baseTitle = info.title + (info.year ? " (" + info.year + ")" : "");
          return streamUrls.map(function(u, idx) {
            return makeStream(u, baseTitle, "1080p", baseTitle + (idx > 0 ? " • Kaynak " + (idx + 1) : ""));
          });
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
