"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://kultfilmler.net";
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

function postForm(url, data, referer) {
  var params = new URLSearchParams();
  for (var k in data) {
    params.append(k, data[k]);
  }
  var headers = Object.assign({}, HEADERS, {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": referer || BASE_URL + "/"
  });
  return fetch(url, {
    method: "POST",
    headers: headers,
    body: params.toString()
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
  var apiKey = "1c29a5198ee1854bd5eb45dbe8d17d92";
  var endpoint = type === "tv" || type === "series" ? "tv" : "movie";
  var mainUrl = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + apiKey + "&language=tr-TR";

  return fetch(mainUrl).then(function(r) { return r.json(); }).then(function(d) {
    var info = {
      title: sanitizeText(endpoint === "tv" ? d.name : d.title),
      originalTitle: sanitizeText(endpoint === "tv" ? d.original_name : d.original_title),
      year: ((endpoint === "tv" ? d.first_air_date : d.release_date) || "").slice(0, 4)
    };

    if (endpoint === "tv" && seasonNum && episodeNum) {
      var epUrl = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + episodeNum + "?api_key=" + apiKey + "&language=tr-TR";
      return fetch(epUrl).then(function(er) { return er.json(); }).then(function(epData) {
        info.episodeTitle = sanitizeText(epData.name || "");
        return info;
      }).catch(function() { return info; });
    }

    return info;
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

    $("a.mcard, article.mcard, div.mcard").each(function(_, el) {
      var a = $(el).is("a") ? $(el) : $(el).find("a").first();
      var href = abs(a.attr("href"));
      if (!href) return;

      var name = sanitizeText(a.find("div.mtx h3").text() || a.find("img.pimg").attr("alt") || a.attr("title") || "");
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

function findEpisodeUrl(seriesUrl, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var match = null;

    var p1 = new RegExp(seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var p2 = new RegExp("/sezon-" + seasonNum + "/bolum-" + episodeNum, "i");
    var pTxt = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");

    $("a[href*='bolum']").each(function(_, el) {
      if (match) return;
      var href = abs($(el).attr("href"), seriesUrl);
      var txt = sanitizeText($(el).text());
      if (p1.test(href) || p2.test(href) || pTxt.test(txt)) {
        match = href;
      }
    });

    return match || seriesUrl;
  }).catch(function() { return seriesUrl; });
}

function resolvePlayerHtml(iframeUrl, referer) {
  return getText(iframeUrl, { headers: { Referer: referer || BASE_URL + "/" } }).then(function(html) {
    var urls = [];

    var fileMatches = html.match(/file\s*:\s*["']([^"']+)["']/g);
    if (fileMatches) {
      fileMatches.forEach(function(m) {
        var uMatch = m.match(/file\s*:\s*["']([^"']+)["']/);
        if (uMatch) {
          var u = uMatch[1].replace(/\\\//g, "/");
          if (u.startsWith("//")) u = "https:" + u;
          if (urls.indexOf(u) === -1) urls.push(u);
        }
      });
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

function resolveKultFilmlerSources(pageUrl) {
  return getText(pageUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var iframes = [];

    function addIfr(u) {
      if (!u) return;
      var fixed = abs(u, pageUrl);
      if (fixed && fixed.indexOf("youtube.com") === -1 && fixed.indexOf("youtu.be") === -1) {
        if (iframes.indexOf(fixed) === -1) iframes.push(fixed);
      }
    }

    addIfr($("div#player iframe").first().attr("src"));
    addIfr($("div.kf-embed iframe").first().attr("src"));

    var srcJson = $("script#kf-srcdata").html();
    if (srcJson) {
      var matches = srcJson.match(/src=\\?"([^"\\]+)/g);
      if (matches) {
        matches.forEach(function(m) {
          var clean = m.replace(/^src=\\?"/, "").replace(/\\/g, "");
          addIfr(clean);
        });
      }
    }

    $("iframe").each(function(_, el) {
      addIfr($(el).attr("src") || $(el).attr("data-src"));
    });

    var resolvePromises = iframes.map(function(u) {
      return resolvePlayerHtml(u, pageUrl);
    });

    return Promise.all(resolvePromises).then(function(resultsArray) {
      var all = [];
      resultsArray.forEach(function(arr) {
        arr.forEach(function(u) {
          if (u && all.indexOf(u) === -1) all.push(u);
        });
      });
      return all;
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
    name: "KultFilmler",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "kultfilmler"
  };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return tmdbDetails(tmdbId, mediaType, seasonNum, episodeNum).then(function(info) {
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

    return trySearch(0).then(function(itemUrl) {
      if (!itemUrl) return [];

      var targetPromise = (mediaType === "tv" || mediaType === "series") && seasonNum && episodeNum
        ? findEpisodeUrl(itemUrl, seasonNum, episodeNum)
        : Promise.resolve(itemUrl);

      return targetPromise.then(function(pageUrl) {
        if (!pageUrl) pageUrl = itemUrl;

        return resolveKultFilmlerSources(pageUrl).then(function(streamUrls) {
          var label = info.title;
          if (info.episodeTitle) label += " - " + info.episodeTitle;
          else if (seasonNum && episodeNum) label += " S" + seasonNum + "E" + episodeNum;

          return streamUrls.map(function(u, idx) {
            return makeStream(u, label, idx);
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
