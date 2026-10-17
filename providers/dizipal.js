"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_DOMAINS = [
  "https://dizipal1820.com",
  "https://dizipal1821.com",
  "https://dizipal1819.com",
  "https://dizipal.cat",
  "https://dizipal.com"
];

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

function abs(url, base) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  try { return new URL(url, base || BASE_DOMAINS[0]).toString(); }
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

async function webCryptoDecrypt(rawJsonText) {
  var passphrase = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";

  var json = null;
  try { json = JSON.parse(rawJsonText); } catch (_) {}
  var ct = (json && json.ciphertext) ? json.ciphertext : null;
  var iv = (json && json.iv) ? json.iv : null;
  var salt = (json && json.salt) ? json.salt : null;

  if (!ct || !iv || !salt) {
    var ctMatch = rawJsonText.match(/"ciphertext"\s*:\s*"([^"]+)"/);
    var ivMatch = rawJsonText.match(/"iv"\s*:\s*"([^"]+)"/);
    var saltMatch = rawJsonText.match(/"salt"\s*:\s*"([^"]+)"/);
    if (!ctMatch || !ivMatch || !saltMatch) return null;
    ct = ctMatch[1].replace(/\\/g, "");
    iv = ivMatch[1];
    salt = saltMatch[1];
  }

  function hexToBuf(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  function b64ToBuf(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  try {
    var saltBuf = hexToBuf(salt);
    var ivBuf = hexToBuf(iv);
    var ctBuf = b64ToBuf(ct);

    var enc = new TextEncoder();
    var passKey = await globalThis.crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    var aesKey = await globalThis.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBuf, iterations: 999, hash: "SHA-512" },
      passKey,
      { name: "AES-CBC", length: 256 },
      false,
      ["decrypt"]
    );

    var decrypted = await globalThis.crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBuf }, aesKey, ctBuf);
    var decStr = new TextDecoder().decode(decrypted).replace(/\\\//g, '/');

    if (decStr.startsWith("://")) decStr = "https" + decStr;
    else if (decStr.startsWith("//")) decStr = "https:" + decStr;
    else if (!decStr.startsWith("http")) decStr = "https://" + decStr;

    return decStr;
  } catch (e) {
    return null;
  }
}

function searchSite(title, isMovie) {
  var cleanTitle = sanitizeText(title);

  function tryDomain(idx) {
    if (idx >= BASE_DOMAINS.length) return Promise.resolve(null);
    var domain = BASE_DOMAINS[idx];

    // First try obtaining cKey/cValue from main page
    return getText(domain + "/", { headers: { Referer: domain + "/" } }).then(function(mainHtml) {
      var $m = cheerio.load(mainHtml);
      var cKey = $m("input[name='cKey']").val() || "c61f91c5141d178450934fe81c0a2029";
      var cValue = $m("input[name='cValue']").val() || "MTc4NDQwNzIwMDhkMzJhNTc1YzUwOGU1ZjQwMjdjMjIyOWVjOGVhMTcwNGQyM2FjODM2YTI4YTU0NjUyMjI2ZmVjMzFkYzBkMWQyMWY4YzdiNA==";

      var searchUrl = domain + "/bg/searchcontent";
      var postData = {
        "cKey": cKey,
        "cValue": cValue,
        "type": "hepsi",
        "searchterm": cleanTitle
      };

      return postForm(searchUrl, postData, domain + "/").then(function(resText) {
        var candidates = [];
        var normTitle = normalize(cleanTitle);

        try {
          var json = JSON.parse(resText);
          var results = (json.data && json.data.result) || [];

          results.forEach(function(item) {
            var itemTitle = sanitizeText(item.object_name || item.trTitle || item.title || "");
            var slug = item.used_slug || item.slug || "";
            if (!itemTitle || !slug) return;

            var normName = normalize(itemTitle);
            var dist = distance(normName, normTitle);

            if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
              var href = slug.startsWith("http") ? slug : domain + "/" + slug.replace(/^\//, "");
              var itemType = (item.used_type || item.type || "").toLowerCase();
              var itemIsMovie = itemType === "movies" || itemType === "film" || href.indexOf("/film/") !== -1 || href.indexOf("/movies/") !== -1;

              if (isMovie && !itemIsMovie) return;
              if (!isMovie && itemIsMovie) return;

              candidates.push({ href: href, name: itemTitle, score: dist, domain: domain });
            }
          });
        } catch (_) {}

        if (candidates.length) {
          candidates.sort(function(a, b) { return a.score - b.score; });
          return candidates[0];
        }

        // Fallback: HTML search
        var searchPageUrl = domain + "/arama?q=" + encodeURIComponent(cleanTitle);
        return getText(searchPageUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
          var $ = cheerio.load(html);
          var htmlCandidates = [];

          var cardSelector = "li.content-card, article.content-card, article.dp-card, div.dp-card, div.movie-item, div.serie-item, div.content-item, a.top10-item, div.top10-item, a.trend-rank-card, a.m3-surface-2, .m3-surface-2, a[href*='/dizi/'], a[href*='/film/']";

          $(cardSelector).each(function(_, el) {
            var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
            var href = abs(a.attr("href"), domain);
            if (!href) return;

            var itemIsMovie = href.indexOf("/film/") !== -1 || href.indexOf("/movies/") !== -1;
            if (isMovie && !itemIsMovie) return;
            if (!isMovie && itemIsMovie) return;

            var titleFromEl = $(el).find(".card-title, .top10-title-text, h2, h3, h4, .title, .name, .content-title, .dp-title").text() || a.attr("title") || $(el).attr("title") || "";
            var rawTitle = sanitizeText(titleFromEl.replace(/\s+/g, " "));
            if (!rawTitle) return;

            var normName = normalize(rawTitle);
            var dist = distance(normName, normTitle);

            if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
              htmlCandidates.push({ href: href, name: rawTitle, score: dist, domain: domain });
            }
          });

          if (htmlCandidates.length) {
            htmlCandidates.sort(function(a, b) { return a.score - b.score; });
            return htmlCandidates[0];
          }

          return tryDomain(idx + 1);
        }).catch(function() {
          return tryDomain(idx + 1);
        });
      }).catch(function() {
        return tryDomain(idx + 1);
      });
    }).catch(function() {
      return tryDomain(idx + 1);
    });
  }

  return tryDomain(0);
}

function findEpisodeUrlOnSeriesPage(seriesUrl, domain, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
    var $ = cheerio.load(html);

    var epPatternUrl1 = new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var epPatternUrl2 = new RegExp("/" + seasonNum + "-sezon/" + episodeNum + "-bolum", "i");
    var epPatternUrl3 = new RegExp("/s" + seasonNum + "e" + episodeNum + "\\b", "i");
    var epPatternUrl4 = new RegExp("/sezon-" + seasonNum + "/bolum-" + episodeNum + "\\b", "i");
    var epPatternUrl5 = new RegExp("-" + episodeNum + "-bolum", "i");
    var epPatternTxt1 = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");
    var epPatternTxt2 = new RegExp("\\b" + seasonNum + "x" + episodeNum + "\\b", "i");
    var epPatternTxt3 = new RegExp("\\b" + episodeNum + "\\.?\\s*bölüm\\b", "i");

    var match = null;

    $("a[href*='-bolum'], a[href*='/bolum/'], a[href*='-episode'], a[href*='/episode/'], li.episode-item a, div.episode-card a, a.dp-detail-episode, .detail-episode-item-wrap a, a[href]").each(function(_, el) {
      if (match) return;
      var href = abs($(el).attr("href"), seriesUrl);
      if (!href) return;
      var txt = sanitizeText(($(el).text() || "").replace(/\s+/g, " "));

      if (epPatternUrl1.test(href) || epPatternUrl2.test(href) || epPatternUrl3.test(href) || epPatternUrl4.test(href) || epPatternTxt1.test(txt) || epPatternTxt2.test(txt)) {
        match = href;
      } else if (seasonNum === 1 && (epPatternUrl5.test(href) || epPatternTxt3.test(txt))) {
        match = href;
      }
    });

    return match || seriesUrl;
  }).catch(function() {
    return seriesUrl;
  });
}

function resolveDPlayer(iframeUrl, referer) {
  if (!iframeUrl) return Promise.resolve([]);

  var domainMatch = iframeUrl.match(/https?:\/\/[^\/]+/);
  var domain = domainMatch ? domainMatch[0] : "https://dplayer82.site";

  var headers = {
    "User-Agent": USER_AGENT,
    "Referer": referer || domain,
    "Origin": domain
  };

  if (iframeUrl.indexOf("source2.php") !== -1) {
    return getText(iframeUrl, { headers: headers }).then(function(resText) {
      var urls = [];
      var fileMatches = resText.match(/"file"\s*:\s*"([^"]+)"/g);
      if (fileMatches) {
        fileMatches.forEach(function(m) {
          var uMatch = m.match(/"file"\s*:\s*"([^"]+)"/);
          if (!uMatch) return;
          var u = uMatch[1].replace(/\\\//g, '/');
          if (u.startsWith("//")) u = "https:" + u;
          else if (!u.startsWith("http")) u = "https://" + u;
          if (u.indexOf("m.php") !== -1) u = u.replace("m.php", "master.m3u8");
          if (urls.indexOf(u) === -1) urls.push(u);
        });
      }
      return urls;
    }).catch(function() { return []; });
  }

  return getText(iframeUrl, { headers: headers }).then(function(html) {
    var match = html.match(/window\.openPlayer\s*\(\s*['"]([^'"]+)['"]/);
    var playlistId = match ? match[1] : null;

    if (!playlistId) {
      var idMatch = html.match(/source2\.php\?v=([a-zA-Z0-9_-]+)/);
      if (idMatch) playlistId = idMatch[1];
    }

    if (!playlistId) {
      var m3u8Matches = html.match(/https?:\/\/[^"'`\s]+\.m3u8[^\s"'`]*/gi);
      if (m3u8Matches && m3u8Matches.length) return [m3u8Matches[0]];
      return [];
    }

    var apiUrl = domain + "/source2.php?v=" + playlistId;
    return getText(apiUrl, { headers: { "User-Agent": USER_AGENT, "Referer": iframeUrl, "Origin": domain } }).then(function(resText) {
      var urls = [];
      var fileMatches = resText.match(/"file"\s*:\s*"([^"]+)"/g);
      if (fileMatches) {
        fileMatches.forEach(function(m) {
          var uMatch = m.match(/"file"\s*:\s*"([^"]+)"/);
          if (!uMatch) return;
          var u = uMatch[1].replace(/\\\//g, '/');
          if (u.startsWith("//")) u = "https:" + u;
          else if (!u.startsWith("http")) u = "https://" + u;
          if (u.indexOf("m.php") !== -1) u = u.replace("m.php", "master.m3u8");
          if (urls.indexOf(u) === -1) urls.push(u);
        });
      }
      return urls;
    }).catch(function() { return []; });
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
    name: "DiziPal",
    title: title + " • Türkçe Altyazılı / Dublaj (" + quality + ")" + (index > 0 ? " #" + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_DOMAINS[0] + "/",
      "User-Agent": USER_AGENT
    },
    provider: "dizipal"
  };
}

function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  var isMovie = mediaType === "movie" || mediaType === "film";

  if (!isMovie && (!seasonNum || !episodeNum)) {
    return Promise.resolve([]);
  }

  return tmdbDetails(tmdbId, mediaType, seasonNum, episodeNum).then(function(info) {
    if (!info || !info.title) return [];

    var searchNames = [info.title];
    if (info.originalTitle && info.originalTitle !== info.title) searchNames.push(info.originalTitle);

    function tryName(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i], isMovie).then(function(res) {
        if (res && res.href) return res;
        return tryName(i + 1);
      }).catch(function() { return tryName(i + 1); });
    }

    return tryName(0).then(function(searchResult) {
      if (!searchResult || !searchResult.href) return [];

      var domain = searchResult.domain || BASE_DOMAINS[0];
      var targetPromise = isMovie
        ? Promise.resolve(searchResult.href)
        : findEpisodeUrlOnSeriesPage(searchResult.href, domain, seasonNum, episodeNum);

      return targetPromise.then(function(pageUrl) {
        if (!pageUrl) pageUrl = searchResult.href;

        return getText(pageUrl, { headers: { Referer: domain + "/" } }).then(async function(html) {
          var $ = cheerio.load(html);
          var iframeUrls = [];

          // 1. PBKDF2 Encrypted player in div[data-rm-k=true]
          var encryptedDiv = $("div[data-rm-k=true]").first();
          var rawEncrypted = encryptedDiv.length ? encryptedDiv.text() : "";

          if (rawEncrypted) {
            var decryptedUrl = await webCryptoDecrypt(rawEncrypted);
            if (decryptedUrl) {
              if (decryptedUrl.indexOf(".m3u8") !== -1) {
                var label = info.title + (isMovie && info.year ? " (" + info.year + ")" : (seasonNum && episodeNum ? " S" + seasonNum + "E" + episodeNum : ""));
                return [makeStream(decryptedUrl, label, pageUrl, 0)];
              }
              iframeUrls.push(decryptedUrl);
            }
          }

          // 2. Legacy data-cfg or iframes
          $("iframe").each(function(_, el) {
            var src = $(el).attr("data-src") || $(el).attr("src");
            if (src && src.startsWith("//")) src = "https:" + src;
            if (src && src !== "about:blank" && iframeUrls.indexOf(src) === -1) {
              iframeUrls.push(src);
            }
          });

          if (!iframeUrls.length) return [];

          var resolvePromises = iframeUrls.map(function(iframe) {
            return resolveDPlayer(iframe, pageUrl);
          });

          return Promise.all(resolvePromises).then(function(results) {
            var streamUrls = [];
            results.forEach(function(arr) {
              arr.forEach(function(u) {
                if (u && streamUrls.indexOf(u) === -1) streamUrls.push(u);
              });
            });

            if (!streamUrls.length && iframeUrls.length) {
              streamUrls = iframeUrls;
            }

            var label = info.title;
            if (!isMovie) {
              if (info.episodeTitle) label += " - " + info.episodeTitle;
              else if (seasonNum && episodeNum) label += " S" + seasonNum + "E" + episodeNum;
            } else if (info.year) {
              label += " (" + info.year + ")";
            }

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
