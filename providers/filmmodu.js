"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.filmmodu.one";
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
  var searchUrl = BASE_URL + "/film-ara?term=" + q;

  return getText(searchUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];
    var normTitle = normalize(cleanTitle);

    $("div.movie").each(function(_, el) {
      var a = $(el).find("a").first();
      var href = abs(a.attr("href"));
      if (!href) return;

      var name = sanitizeText(a.text() || a.attr("title") || $(el).find(".title").text() || "");
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

function resolveFilmModuSources(pageUrl) {
  return getText(pageUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var candidatePages = [];

    var alts = $("div.alternates a");
    if (alts.length) {
      alts.each(function(_, el) {
        var altHref = abs($(el).attr("href"), pageUrl);
        var altName = sanitizeText($(el).text());
        if (altHref && altName) {
          if (!/fragman|trailer|teaser/i.test(altName)) {
            candidatePages.push({ name: altName, url: altHref });
          }
        }
      });
    }

    if (!candidatePages.length) {
      candidatePages.push({ name: "Ana Kaynak", url: pageUrl });
    }

    var videoIdRegex = /videoId\s*=\s*['"]([^'"]+)['"]/;
    var videoTypeRegex = /videoType\s*=\s*['"]([^'"]*)['"]/;

    var promises = candidatePages.map(function(item) {
      var fetchHtmlPromise = (item.url === pageUrl)
        ? Promise.resolve(html)
        : getText(item.url, { headers: { Referer: pageUrl } }).catch(function() { return ""; });

      return fetchHtmlPromise.then(function(pageHtml) {
        var vidIdMatch = pageHtml.match(videoIdRegex);
        var vidTypeMatch = pageHtml.match(videoTypeRegex);

        if (!vidIdMatch || !vidTypeMatch) return [];

        var vidId = vidIdMatch[1];
        var vidType = vidTypeMatch[1];
        if (!vidId || !vidType) return [];

        var getSourceUrl = BASE_URL + "/get-source?movie_id=" + encodeURIComponent(vidId) + "&type=" + encodeURIComponent(vidType);

        return getText(getSourceUrl, {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": item.url
          }
        }).then(function(resText) {
          try {
            var data = JSON.parse(resText);
            var results = [];
            if (data.sources && Array.isArray(data.sources)) {
              data.sources.forEach(function(srcObj) {
                if (srcObj && srcObj.src) {
                  results.push({
                    url: srcObj.src,
                    label: item.name + (srcObj.label ? " (" + srcObj.label + ")" : ""),
                    quality: srcObj.label || "HD"
                  });
                }
              });
            }
            return results;
          } catch (_) {
            return [];
          }
        }).catch(function() { return []; });
      });
    });

    return Promise.all(promises).then(function(resultsArray) {
      var all = [];
      resultsArray.forEach(function(arr) {
        arr.forEach(function(s) {
          if (s && s.url && !all.some(function(x) { return x.url === s.url; })) {
            all.push(s);
          }
        });
      });
      return all;
    });
  }).catch(function() { return []; });
}

function makeStream(url, title, quality, label) {
  var lower = url.toLowerCase();
  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "FilmModu",
    title: label || title,
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "filmmodu"
  };
}

function getStreams(tmdbId, mediaType) {
  if (mediaType === "tv" || mediaType === "series") {
    // FilmModu focuses strictly on movies
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

      return resolveFilmModuSources(movieUrl).then(function(sourceList) {
        var baseTitle = info.title + (info.year ? " (" + info.year + ")" : "");
        return sourceList.map(function(s) {
          return makeStream(s.url, baseTitle, s.quality, baseTitle + " • " + s.label);
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
