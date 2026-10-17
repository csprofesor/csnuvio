"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.hdfilmizle.live";
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

function searchSite(title) {
  var cleanTitle = sanitizeText(title);

  return postForm(BASE_URL + "/search/", { query: cleanTitle }, BASE_URL + "/").then(function(resText) {
    try {
      var list = JSON.parse(resText);
      if (!Array.isArray(list) || !list.length) return null;

      var candidates = [];
      var normTitle = normalize(cleanTitle);

      list.forEach(function(item) {
        if (!item.slug) return;
        var href = BASE_URL + "/" + (item.type === "dizi" ? "dizi/" : "") + item.slug + "/";
        var name = item.name || "";
        var normName = normalize(name);
        var dist = distance(normName, normTitle);

        if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
          candidates.push({ href: href, name: name, score: dist });
        }
      });

      candidates.sort(function(a, b) { return a.score - b.score; });
      return candidates.length ? candidates[0].href : null;
    } catch (_) {
      return null;
    }
  }).catch(function() { return null; });
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

    $("[data-video], [data-url], [data-src]").each(function(_, el) {
      addLink($(el).attr("data-video") || $(el).attr("data-url") || $(el).attr("data-src"));
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

    // Vidrame XOR decoder
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

function makeStream(url, title, referer, index) {
  var lower = url.toLowerCase();
  var quality = "1080p";
  var q = lower.match(/(?:2160|1440|1080|720|576|480|360)p/);
  if (q) quality = q[0];
  else if (lower.indexOf("4k") !== -1) quality = "4K";

  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "FullHDFilm",
    title: title + " • Türkçe Dublaj (" + quality + ")" + (index > 0 ? " #" + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "fullhdfilm"
  };
}

function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
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
