"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.dizimom.wiki";
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
      year: ((endpoint === "tv" ? d.first_air_date : d.release_date) || "").slice(0, 4),
      posterPath: d.poster_path ? "https://image.tmdb.org/t/p/w500" + d.poster_path : null,
      backdropPath: d.backdrop_path ? "https://image.tmdb.org/t/p/w1280" + d.backdrop_path : null,
      overview: d.overview || "",
      voteAverage: d.vote_average || 0,
      genres: (d.genres || []).map(function(g) { return g.name; })
    };

    if (endpoint === "tv" && seasonNum && episodeNum) {
      var epUrl = "https://api.themoviedb.org/3/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + episodeNum + "?api_key=" + apiKey + "&language=tr-TR";
      return fetch(epUrl).then(function(er) { return er.json(); }).then(function(epData) {
        info.episodeTitle = sanitizeText(epData.name || "");
        info.episodeOverview = epData.overview || "";
        info.episodeAirDate = epData.air_date || "";
        info.episodeStillPath = epData.still_path ? "https://image.tmdb.org/t/p/w500" + epData.still_path : null;
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

function searchSite(title, year, seasonNum, episodeNum) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);
  return getText(BASE_URL + "/?s=" + q).then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];
    var directEpLinks = [];

    var epPatternUrl = new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var epPatternTxt = new RegExp(seasonNum + "\\.?\\s*sezon.*" + episodeNum + "\\.?\\s*bölüm", "i");

    $("article, div.post-item, div.result-item, div.single-item, div.dizi-box, div.items article, a[href]").each(function(_, el) {
      var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
      var href = abs(a.attr("href"));
      if (!href || href.indexOf(BASE_URL) === -1) return;

      if (href.indexOf("/tum-diziler/") !== -1 || href.indexOf("/dizi-takvimi/") !== -1 || href.indexOf("/yardim/") !== -1 || href.indexOf("/iletisim/") !== -1) return;

      var rawText = sanitizeText($(el).text().replace(/\s+/g, " "));
      var titleAttr = sanitizeText(a.attr("title") || "");

      if (epPatternUrl.test(href) || epPatternTxt.test(rawText) || epPatternTxt.test(titleAttr)) {
        directEpLinks.push(href);
      }

      var cleanName = (a.find("h2, h3, .title, .categorytitle").first().text() || a.attr("title") || rawText)
        .replace(/Favorilere Ekle/gi, "")
        .replace(/IMDb\s*:?\s*[0-9.]+/gi, "")
        .replace(/izle/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      cleanName = sanitizeText(cleanName);
      if (!cleanName) return;

      var normName = normalize(cleanName);
      var normTitle = normalize(cleanTitle);

      var isMatch = normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || distance(normName, normTitle) <= 6;
      if (isMatch) {
        var isSeriesLink = href.indexOf("/diziler/") !== -1 || href.indexOf("-dizi") !== -1;
        var score = distance(normName, normTitle);
        if (isSeriesLink) score -= 15;
        candidates.push({ href: href, name: cleanName, score: score });
      }
    });

    candidates.sort(function(a, b) { return a.score - b.score; });

    return {
      directEp: directEpLinks.length ? directEpLinks[0] : null,
      seriesUrl: candidates.length ? candidates[0].href : null
    };
  });
}

function findEpisodeUrlOnSeriesPage(seriesUrl, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: BASE_URL + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var epPatternUrl1 = new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var epPatternUrl2 = new RegExp("/" + seasonNum + "-sezon-" + episodeNum + "-", "i");
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

    $("div.video iframe, div.video p iframe, iframe").each(function(_, el) {
      var src = $(el).attr("data-src") || $(el).attr("src");
      if (src && src !== "about:blank") links.push(abs(src, pageUrl));
    });

    $("div.sources a, div.diziplus_sources a").each(function(_, el) {
      var href = $(el).attr("href");
      if (href && href !== "#") links.push(abs(href, pageUrl));
    });

    return links.filter(function(v, i, a) { return a.indexOf(v) === i; });
  });
}

function resolveEmbed(embedUrl, referer) {
  referer = referer || BASE_URL + "/";
  if (!embedUrl) return Promise.resolve([]);

  var lower = embedUrl.toLowerCase();

  // 1. HDPlayerSystem / HDPlayer / HDMomPlayer / HDStreamable / PeaceMakerst
  if (lower.indexOf("hdplayersystem") !== -1 || lower.indexOf("hdplayer") !== -1 || lower.indexOf("hdmomplayer") !== -1 || lower.indexOf("hdstreamable") !== -1 || lower.indexOf("peacemakerst") !== -1) {
    var hash = null;
    if (embedUrl.indexOf("data=") !== -1) {
      hash = embedUrl.split("data=")[1].split("&")[0];
    } else if (embedUrl.indexOf("/video/") !== -1) {
      hash = embedUrl.split("/video/")[1].split("?")[0].split("/")[0];
    } else if (embedUrl.indexOf("/embed/") !== -1) {
      hash = embedUrl.split("/embed/")[1].split("?")[0].split("/")[0];
    }

    if (hash) {
      var cleanEmbed = embedUrl.split("?")[0];
      var postUrls = [];
      if (lower.indexOf("/video/") !== -1) {
        postUrls.push(cleanEmbed + "?do=getVideo");
      }
      var origin = embedUrl.split("/").slice(0, 3).join("/");
      postUrls.push(origin + "/player/index.php?data=" + hash + "&do=getVideo");

      function tryPost(idx) {
        if (idx >= postUrls.length) return Promise.resolve([]);
        return postForm(postUrls[idx], { hash: hash, r: referer, s: "" }, referer).then(function(resText) {
          try {
            var resJson = JSON.parse(resText);
            var m3u8 = resJson.securedLink || resJson.videoSource;
            if (m3u8 && typeof m3u8 === "string") return [m3u8];
            if (resJson.videoSources && resJson.videoSources.length) {
              return resJson.videoSources.map(function(s) { return s.file; }).filter(Boolean);
            }
          } catch (_) {}
          return tryPost(idx + 1);
        }).catch(function() { return tryPost(idx + 1); });
      }

      return tryPost(0);
    }
  }

  // 2. VideoSeyred
  if (lower.indexOf("videoseyred") !== -1) {
    var vidId = embedUrl.split("/embed/")[1] ? embedUrl.split("/embed/")[1].split("?")[0] : null;
    if (vidId) {
      var playlistUrl = "https://videoseyred.in/playlist/" + vidId + ".json";
      return getText(playlistUrl, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Referer": embedUrl
        }
      }).then(function(resText) {
        try {
          var arr = JSON.parse(resText);
          if (arr && arr[0] && arr[0].sources) {
            return arr[0].sources.map(function(s) { return s.file; });
          }
        } catch (_) {}
        return [];
      }).catch(function() { return []; });
    }
  }

  // 3. Vidmoly
  if (lower.indexOf("vidmoly") !== -1) {
    return getText(embedUrl, { headers: { Referer: referer } }).then(function(html) {
      var matches = html.match(/https?:\/\/[^"'`\s]+\.m3u8[^\s"'`]*/gi);
      if (matches && matches.length) return [matches[0]];
      var fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
      if (fileMatch) return [fileMatch[1]];
      return [];
    }).catch(function() { return []; });
  }

  // Generic fallback: fetch HTML and search for .m3u8 or .mp4
  return getText(embedUrl, { headers: { Referer: referer } }).then(function(html) {
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
    name: "DiziMom",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
    url: url,
    quality: quality,
    type: isHls ? "hls" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": USER_AGENT
    },
    provider: "dizimom"
  };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType !== "tv" && mediaType !== "series") return Promise.resolve([]);
  if (!seasonNum || !episodeNum) return Promise.resolve([]);

  return tmdbDetails(tmdbId, mediaType, seasonNum, episodeNum).then(function(info) {
    if (!info || !info.title) return [];

    var searchNames = [info.title];
    if (info.originalTitle && info.originalTitle !== info.title) searchNames.push(info.originalTitle);

    function tryName(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i], info.year, seasonNum, episodeNum).then(function(res) {
        if (res && (res.directEp || res.seriesUrl)) return res;
        return tryName(i + 1);
      }).catch(function() { return tryName(i + 1); });
    }

    return tryName(0).then(function(res) {
      if (!res) return [];

      var epPromise = res.directEp
        ? Promise.resolve(res.directEp)
        : findEpisodeUrlOnSeriesPage(res.seriesUrl, seasonNum, episodeNum);

      return epPromise.then(function(epUrl) {
        if (!epUrl) return [];

        return findIframes(epUrl).then(function(iframes) {
          var resolvePromises = iframes.map(function(iframe) {
            return resolveEmbed(iframe, epUrl);
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
              return makeStream(u, label, epUrl, idx);
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
