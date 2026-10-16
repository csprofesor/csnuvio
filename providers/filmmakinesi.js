"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://filmmakinesi.co";
var FALLBACK_URL = "https://filmmakinesi.to";
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

  function trySearchOn(domain) {
    var searchUrl = domain + "/?s=" + q;
    return getText(searchUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
      var $ = cheerio.load(html);
      var candidates = [];
      var normTitle = normalize(cleanTitle);

      $(".poster, article, div.movie-box, div.item").each(function(_, el) {
        var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
        var href = abs(a.attr("href"), domain);
        if (!href || href === domain || href === domain + "/" || href.indexOf("/category/") !== -1 || href.indexOf("/yil/") !== -1 || href.indexOf("/login/") !== -1 || href.indexOf("/film-robotu/") !== -1 || href.indexOf("/film-arsivi/") !== -1 || href.indexOf("/dizi-film-istek/") !== -1) return;

        if (href.startsWith(domain)) {
          var img = $(el).is("img") ? $(el) : $(el).find("img").first();
          var name = sanitizeText(img.attr("alt") || a.attr("title") || a.text() || "");
          if (!name) {
            var parts = href.split("/").filter(Boolean);
            name = (parts.pop() || "").replace(/-/g, " ");
          }
          name = name.split("\n")[0].trim();
          var normName = normalize(name);
          var dist = distance(normName, normTitle);

          if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
            if (!candidates.some(function(c) { return c.href === href; })) {
              candidates.push({ href: href, name: name, score: dist });
            }
          }
        }
      });

      candidates.sort(function(a, b) { return a.score - b.score; });
      return candidates.length ? candidates[0].href : null;
    });
  }

  return trySearchOn(BASE_URL).catch(function() {
    return trySearchOn(FALLBACK_URL).catch(function() { return null; });
  });
}

function findEpisodeUrl(seriesUrl, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var match = null;

    var p1 = new RegExp(seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var p2 = new RegExp("/sezon-" + seasonNum + "/bolum-" + episodeNum, "i");
    var pTxt = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");

    $("a[href*='bolum'], div.episodes a, .episode-list a").each(function(_, el) {
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

function findIframes(pageUrl) {
  return getText(pageUrl, { headers: { Referer: pageUrl } }).then(function(html) {
    var $ = cheerio.load(html);
    var links = [];

    function addLink(rawUrl) {
      if (!rawUrl) return;
      var u = abs(rawUrl, pageUrl);
      if (!u || u.indexOf("youtube.com") !== -1 || u.indexOf("youtu.be") !== -1) return;
      if (links.indexOf(u) === -1) links.push(u);
    }

    $("iframe").each(function(_, el) {
      addLink($(el).attr("data-src") || $(el).attr("src") || $(el).attr("data-lazy-src"));
    });

    $(".video-parts a[data-video_url], .parts a[data-src], .player-option[data-url], [data-video], [data-url], [data-src]").each(function(_, el) {
      addLink($(el).attr("data-video_url") || $(el).attr("data-src") || $(el).attr("data-url") || $(el).attr("data-video"));
    });

    return links;
  }).catch(function() { return []; });
}

function resolveOynatEmbed(embedUrl) {
  return getText(embedUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var eauthMatch = html.match(/window\.__ULTRA_EAUTH\s*=\s*"([^"]+)"/);
    var eauth = eauthMatch ? eauthMatch[1] : null;

    var parts = embedUrl.split("/embed/");
    if (!parts || parts.length < 2) return [];
    var embedId = parts[1].split("?")[0];
    if (!embedId || !eauth) return [];

    var origin = parts[0];
    var apiUrl = origin + "/api/video-qualities/" + embedId + "?eauth=" + encodeURIComponent(eauth);

    return getText(apiUrl, { headers: { Referer: embedUrl } }).then(function(jsonText) {
      var data = JSON.parse(jsonText);
      var urls = [];
      if (Array.isArray(data)) {
        data.forEach(function(item) {
          var u = item.hls_path || item.src;
          if (u && urls.indexOf(u) === -1) urls.push(u);
        });
      }
      return urls;
    }).catch(function() { return []; });
  }).catch(function() { return []; });
}

function resolveEmbed(embedUrl, referer) {
  if (!embedUrl) return Promise.resolve([]);

  if (embedUrl.indexOf("oynatloload") !== -1 || embedUrl.indexOf("verseneload") !== -1 || embedUrl.indexOf("/embed/") !== -1) {
    return resolveOynatEmbed(embedUrl);
  }

  return getText(embedUrl, { headers: { Referer: referer || BASE_URL + "/" } }).then(function(html) {
    var urls = [];

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

function makeStream(url, title, referer, index) {
  var lower = url.toLowerCase();
  var quality = "HD";
  var q = lower.match(/(?:2160|1440|1080|720|576|480|360)p/);
  if (q) quality = q[0];
  else if (lower.indexOf("4k") !== -1) quality = "4K";

  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "FilmMakinesi",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "filmmakinesi"
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
