"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://dizipal1583.com";
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

async function webCryptoDecrypt(rawJsonText) {
  var passphrase = "3hPn4uCjTVtfYWcjIcoJQ4cL1WWk1qxXI39egLYOmNv6IblA7eKJz68uU3eLzux1biZLCms0quEjTYniGv5z1JcKbNIsDQFSeIZOBZJz4is6pD7UyWDggWWzTLBQbHcQFpBQdClnuQaMNUHtLHTpzCvZy33p6I7wFBvL4fnXBYH84aUIyWGTRvM2G5cfoNf4705tO2kv";

  var ctMatch = rawJsonText.match(/"ciphertext"\s*:\s*"([^"]+)"/);
  var ivMatch = rawJsonText.match(/"iv"\s*:\s*"([^"]+)"/);
  var saltMatch = rawJsonText.match(/"salt"\s*:\s*"([^"]+)"/);

  if (!ctMatch || !ivMatch || !saltMatch) return null;

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
    var saltBuf = hexToBuf(saltMatch[1]);
    var ivBuf = hexToBuf(ivMatch[1]);
    var ctBuf = b64ToBuf(ctMatch[1]);

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

function searchSite(title) {
  var searchUrl = BASE_URL + "/bg/searchcontent";
  var postData = {
    "cKey": "c61f91c5141d178450934fe81c0a2029",
    "cValue": "MTc4NDQwNzIwMDhkMzJhNTc1YzUwOGU1ZjQwMjdjMjIyOWVjOGVhMTcwNGQyM2FjODM2YTI4YTU0NjUyMjI2ZmVjMzFkYzBkMWQyMWY4YzdiNA==",
    "type": "hepsi",
    "searchterm": title
  };

  return postForm(searchUrl, postData, BASE_URL + "/").then(function(resText) {
    try {
      var json = JSON.parse(resText);
      var results = (json.data && json.data.result) || [];
      var candidates = [];

      var normTitle = normalize(title);

      results.forEach(function(item) {
        var itemTitle = sanitizeText(item.title || "");
        var slug = item.slug || "";
        if (!itemTitle || !slug) return;

        var normName = normalize(itemTitle);
        var dist = distance(normName, normTitle);

        if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
          var href = slug.startsWith("http") ? slug : BASE_URL + "/" + slug.replace(/^\//, "");
          candidates.push({ href: href, name: itemTitle, score: dist, type: item.type });
        }
      });

      candidates.sort(function(a, b) { return a.score - b.score; });
      return candidates.length ? candidates[0].href : null;
    } catch (_) {
      return null;
    }
  }).catch(function() { return null; });
}

function findEpisodeUrlOnSeriesPage(seriesUrl, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);

    var epPatternUrl1 = new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var epPatternUrl2 = new RegExp("/s" + seasonNum + "e" + episodeNum + "\\b", "i");
    var epPatternUrl3 = new RegExp("/sezon-" + seasonNum + "/bolum-" + episodeNum + "\\b", "i");
    var epPatternUrl4 = new RegExp("-" + episodeNum + "-bolum", "i");
    var epPatternTxt1 = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");
    var epPatternTxt2 = new RegExp("\\b" + seasonNum + "x" + episodeNum + "\\b", "i");
    var epPatternTxt3 = new RegExp("\\b" + episodeNum + "\\.?\\s*bölüm\\b", "i");

    var match = null;

    $("a[href]").each(function(_, el) {
      if (match) return;
      var href = abs($(el).attr("href"), seriesUrl);
      if (!href) return;
      var txt = sanitizeText(($(el).text() || "").replace(/\s+/g, " "));

      if (epPatternUrl1.test(href) || epPatternUrl2.test(href) || epPatternUrl3.test(href) || epPatternTxt1.test(txt) || epPatternTxt2.test(txt)) {
        match = href;
      } else if (seasonNum === 1 && (epPatternUrl4.test(href) || epPatternTxt3.test(txt))) {
        match = href;
      }
    });

    return match;
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
  var quality = "HD";
  var q = lower.match(/(?:2160|1440|1080|720|576|480|360)p/);
  if (q) quality = q[0];
  else if (lower.indexOf("4k") !== -1) quality = "4K";

  var isHls = lower.indexOf(".m3u8") !== -1;
  return {
    name: "DiziPal",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "dizipal"
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

        return getText(pageUrl, { headers: { Referer: BASE_URL + "/" } }).then(async function(html) {
          var $ = cheerio.load(html);
          var encryptedDiv = $("div[data-rm-k=true]").first();
          var rawEncrypted = encryptedDiv.length ? encryptedDiv.text() : "";

          var iframeUrl = null;
          if (rawEncrypted) {
            iframeUrl = await webCryptoDecrypt(rawEncrypted);
          }

          if (!iframeUrl) {
            var iframeEl = $("iframe").first();
            iframeUrl = iframeEl.attr("data-src") || iframeEl.attr("src");
            if (iframeUrl && iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;
          }

          if (!iframeUrl) return [];

          return resolveDPlayer(iframeUrl, pageUrl).then(function(streamUrls) {
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
