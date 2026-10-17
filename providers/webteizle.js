"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://webteizle.info";
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

function searchSite(title) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);
  var searchUrl = BASE_URL + "/filtre?a=" + q;

  return getText(searchUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];
    var normTitle = normalize(cleanTitle);

    $("div.golgever").each(function(_, el) {
      var a = $(el).find("a").first();
      var href = abs(a.attr("href"));
      if (!href) return;

      var name = sanitizeText($(el).find("div.filmname").text() || a.attr("title") || "");
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

function resolveWebteIzle(movieUrl) {
  return getText(movieUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var filmId = $("button#wip").attr("data-id") || $("div[data-filmid]").attr("data-filmid");

    if (!filmId) {
      var directIframes = [];
      $("iframe").each(function(_, el) {
        var src = abs($(el).attr("src") || $(el).attr("data-src"), movieUrl);
        if (src && src.indexOf("youtube.com") === -1 && src.indexOf("youtu.be") === -1) {
          if (directIframes.indexOf(src) === -1) directIframes.push(src);
        }
      });
      var resolveDirect = directIframes.map(function(u) { return resolvePlayerHtml(u, movieUrl); });
      return Promise.all(resolveDirect).then(function(arrs) {
        var flat = [];
        arrs.forEach(function(a) { a.forEach(function(u) { if (flat.indexOf(u) === -1) flat.push(u); }); });
        return flat;
      });
    }

    var dilList = ["0", "1"]; // Dublaj, Altyazılı
    var altPromises = dilList.map(function(dil) {
      return postForm(BASE_URL + "/ajax/dataAlternatif3.asp", {
        filmid: filmId,
        dil: dil,
        s: "",
        b: "",
        bot: "0"
      }, movieUrl).then(function(resText) {
        try {
          var playerData = JSON.parse(resText);
          var items = playerData.data || [];
          var embedPromises = items.map(function(thisEmbed) {
            return postForm(BASE_URL + "/ajax/dataEmbed.asp", {
              id: thisEmbed.id.toString()
            }, movieUrl).then(function(embedHtml) {
              var e$ = cheerio.load(embedHtml);
              var iframe = abs(e$("iframe").first().attr("src"), movieUrl);

              if (!iframe) {
                var fnMatch = embedHtml.match(/(vidmoly|sruby|filemoon|pixel|okru|mailru)\('([^']+)'/i);
                if (fnMatch) {
                  var platform = fnMatch[1].toLowerCase();
                  var vidId = fnMatch[2];
                  if (platform === "vidmoly") iframe = "https://vidmoly.biz/embed-" + vidId + ".html";
                  else if (platform === "sruby") iframe = "https://rubyvidhub.com/embed-" + vidId + ".html";
                  else if (platform === "filemoon") iframe = "https://bysezoxexe.com/e/" + vidId;
                  else if (platform === "pixel") iframe = "https://pixeldrain.com/u/" + vidId;
                  else if (platform === "okru") iframe = "https://ok.ru/videoembed/" + vidId;
                  else if (platform === "mailru") iframe = "https://my.mail.ru/video/embed/" + vidId;
                }
              }

              return iframe;
            }).catch(function() { return null; });
          });

          return Promise.all(embedPromises);
        } catch (_) {
          return [];
        }
      }).catch(function() { return []; });
    });

    return Promise.all(altPromises).then(function(nestedIframes) {
      var allIframes = [];
      nestedIframes.forEach(function(group) {
        group.forEach(function(ifr) {
          if (ifr && allIframes.indexOf(ifr) === -1) allIframes.push(ifr);
        });
      });

      var resolvePromises = allIframes.map(function(u) {
        return resolvePlayerHtml(u, movieUrl);
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
    name: "WebteIzle",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "webteizle"
  };
}

function _getStreamsCore(tmdbId, mediaType) {
  if (mediaType === "tv" || mediaType === "series") return Promise.resolve([]);

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

      return resolveWebteIzle(movieUrl).then(function(streamUrls) {
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
