"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://sinemacc.com";
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

function encodeFormData(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  var pairs = [];
  for (var k in data) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(data[k]));
    }
  }
  return pairs.join("&");
}

function postForm(url, data, referer) {
  var bodyStr = encodeFormData(data);
  var headers = Object.assign({}, HEADERS, {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": referer || (typeof BASE_URL !== "undefined" ? BASE_URL : "") + "/"
  });
  return fetch(url, {
    method: "POST",
    headers: headers,
    body: bodyStr
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

function decodeBase64(str) {
  try {
    return atob(str.trim());
  } catch (_) {
    return str;
  }
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

    $("div.film_kutusu, div.icerik, article, div.movie-box").each(function(_, el) {
      var a = $(el).find("a[href]").first();
      var href = abs(a.attr("href"));
      if (!href || href === BASE_URL || href === BASE_URL + "/") return;

      var name = sanitizeText($(el).find("span.title, h2, h3, .title").text() || a.attr("title") || a.text() || "");
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

function resolvePlayer(sourceUrl, label, referer) {
  if (!sourceUrl || sourceUrl.indexOf("youtube.com") !== -1 || sourceUrl.indexOf("fragman") !== -1) {
    return Promise.resolve([]);
  }

  if (sourceUrl.indexOf("player.filmizle.in") !== -1) {
    var cleanUrl = sourceUrl.split("?")[0];
    var parts = cleanUrl.split("/").filter(Boolean);
    var dataKey = parts.pop();
    var hostMatch = cleanUrl.match(/https?:\/\/([^\/]+)/);
    var host = hostMatch ? hostMatch[1] : "player.filmizle.in";

    var apiUrl = "https://" + host + "/player/index.php?data=" + dataKey + "&do=getVideo";

    return postForm(apiUrl, {}, referer || BASE_URL + "/").then(function(resText) {
      try {
        var data = JSON.parse(resText);
        var streamUrl = data.securedLink || data.videoSource;
        if (streamUrl) {
          return [{
            url: streamUrl,
            label: label || "HD",
            quality: "1080p"
          }];
        }
      } catch (_) {}
      return [];
    }).catch(function() { return []; });
  }

  return Promise.resolve([]);
}

function findSources(movieUrl) {
  return getText(movieUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var rawSources = [];

    $("div.player_part button[rel], button.part_button[rel], button.grup_button[rel]").each(function(_, button) {
      var rel = $(button).attr("rel");
      var label = $(button).text().trim();
      if (rel) {
        var dec = decodeBase64(rel);
        if (dec) rawSources.push({ url: dec, label: label });
      }
    });

    $("iframe#video_playeriframe, iframe[data-vsrc], iframe[src]").each(function(_, iframe) {
      var vsrc = $(iframe).attr("data-vsrc") || $(iframe).attr("src");
      if (vsrc) {
        var dec = decodeBase64(vsrc);
        if (dec) rawSources.push({ url: dec, label: "Player" });
      }
    });

    var resolvePromises = rawSources.map(function(item) {
      return resolvePlayer(item.url, item.label, movieUrl);
    });

    return Promise.all(resolvePromises).then(function(results) {
      var streams = [];
      results.forEach(function(arr) {
        arr.forEach(function(s) {
          if (s && s.url && !streams.some(function(x) { return x.url === s.url; })) {
            streams.push(s);
          }
        });
      });
      return streams;
    });
  }).catch(function() { return []; });
}

function makeStream(url, title, quality, label) {
  var lower = url.toLowerCase();
  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "SinemaCX",
    title: label || title,
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "sinemacx"
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

      return findSources(movieUrl).then(function(sourceList) {
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
