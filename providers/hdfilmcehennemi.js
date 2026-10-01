"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.hdfilmcehennemi.nl";
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
  });
}

function normalize(s) {
  return (s || "").toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F]/g, "")
    .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
    .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[^a-z0-9]+/g," ").trim();
}

function distance(a, b) {
  a = normalize(a); b = normalize(b);
  var d = [];
  for (var i=0;i<=a.length;i++) { d[i]=[i]; }
  for (var j=0;j<=b.length;j++) d[0][j]=j;
  for (var x=1;x<=a.length;x++) {
    for (var y=1;y<=b.length;y++) {
      d[x][y]=Math.min(d[x-1][y]+1,d[x][y-1]+1,d[x-1][y-1]+(a[x-1]===b[y-1]?0:1));
    }
  }
  return d[a.length][b.length];
}

function searchSite(title) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);

  var searchApiUrl = BASE_URL + "/search?q=" + q;

  return getText(searchApiUrl, {
    headers: {
      "X-Requested-With": "fetch",
      "Content-Type": "application/json"
    }
  }).then(function(resText) {
    try {
      var json = JSON.parse(resText);
      var results = json.results || [];
      var candidates = [];

      var normTitle = normalize(cleanTitle);

      results.forEach(function(itemHtml) {
        var $ = cheerio.load(itemHtml);
        var a = $("a").first();
        var href = abs(a.attr("href"));
        if (!href) return;

        var name = sanitizeText($("h4, h2, strong, .title").text() || a.attr("title") || "");
        if (!name) return;

        var normName = normalize(name);
        var dist = distance(normName, normTitle);

        if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
          candidates.push({ href: href, name: name, score: dist });
        }
      });

      candidates.sort(function(a, b) { return a.score - b.score; });
      if (candidates.length) return candidates[0].href;
    } catch (_) {}

    return getText(BASE_URL + "/arama/?s=" + q).then(function(html) {
      var $ = cheerio.load(html);
      var candidates = [];
      var normTitle = normalize(cleanTitle);

      $("a.poster, a.card, div.poster, div.card, article, div.movie-box").each(function(_, el) {
        var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
        var href = abs(a.attr("href"));
        if (!href) return;

        var name = sanitizeText($(el).find("h2.title, h3.title, .title, strong").text() || a.attr("title") || $(el).attr("data-title") || "");
        if (!name) return;

        var normName = normalize(name);
        var dist = distance(normName, normTitle);

        if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
          candidates.push({ href: href, name: name, score: dist });
        }
      });

      candidates.sort(function(a, b) { return a.score - b.score; });
      return candidates.length ? candidates[0].href : null;
    });
  }).catch(function() { return null; });
}

function findEpisodeUrlOnSeriesPage(seriesUrl, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);

    var epPatternUrl1 = new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var epPatternUrl2 = new RegExp("/sezon-" + seasonNum + "/bolum-" + episodeNum + "\\b", "i");
    var epPatternTxt1 = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");
    var epPatternTxt2 = new RegExp("\\b" + seasonNum + "x" + episodeNum + "\\b", "i");

    var match = null;

    $("a[href]").each(function(_, el) {
      if (match) return;
      var href = abs($(el).attr("href"), seriesUrl);
      if (!href) return;
      var txt = sanitizeText(($(el).text() || "").replace(/\s+/g, " "));

      if (epPatternUrl1.test(href) || epPatternUrl2.test(href) || epPatternTxt1.test(txt) || epPatternTxt2.test(txt)) {
        match = href;
      }
    });

    return match;
  });
}

function findIframes(pageUrl) {
  return getText(pageUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var links = [];

    function addLink(rawUrl) {
      if (!rawUrl) return;
      var u = abs(rawUrl, pageUrl);
      if (!u) return;
      if (u.match(/\.(webp|jpg|png|jpeg|svg)(\?|$)/i)) return;
      if (u.indexOf("youtube.com") !== -1 || u.indexOf("youtu.be") !== -1) return;
      if (links.indexOf(u) === -1) links.push(u);
    }

    $("iframe").each(function(_, el) {
      addLink($(el).attr("data-src") || $(el).attr("src") || $(el).attr("data-lazy-src"));
    });

    $("[data-video], [data-url], [data-src], [data-embed], [data-player], [data-file]").each(function(_, el) {
      addLink($(el).attr("data-video") || $(el).attr("data-url") || $(el).attr("data-src") || $(el).attr("data-embed"));
    });

    $("a.card-nav-link, button.card-nav-link, .card-video a, nav.card-nav a, a[href*='/video/embed/'], a[href*='rapidrame'], a[href*='hdfilmcehennemi'], a[href*='playmix'], a[href*='closeload']").each(function(_, el) {
      addLink($(el).attr("href") || $(el).attr("data-video") || $(el).attr("data-url"));
    });

    var matches = html.match(/https?:\/\/[^\s'"\\]+?\/(?:video\/embed|embed|v|player)[^\s'"\\]*/gi);
    if (matches) {
      matches.forEach(function(m) { addLink(m); });
    }

    return links;
  });
}

function resolveEmbed(embedUrl, referer) {
  referer = referer || BASE_URL + "/";
  if (!embedUrl) return Promise.resolve([]);

  var originMatch = embedUrl.match(/https?:\/\/[^\/]+/);
  var origin = originMatch ? originMatch[0] : BASE_URL;

  return getText(embedUrl, { headers: { Referer: referer } }).then(function(html) {
    var hashMatch = html.match(/"hash"\s*:\s*"([a-zA-Z0-9]{32})"/i) || html.match(/hash\s*:\s*['"]([a-zA-Z0-9]{32})['"]/i);
    var hash = hashMatch ? hashMatch[1] : null;

    if (hash) {
      var postUrl = origin + "/video/ah/";
      return postForm(postUrl, { hash: hash }, embedUrl).then(function(resText) {
        var urls = [];
        var jsonMatches = resText.match(/"(?:file|url|hls|source|securedLink)"\s*:\s*"([^"]+)"/g);
        if (jsonMatches) {
          jsonMatches.forEach(function(m) {
            var uMatch = m.match(/"(?:file|url|hls|source|securedLink)"\s*:\s*"([^"]+)"/);
            if (uMatch) {
              var u = uMatch[1].replace(/\\\//g, '/');
              if (urls.indexOf(u) === -1) urls.push(u);
            }
          });
        }
        if (!urls.length) {
          var m3u8Matches = resText.match(/https?:\/\/[^"'`\s]+\.m3u8[^\s"'`]*/gi);
          if (m3u8Matches) urls = m3u8Matches;
        }
        return urls;
      }).catch(function() { return []; });
    }

    var m3u8Matches = html.match(/https?:\/\/[^"'`\s]+\.m3u8[^\s"'`]*/gi);
    if (m3u8Matches && m3u8Matches.length) return [m3u8Matches[0]];

    var mp4Matches = html.match(/https?:\/\/[^"'`\s]+\.mp4[^\s"'`]*/gi);
    if (mp4Matches && mp4Matches.length) return [mp4Matches[0]];

    return [];
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
    name: "HDFilmCehennemi",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "hdfilmcehennemi"
  };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return tmdbDetails(tmdbId, mediaType, seasonNum, episodeNum).then(function(info) {
    if (!info || !info.title) return [];

    var searchNames = [info.title];
    if (info.originalTitle && info.originalTitle !== info.title) searchNames.push(info.originalTitle);

    function tryName(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i]).then(function(url) {
        if (url) return url;
        return tryName(i + 1);
      }).catch(function() { return tryName(i + 1); });
    }

    return tryName(0).then(function(itemUrl) {
      if (!itemUrl) return [];

      var targetPromise = (mediaType === "tv" || mediaType === "series") && seasonNum && episodeNum
        ? findEpisodeUrlOnSeriesPage(itemUrl, seasonNum, episodeNum)
        : Promise.resolve(itemUrl);

      return targetPromise.then(function(pageUrl) {
        if (!pageUrl) pageUrl = itemUrl;

        return findIframes(pageUrl).then(function(iframes) {
          var resolvePromises = iframes.map(function(iframe) {
            return resolveEmbed(iframe, pageUrl);
          });

          return Promise.all(resolvePromises).then(function(results) {
            var streamUrls = [];
            results.forEach(function(arr) {
              arr.forEach(function(u) {
                if (u && streamUrls.indexOf(u) === -1) streamUrls.push(u);
              });
            });

            var label = info.title;
            if (info.episodeTitle) label += " - " + info.episodeTitle;
            else if (seasonNum && episodeNum) label += " S" + seasonNum + "E" + episodeNum;

            return streamUrls.map(function(u, idx) {
              return makeStream(u, label, pageUrl, idx);
            });
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
