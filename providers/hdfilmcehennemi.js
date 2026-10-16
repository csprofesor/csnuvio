"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_DOMAINS = [
  "https://www.hdfilmcehennemi.nl",
  "https://www.hdfilmcehennemi.life",
  "https://hdfilmcehennemi.ws",
  "https://www.hdfilmcehennemi.cx",
  "https://hdfilmcehennemi.mobi"
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

function searchSite(title, isMovie) {
  var cleanTitle = sanitizeText(title);
  var q = encodeURIComponent(cleanTitle);

  function tryDomain(idx) {
    if (idx >= BASE_DOMAINS.length) return Promise.resolve(null);
    var domain = BASE_DOMAINS[idx];

    var searchApiUrl = domain + "/search?q=" + q;

    return getText(searchApiUrl, {
      headers: {
        "X-Requested-With": "fetch",
        "Content-Type": "application/json",
        "Referer": domain + "/"
      }
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

          var itemIsTv = href.indexOf("/dizi/") !== -1;
          if (isMovie && itemIsTv) return;
          if (!isMovie && !itemIsTv) return;

          var name = sanitizeText($("h4.title, .title, strong, h2").text() || a.attr("aria-label") || a.attr("title") || "");
          if (!name) return;

          var normName = normalize(name);
          var dist = distance(normName, normTitle);

          if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
            candidates.push({ href: href, name: name, score: dist, domain: domain });
          }
        });
      } catch (_) {}

      if (candidates.length) {
        candidates.sort(function(a, b) { return a.score - b.score; });
        return candidates[0];
      }

      // HTML search fallback
      return getText(domain + "/arama/?s=" + q, { headers: { Referer: domain + "/" } }).then(function(html) {
        var $ = cheerio.load(html);
        var htmlCandidates = [];

        $("a.poster, a.card, div.poster, div.card, article, div.movie-box, a.search-result").each(function(_, el) {
          var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
          var href = abs(a.attr("href"), domain);
          if (!href) return;

          var itemIsTv = href.indexOf("/dizi/") !== -1;
          if (isMovie && itemIsTv) return;
          if (!isMovie && !itemIsTv) return;

          var name = sanitizeText($(el).find("h2.title, h3.title, .title, strong, strong.poster-title").text() || a.attr("title") || $(el).attr("data-title") || "");
          if (!name) return;

          var normName = normalize(name);
          var dist = distance(normName, normTitle);

          if (normName.indexOf(normTitle) !== -1 || normTitle.indexOf(normName) !== -1 || dist <= 6) {
            htmlCandidates.push({ href: href, name: name, score: dist, domain: domain });
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
  return getText(pageUrl, { headers: { Referer: domain + "/" } }).then(function(html) {
    var $ = cheerio.load(html);
    var links = [];

    function addLink(rawUrl) {
      if (!rawUrl) return;
      var u = abs(rawUrl, pageUrl);
      if (!u) return;
      var lower = u.toLowerCase();
      if (lower.match(/\.(webp|jpg|png|jpeg|svg|css|js)(\?|$)/i)) return;
      if (lower.indexOf("youtube.com") !== -1 || lower.indexOf("youtu.be") !== -1) return;
      if (lower.indexOf("google") !== -1 || lower.indexOf("analytics") !== -1 || lower.indexOf("doubleclick") !== -1) return;
      if (links.indexOf(u) === -1) links.push(u);
    }

    // 1. Direct iframes
    $("iframe").each(function(_, el) {
      addLink($(el).attr("data-src") || $(el).attr("src") || $(el).attr("data-lazy-src"));
    });

    // 2. Navigation tabs & buttons
    $("nav.card-nav a, a.card-nav-link, button.card-nav-link, .card-video a, [data-video], [data-url]").each(function(_, el) {
      var pUrl = $(el).attr("data-video") || $(el).attr("data-url") || $(el).attr("href");
      if (pUrl && !pUrl.startsWith("#") && !pUrl.startsWith("javascript:")) {
        if (pUrl.startsWith("/video/")) {
          addLink("https://hdfilmcehennemi.mobi" + pUrl);
        } else {
          addLink(pUrl);
        }
      }
    });

    // 3. Regex matches
    var matches = html.match(/https?:\/\/[^\s'"\\]+?\/(?:video\/embed|embed|v|player|video)[^\s'"\\]*/gi);
    if (matches) {
      matches.forEach(function(m) { addLink(m); });
    }

    return links;
  });
}

function resolveEmbed(embedUrl, referer) {
  referer = referer || BASE_DOMAINS[0] + "/";
  if (!embedUrl) return Promise.resolve([]);

  var originMatch = embedUrl.match(/https?:\/\/[^\/]+/);
  var origin = originMatch ? originMatch[0] : BASE_DOMAINS[0];

  return getText(embedUrl, { headers: { Referer: referer } }).then(function(html) {
    var urls = [];

    // Direct m3u8 or txt stream links (HLS)
    var m3u8Matches = html.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|txt)[^\s"'<>]*/gi);
    if (m3u8Matches) {
      m3u8Matches.forEach(function(u) {
        u = u.replace(/\\\//g, '/');
        if (u.indexOf("filmakinesi") === -1 && urls.indexOf(u) === -1) {
          urls.push(u);
        }
      });
    }

    // Hash based video resolver
    var hashMatch = html.match(/"hash"\s*:\s*"([a-zA-Z0-9]{32})"/i) || html.match(/hash\s*:\s*['"]([a-zA-Z0-9]{32})['"]/i);
    var hash = hashMatch ? hashMatch[1] : null;

    if (hash) {
      var cleanEmbed = embedUrl.split("?")[0];
      var postUrls = [
        cleanEmbed + "?do=getVideo",
        origin + "/video/ah/"
      ];

      function tryPost(idx) {
        if (idx >= postUrls.length) return Promise.resolve(urls);
        return postForm(postUrls[idx], { hash: hash }, embedUrl).then(function(resText) {
          var postMatches = resText.match(/"(?:file|url|hls|source|securedLink)"\s*:\s*"([^"]+)"/g);
          if (postMatches) {
            postMatches.forEach(function(m) {
              var uMatch = m.match(/"(?:file|url|hls|source|securedLink)"\s*:\s*"([^"]+)"/);
              if (uMatch) {
                var u = uMatch[1].replace(/\\\//g, '/');
                if (u.indexOf("filmakinesi") === -1 && urls.indexOf(u) === -1) urls.push(u);
              }
            });
          }

          var mMatches = resText.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|txt)[^\s"'<>]*/gi);
          if (mMatches) {
            mMatches.forEach(function(u) {
              u = u.replace(/\\\//g, '/');
              if (u.indexOf("filmakinesi") === -1 && urls.indexOf(u) === -1) urls.push(u);
            });
          }

          if (urls.length) return urls;
          return tryPost(idx + 1);
        }).catch(function() { return tryPost(idx + 1); });
      }

      return tryPost(0);
    }

    // Fallback: check file: "..." or mp4
    var fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (fileMatch && fileMatch[1].indexOf("filmakinesi") === -1) {
      var f = fileMatch[1].replace(/\\\//g, '/');
      if (urls.indexOf(f) === -1) urls.push(f);
    }

    var mp4Matches = html.match(/https?:\/\/[^"'`\s]+\.mp4[^\s"'`]*/gi);
    if (mp4Matches) {
      mp4Matches.forEach(function(u) {
        if (urls.indexOf(u) === -1) urls.push(u);
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

  var isHls = lower.indexOf(".m3u8") !== -1 || lower.indexOf(".txt") !== -1 || lower.indexOf("/hls/") !== -1;
  return {
    name: "HDFilmCehennemi",
    title: title + (index > 0 ? " • Kaynak " + (index + 1) : ""),
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

        return findIframes(pageUrl, domain).then(function(iframes) {
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
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
