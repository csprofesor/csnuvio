"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://jetfilmizle.now";
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

  return postForm(BASE_URL + "/arama?q=", { s: cleanTitle }, BASE_URL + "/").then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];
    var normTitle = normalize(cleanTitle);

    $("div.film-card, article.film-card, div.movie-card").each(function(_, el) {
      var a = $(el).find(".card-title a, h2 a, a").first();
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

function resolvePlayerIframe(iframeUrl, referer) {
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

function resolveJetFilmizle(movieUrl) {
  return getText(movieUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var filmId = $("input[name=film_id]").val() || $("button[data-film-id]").attr("data-film-id");

    var iframes = [];
    $("iframe").each(function(_, el) {
      var src = abs($(el).attr("src") || $(el).attr("data-src"), movieUrl);
      if (src && src.indexOf("youtube.com") === -1 && src.indexOf("youtu.be") === -1) {
        if (iframes.indexOf(src) === -1) iframes.push(src);
      }
    });

    if (!filmId) {
      var resolveDirect = iframes.map(function(u) { return resolvePlayerIframe(u, movieUrl); });
      return Promise.all(resolveDirect).then(function(arrs) {
        var flat = [];
        arrs.forEach(function(a) { a.forEach(function(u) { if (flat.indexOf(u) === -1) flat.push(u); }); });
        return flat;
      });
    }

    var playerTypes = ["dublaj", "altyazili"];
    var maxIndex = 3;
    var btnCount = $(".player-source-btn").length;
    if (btnCount > 0) maxIndex = Math.min(btnCount, 5);

    var postPromises = [];
    playerTypes.forEach(function(pType) {
      for (var i = 0; i <= maxIndex; i++) {
        (function(idx, pt) {
          postPromises.push(
            postForm(BASE_URL + "/jetplayer", {
              film_id: filmId,
              source_index: idx.toString(),
              player_type: pt
            }, movieUrl).then(function(resText) {
              var m = resText.match(/<iframe[^>]+src=["']([^"']+)["']/i);
              if (m && m[1]) {
                var ifr = abs(m[1], movieUrl);
                return ifr;
              }
              return null;
            }).catch(function() { return null; })
          );
        })(i, pType);
      }
    });

    return Promise.all(postPromises).then(function(jetIframes) {
      jetIframes.forEach(function(ifr) {
        if (ifr && iframes.indexOf(ifr) === -1) iframes.push(ifr);
      });

      var resolvePromises = iframes.map(function(ifr) {
        return resolvePlayerIframe(ifr, movieUrl);
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
    name: "JetFilmizle",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "jetfilmizle"
  };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === "tv" || mediaType === "series") return Promise.resolve([]);

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

    return trySearch(0).then(function(movieUrl) {
      if (!movieUrl) return [];

      return resolveJetFilmizle(movieUrl).then(function(streamUrls) {
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
