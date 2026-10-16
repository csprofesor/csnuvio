"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_DOMAINS = [
  "https://ddizimom.net",
  "https://dizimom.plus",
  "https://www.dizimom.wiki",
  "https://dizimom.vip"
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

function postForm(url, data, referer) {
  var params = new URLSearchParams();
  for (var k in data) {
    params.append(k, data[k]);
  }
  var headers = Object.assign({}, HEADERS, {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": referer || BASE_DOMAINS[0] + "/"
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

function searchSite(title, year, isMovie, seasonNum, episodeNum) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);

  function tryDomain(idx) {
    if (idx >= BASE_DOMAINS.length) return Promise.resolve(null);
    var domain = BASE_DOMAINS[idx];

    var searchUrls = [
      domain + "/ara?q=" + q,
      domain + "/?s=" + q
    ];

    function trySearchUrl(sIdx) {
      if (sIdx >= searchUrls.length) return tryDomain(idx + 1);

      return getText(searchUrls[sIdx], { headers: { Referer: domain + "/" } }).then(function(html) {
        var $ = cheerio.load(html);
        var candidates = [];
        var directEpLinks = [];

        var epPatternUrl1 = seasonNum && episodeNum ? new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i") : null;
        var epPatternUrl2 = episodeNum ? new RegExp("-" + episodeNum + "-bolum", "i") : null;
        var epPatternTxt1 = seasonNum && episodeNum ? new RegExp(seasonNum + "\\.?\\s*sezon.*" + episodeNum + "\\.?\\s*bölüm", "i") : null;
        var epPatternTxt2 = episodeNum ? new RegExp("\\b" + episodeNum + "\\.?\\s*bölüm", "i") : null;

        $("a.group, a[href*='/dizi/'], a[href*='/film/'], a[href*='/anime/'], article, div.post-item, div.result-item, div.single-item, div.dizi-box, div.items article, a[href]").each(function(_, el) {
          var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
          var href = a.attr("href");
          if (!href) return;
          href = abs(href, domain);
          if (!href) return;

          if (href.indexOf("/tum-diziler/") !== -1 || href.indexOf("/dizi-takvimi/") !== -1 || href.indexOf("/yardim/") !== -1 || href.indexOf("/iletisim/") !== -1) return;
          if (href.indexOf("/sezon-") !== -1 && href.indexOf("/bolum-") === -1 && href.indexOf("?sezon=") === -1) return;

          var isFilmLink = href.indexOf("/film/") !== -1;
          var isDiziLink = href.indexOf("/dizi/") !== -1 || href.indexOf("/anime/") !== -1 || href.indexOf("-dizi") !== -1;

          if (isMovie && isDiziLink && !isFilmLink) return;
          if (!isMovie && isFilmLink) return;

          var rawText = sanitizeText($(el).text().replace(/\s+/g, " "));
          var titleAttr = sanitizeText(a.attr("title") || "");

          if (!isMovie && seasonNum && episodeNum) {
            if (epPatternUrl1 && (epPatternUrl1.test(href) || (epPatternTxt1 && epPatternTxt1.test(rawText)) || (epPatternTxt1 && epPatternTxt1.test(titleAttr)))) {
              directEpLinks.push(href);
            } else if (seasonNum === 1 && epPatternUrl2 && (epPatternUrl2.test(href) || (epPatternTxt2 && epPatternTxt2.test(rawText)) || (epPatternTxt2 && epPatternTxt2.test(titleAttr)))) {
              directEpLinks.push(href);
            }
          }

          var hTag = a.find("h1, h2, h3, .title, .entry-title, .categorytitle").first();
          var cleanName = (hTag.length ? hTag.text() : a.attr("title") || rawText)
            .replace(/Favorilere Ekle/gi, "")
            .replace(/IMDb\s*:?\s*[0-9.]+/gi, "")
            .replace(/Dizi\s*izle/gi, "")
            .replace(/Film\s*izle/gi, "")
            .replace(/izle/gi, "")
            .replace(/\s+/g, " ")
            .trim();

          cleanName = sanitizeText(cleanName);
          if (!cleanName) return;

          var normName = normalize(cleanName);
          var normTitle = normalize(cleanTitle);

          var isMatch = normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || distance(normName, normTitle) <= 6;
          if (isMatch) {
            var score = distance(normName, normTitle);
            if (isMovie && isFilmLink) score -= 20;
            if (!isMovie && isDiziLink) score -= 20;
            candidates.push({ href: href, name: cleanName, score: score, domain: domain });
          }
        });

        candidates.sort(function(a, b) { return a.score - b.score; });

        if (candidates.length || directEpLinks.length) {
          return {
            domain: domain,
            directEp: directEpLinks.length ? directEpLinks[0] : null,
            targetUrl: candidates.length ? candidates[0].href : null
          };
        }

        return trySearchUrl(sIdx + 1);
      }).catch(function() {
        return trySearchUrl(sIdx + 1);
      });
    }

    return trySearchUrl(0);
  }

  return tryDomain(0);
}

function findEpisodeUrlOnSeriesPage(seriesUrl, domain, seasonNum, episodeNum) {
  return getText(seriesUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
    var $ = cheerio.load(html);

    var epPatternUrl1 = new RegExp("-" + seasonNum + "-sezon-" + episodeNum + "-bolum", "i");
    var epPatternUrl2 = new RegExp("/" + seasonNum + "-sezon-" + episodeNum + "-", "i");
    var epPatternUrl3 = new RegExp("-" + episodeNum + "-bolum", "i");
    var epPatternTxt1 = new RegExp(seasonNum + "\\.?\\s*sezon\\s*" + episodeNum + "\\.?\\s*bölüm", "i");
    var epPatternTxt2 = new RegExp("\\b" + seasonNum + "x" + episodeNum + "\\b", "i");
    var epPatternTxt3 = new RegExp("\\b" + episodeNum + "\\.?\\s*bölüm\\b", "i");

    var match = null;

    $("a[href*='/bolum-'], a[href*='bolum'], a[href]").each(function(_, el) {
      if (match) return;
      var href = abs($(el).attr("href"), seriesUrl);
      if (!href) return;
      var txt = sanitizeText(($(el).text() || "").replace(/\s+/g, " "));

      if (epPatternUrl1.test(href) || epPatternUrl2.test(href) || epPatternTxt1.test(txt) || epPatternTxt2.test(txt)) {
        match = href;
      } else if (seasonNum === 1 && (epPatternUrl3.test(href) || epPatternTxt3.test(txt))) {
        match = href;
      }
    });

    if (match) return match;

    // Check season tabs if not found
    var seasonLinks = [];
    $("a[href*='?sezon='], a[href*='sezon-']").each(function(_, el) {
      var h = abs($(el).attr("href"), seriesUrl);
      var sMatch = h ? h.match(/sezon[=-](\d+)/i) : null;
      if (sMatch && parseInt(sMatch[1], 10) === seasonNum) {
        seasonLinks.push(h);
      }
    });

    if (seasonLinks.length) {
      return getText(seasonLinks[0], { headers: { Referer: seriesUrl } }).then(function(sHtml) {
        var $s = cheerio.load(sHtml);
        var sMatchEp = null;
        $s("a[href*='/bolum-'], a[href*='bolum']").each(function(_, el) {
          if (sMatchEp) return;
          var href = abs($s(el).attr("href"), seasonLinks[0]);
          if (!href) return;
          var txt = sanitizeText(($s(el).text() || "").replace(/\s+/g, " "));
          if (epPatternUrl1.test(href) || epPatternUrl2.test(href) || epPatternTxt1.test(txt) || epPatternTxt2.test(txt)) {
            sMatchEp = href;
          } else if (seasonNum === 1 && (epPatternUrl3.test(href) || epPatternTxt3.test(txt))) {
            sMatchEp = href;
          }
        });
        return sMatchEp || seriesUrl;
      }).catch(function() { return seriesUrl; });
    }

    return seriesUrl;
  }).catch(function() {
    return seriesUrl;
  });
}

function extractStreamsFromPage(pageUrl, domain) {
  return getText(pageUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var streamUrls = [];
    var iframes = [];

    // 1. Pilavyer data-pv SLUG
    var pvRegex = /data-pv=["']([^"']+)["']/g;
    var pvMatches = [];
    var m;
    while ((m = pvRegex.exec(html)) !== null) {
      if (pvMatches.indexOf(m[1]) === -1) pvMatches.push(m[1]);
    }

    // Dynamic candidate script hosts
    var scriptHosts = [];
    var hostRegex = /https?:\/\/([a-zA-Z0-9.-]+)\/(?:assets\/js\/core\.js|e\/c\.js)/g;
    while ((m = hostRegex.exec(html)) !== null) {
      if (scriptHosts.indexOf(m[1]) === -1) scriptHosts.push(m[1]);
    }

    var candidateHosts = scriptHosts.concat([
      "play2.pilavyerplay.top",
      "pilavyerplay.top",
      "play.pilavyerplay.top",
      "pilavyer.top"
    ]).filter(function(v, i, a) { return a.indexOf(v) === i; });

    var pvPromises = pvMatches.map(function(slug) {
      function tryHost(hIdx) {
        if (hIdx >= candidateHosts.length) return Promise.resolve(null);
        var host = candidateHosts[hIdx];
        var sUrl = "https://" + host + "/assets/js/s.php?s=" + slug;

        return getText(sUrl, { headers: { Referer: domain + "/" } }).then(function(resText) {
          var pMatch = resText.match(/window\.__PLAYER__\s*=\s*(\{.*?\}|\{.*?\n\});/s);
          if (pMatch) {
            var streamMatch = pMatch[1].match(/"stream"\s*:\s*"([^"]+)"/);
            if (streamMatch) {
              var sUrlResolved = streamMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
              if (sUrlResolved && sUrlResolved.startsWith("http")) {
                return sUrlResolved;
              }
            }
          }
          return tryHost(hIdx + 1);
        }).catch(function() {
          return tryHost(hIdx + 1);
        });
      }
      return tryHost(0);
    });

    // 2. Extract iframes & video players
    $("div.video iframe, div.video p iframe, iframe").each(function(_, el) {
      var src = $(el).attr("data-src") || $(el).attr("src");
      if (src && src !== "about:blank") iframes.push(abs(src, pageUrl));
    });

    $("div.sources a, div.diziplus_sources a, [data-video], [data-url]").each(function(_, el) {
      var href = $(el).attr("href") || $(el).attr("data-video") || $(el).attr("data-url");
      if (href && href !== "#" && !href.startsWith("javascript:")) iframes.push(abs(href, pageUrl));
    });

    return Promise.all(pvPromises).then(function(pvResults) {
      pvResults.forEach(function(u) {
        if (u && streamUrls.indexOf(u) === -1) streamUrls.push(u);
      });

      var iframePromises = iframes.map(function(iframe) {
        return resolveEmbed(iframe, pageUrl);
      });

      return Promise.all(iframePromises).then(function(iframeResults) {
        iframeResults.forEach(function(arr) {
          arr.forEach(function(u) {
            if (u && streamUrls.indexOf(u) === -1) streamUrls.push(u);
          });
        });
        return streamUrls;
      });
    });
  }).catch(function() {
    return [];
  });
}

function resolveEmbed(embedUrl, referer) {
  referer = referer || BASE_DOMAINS[0] + "/";
  if (!embedUrl) return Promise.resolve([]);

  var lower = embedUrl.toLowerCase();

  // 1. Pilavyer
  if (lower.indexOf("pilavyer") !== -1 || lower.indexOf("play2.pilavyerplay") !== -1) {
    return getText(embedUrl, { headers: { Referer: referer } }).then(function(html) {
      var m = html.match(/"stream"\s*:\s*"([^"]+)"/);
      if (m) {
        var u = m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
        if (u && u.startsWith("http")) return [u];
      }
      var m3u8 = html.match(/https?:\/\/[^"'`\s]+\.m3u8[^\s"'`]*/gi);
      if (m3u8 && m3u8.length) return [m3u8[0]];
      return [];
    }).catch(function() { return []; });
  }

  // 2. HDPlayerSystem / HDPlayer / HDMomPlayer / HDStreamable / PeaceMakerst
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
      postUrls.push(cleanEmbed + "?do=getVideo");
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

  // 3. VideoSeyred
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

  // 4. Vidmoly
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
      "Referer": referer || BASE_DOMAINS[0] + "/",
      "User-Agent": USER_AGENT
    },
    provider: "dizimom"
  };
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
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
      return searchSite(searchNames[i], info.year, isMovie, seasonNum, episodeNum).then(function(res) {
        if (res && (res.directEp || res.targetUrl)) return res;
        return tryName(i + 1);
      }).catch(function() { return tryName(i + 1); });
    }

    return tryName(0).then(function(res) {
      if (!res) return [];

      var domain = res.domain || BASE_DOMAINS[0];
      var pageUrlPromise;

      if (isMovie) {
        pageUrlPromise = Promise.resolve(res.targetUrl);
      } else {
        pageUrlPromise = res.directEp
          ? Promise.resolve(res.directEp)
          : findEpisodeUrlOnSeriesPage(res.targetUrl, domain, seasonNum, episodeNum);
      }

      return pageUrlPromise.then(function(pageUrl) {
        if (!pageUrl) return [];

        return extractStreamsFromPage(pageUrl, domain).then(function(streamUrls) {
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
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
