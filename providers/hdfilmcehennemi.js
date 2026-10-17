"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_DOMAINS = [
  "https://hdfilmcehennemiv4.com",
  "https://www.hdfilmcehennemi.nl",
  "https://hdfilmcehennemi.ws"
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
  var apiKey = "1c29a5198ee1854bd5eb45dbe8d17d92";
  var endpoint = (type === "tv" || type === "series") ? "tv" : "movie";
  var trUrl = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + apiKey + "&language=tr-TR";
  var enUrl = "https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=" + apiKey + "&language=en-US";

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

  if (!ct || !iv || !salt) return null;

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
    if (decStr.startsWith("//")) decStr = "https:" + decStr;
    else if (!decStr.startsWith("http")) decStr = "https://" + decStr;
    return decStr;
  } catch (e) {
    return null;
  }
}

function searchSite(title, isMovie) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);

  function tryDomain(idx) {
    if (idx >= BASE_DOMAINS.length) return Promise.resolve(null);
    var domain = BASE_DOMAINS[idx];

    // Try V4 POST search first
    return getText(domain + "/", { headers: { Referer: domain + "/" } }).then(function(homeHtml) {
      var $h = cheerio.load(homeHtml);
      var cKey = $h("input[name='cKey']").val();
      var cValue = $h("input[name='cValue']").val();

      if (cKey && cValue) {
        return postForm(domain + "/bg/searchcontent", {
          cKey: cKey,
          cValue: cValue,
          type: "hepsi",
          searchterm: cleanTitle
        }, domain + "/").then(function(resText) {
          try {
            var json = JSON.parse(resText);
            var results = (json && json.data && json.data.result) ? json.data.result : [];
            var candidates = [];
            var normTitle = normalize(cleanTitle);

            results.forEach(function(item) {
              if (!item.used_slug) return;
              if (item.used_slug.indexOf("filmserisi/") !== -1 || item.used_slug.indexOf("kategori/") !== -1 || item.used_slug.indexOf("seri/") !== -1) return;
              var href = domain + "/" + item.used_slug;
              var name = item.object_name || item.object_alternative_name || "";
              var normName = normalize(name);
              var dist = distance(normName, normTitle);
              if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1) {
                dist = Math.floor(dist / 2);
              }
              if (dist > 5 && normName.split(" ").some(function(w) { return w.length > 2 && normTitle.indexOf(w) !== -1; })) {
                dist = 5;
              }
              candidates.push({ href: href, name: name, score: dist, domain: domain });
            });

            if (candidates.length) {
              candidates.sort(function(a, b) { return a.score - b.score; });
              return candidates[0];
            }
          } catch (_) {}
          return tryDomain(idx + 1);
        }).catch(function() { return tryDomain(idx + 1); });
      }

      // Classic API fallback
      return getText(domain + "/search?q=" + q, {
        headers: { "X-Requested-With": "fetch", "Content-Type": "application/json", "Referer": domain + "/" }
      }).then(function(resText) {
        var candidates = [];
        var normTitle = normalize(cleanTitle);
        try {
          var json = JSON.parse(resText);
          var results = json.results || [];
          results.forEach(function(itemHtml) {
            var $ = cheerio.load(itemHtml);
            var a = $("a.search-result, a.poster, a").first();
            var href = abs(a.attr("href"), domain);
            if (!href) return;
            var name = sanitizeText($("h4.title, .title, strong, h2").text() || a.attr("title") || "");
            var dist = distance(normalize(name), normTitle);
            candidates.push({ href: href, name: name, score: dist, domain: domain });
          });
        } catch (_) {}
        if (candidates.length) {
          candidates.sort(function(a, b) { return a.score - b.score; });
          return candidates[0];
        }
        return tryDomain(idx + 1);
      }).catch(function() { return tryDomain(idx + 1); });
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
    var epPatternUrl2 = new RegExp("/sezon-" + seasonNum + "/bolum-" + episodeNum + "\\b", "i");
    var epPatternUrl3 = new RegExp("-" + episodeNum + "-bolum", "i");
    var epPatternTxt1 = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");
    var epPatternTxt2 = new RegExp("\\b" + seasonNum + "x" + episodeNum + "\\b", "i");
    var epPatternTxt3 = new RegExp("\\b" + episodeNum + "\\.?\\s*bölüm\\b", "i");

    var match = null;

    $("a[href*='bolum'], div.seasons-tab-content a.mini-poster, div.seasons a[href*='bolum'], a[href]").each(function(_, el) {
      if (match) return;
      var href = abs($(el).attr("href"), seriesUrl);
      if (!href) return;
      var txt = sanitizeText(($(el).find(".mini-poster-title").text() || $(el).text() || "").replace(/\s+/g, " "));

      if (epPatternUrl1.test(href) || epPatternUrl2.test(href) || epPatternTxt1.test(txt) || epPatternTxt2.test(txt)) {
        match = href;
      } else if (seasonNum === 1 && (epPatternUrl3.test(href) || epPatternTxt3.test(txt))) {
        match = href;
      }
    });

    return match || seriesUrl;
  }).catch(function() {
    return seriesUrl;
  });
}

function findIframes(pageUrl, domain) {
  return getText(pageUrl, { headers: { Referer: domain + "/" } }).then(async function(html) {
    var $ = cheerio.load(html);
    var links = [];

    // 1. Decrypt data-rm-k
    var encDiv = $("div[data-rm-k='true']").first();
    if (encDiv.length) {
      var dec = await webCryptoDecrypt(encDiv.text());
      if (dec && links.indexOf(dec) === -1) links.push(dec);
    }

    // 2. Direct iframes
    $("iframe").each(function(_, el) {
      var src = $(el).attr("data-src") || $(el).attr("src");
      if (src) {
        var u = abs(src, pageUrl);
        if (u && links.indexOf(u) === -1) links.push(u);
      }
    });

    // 3. Player tabs
    $("a[href*='player='], button[data-player], nav.card-nav a, a.card-nav-link").each(function(_, el) {
      var pUrl = abs($(el).attr("href") || $(el).attr("data-video") || $(el).attr("data-url"), pageUrl);
      if (pUrl && links.indexOf(pUrl) === -1 && !pUrl.startsWith("#")) {
        links.push(pUrl);
      }
    });

    return links;
  });
}

function makeStream(url, title, referer, index) {
  var lower = url.toLowerCase();
  var quality = "1080p";
  var q = lower.match(/(?:2160|1440|1080|720|576|480|360)p/);
  if (q) quality = q[0];
  else if (lower.indexOf("4k") !== -1) quality = "4K";

  var lang = "Türkçe Dublaj";
  if (lower.indexOf("altyazi") !== -1 || lower.indexOf("sub") !== -1 || lower.indexOf("trsub") !== -1) {
    lang = "Türkçe Altyazılı";
  }

  var isHls = lower.indexOf(".m3u8") !== -1 || lower.indexOf(".txt") !== -1 || lower.indexOf("/hls/") !== -1;
  return {
    name: "HDFilmCehennemi",
    title: title + " • " + lang + " (" + quality + ")" + (index > 0 ? " #" + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_DOMAINS[0] + "/",
      "User-Agent": USER_AGENT
    },
    provider: "hdfilmcehennemi"
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
    if (info.title.indexOf(":") !== -1) {
      searchNames.push(info.title.split(":")[0].trim());
    }
    if (info.originalTitle && info.originalTitle !== info.title) {
      searchNames.push(info.originalTitle);
      if (info.originalTitle.indexOf(":") !== -1) {
        searchNames.push(info.originalTitle.split(":")[0].trim());
      }
    }

    function tryName(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i], isMovie).then(function(res) {
        if (res && res.href) {
          if (res.score <= 12) return res;
        }
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

        return findIframes(pageUrl, domain).then(async function(iframes) {
          var streamUrls = [];

          for (var i = 0; i < iframes.length; i++) {
            var iframe = iframes[i];
            if (iframe.indexOf("player=") !== -1) {
              try {
                const pHtml = await getText(iframe, { headers: { Referer: pageUrl } });
                const $p = cheerio.load(pHtml);
                const enc = $p("div[data-rm-k='true']").first();
                if (enc.length) {
                  const dec = await webCryptoDecrypt(enc.text());
                  if (dec && streamUrls.indexOf(dec) === -1) streamUrls.push(dec);
                }
              } catch (_) {}
            } else if (streamUrls.indexOf(iframe) === -1) {
              streamUrls.push(iframe);
            }
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
      setTimeout(function() { resolve([]); }, 3500);
    })
  ]);
}
