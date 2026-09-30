"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://www.dizimom.help";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
};

function abs(url, base) {
  if (!url) return null;
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
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  });
}

function tmdbDetails(tmdbId, type) {
  var endpoint = type === "tv" || type === "series" ? "tv" : "movie";
  return fetch("https://api.themoviedb.org/3/" + endpoint + "/" + tmdbId + "?api_key=1c29a5198ee1854bd5eb45dbe8d17d92&language=tr-TR")
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        title: endpoint === "tv" ? d.name : d.title,
        originalTitle: endpoint === "tv" ? d.original_name : d.original_title,
        year: ((endpoint === "tv" ? d.first_air_date : d.release_date) || "").slice(0, 4)
      };
    });
}

function normalize(s) {
  return (s || "").toLowerCase()
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

function searchSite(title, year) {
  var q = encodeURIComponent(title);
  return getText(BASE_URL + "/?s=" + q).then(function(html) {
    var $ = cheerio.load(html);
    var candidates = [];

    $("div.items article, div.result-item article, div.single-item, div.episode-box, div.cat-item, div.dizi-box, article, div.post-item, div.box, div.poster, div.item, div.movie, div.card, div.flix-item, div.movie-box, div.movies-list-item, a.poster").each(function(_, el) {
      var a = $(el).find("a[href]").first();
      var href = a.attr("href") || $(el).attr("href");
      if (!href) return;

      var text = ($(el).text() || "").replace(/\s+/g, " ").trim();
      var name = ($(el).find("h2,h3,.title,.categorytitle,.episode-name,a.title").first().text() || a.attr("title") || $(el).find("img").attr("alt") || text).replace(/\s+/g," ").trim();
      if (!name) return;

      var y = (text.match(/\b(19\d{2}|20\d{2})\b/) || [])[1] || "";
      var nd = distance(name, title);
      var titleOk = normalize(name).indexOf(normalize(title)) !== -1 ||
                    normalize(title).indexOf(normalize(name)) !== -1 ||
                    nd <= 7;
      if (!titleOk) return;
      if (year && y && Math.abs(parseInt(year,10)-parseInt(y,10)) > 1) return;

      candidates.push({href:abs(href), name:name, year:y, distance:nd});
    });

    candidates.sort(function(a,b) {
      return (a.distance-b.distance) || ((a.year?0:1)-(b.year?0:1));
    });

    return candidates.length ? candidates[0].href : null;
  });
}

function findIframes(pageUrl) {
  return getText(pageUrl, {headers:{Referer: BASE_URL + "/"}}).then(function(html) {
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

    return links.filter(function(v,i,a){return a.indexOf(v)===i;});
  });
}

function mediaUrls(html, pageUrl) {
  var found = [];
  var re = /https?:\\/\\/[^"'\\s<>]+(?:\.m3u8|\.mp4|\.mkv|\.webm)(?:\\?[^"'\\s<>]*)?/gi;
  var m;
  while ((m = re.exec(html))) found.push(m[0].replace(/\\\\/g,""));
  var srcRe = /(?:src|file|source|url)\\s*[:=]\\s*["']([^"']+)["']/gi;
  while ((m = srcRe.exec(html))) {
    if (/\.(m3u8|mp4|mkv|webm)(\?|$)/i.test(m[1])) found.push(abs(m[1], pageUrl));
  }
  return found.filter(function(v,i,a){return v && a.indexOf(v)===i;});
}

function resolveEmbed(url, depth) {
  depth = depth || 0;
  if (depth > 3) return Promise.resolve([]);
  return getText(url, {headers:{Referer: BASE_URL + "/"}}).then(function(html) {
    var direct = mediaUrls(html, url);
    if (direct.length) return direct;

    var $ = cheerio.load(html);
    var next = [];
    $("iframe").each(function(_,el) {
      var s = $(el).attr("data-src") || $(el).attr("src");
      if (s && s !== "about:blank") next.push(abs(s,url));
    });

    var promises = next.filter(function(v,i,a){return a.indexOf(v)===i;}).map(function(v) {
      return resolveEmbed(v, depth+1);
    });
    return Promise.all(promises).then(function(xs) {
      return xs.reduce(function(a,b){return a.concat(b);}, []);
    });
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

  return tmdbDetails(tmdbId, mediaType).then(function(info) {
    if (!info || !info.title) return [];

    var searchNames = [info.title];
    if (info.originalTitle && info.originalTitle !== info.title) searchNames.push(info.originalTitle);

    function tryName(i) {
      if (i >= searchNames.length) return Promise.resolve(null);
      return searchSite(searchNames[i], info.year).then(function(url) {
        return url || tryName(i+1);
      }).catch(function(){ return tryName(i+1); });
    }

    return tryName(0).then(function(seriesUrl) {
      if (!seriesUrl) return [];

      return findIframes(seriesUrl).then(function(links) {
        var episodeLinks = links.filter(function(u) {
          var s = u.toLowerCase();
          return s.indexOf("sezon") !== -1 || s.indexOf("bolum") !== -1 ||
                 s.indexOf("episode") !== -1 || s.indexOf("embed") !== -1 ||
                 s.indexOf("/e/") !== -1;
        });

        // DiziMom'da sezon/bölüm bağlantıları ana sayfada bulunabiliyorsa
        // önce bölüm URL'sini bulmayı dene.
        return getText(seriesUrl, {headers:{Referer:BASE_URL+"/"}}).then(function(html) {
          var $ = cheerio.load(html);
          var wanted = [];
          var patterns = [
            new RegExp(seasonNum + "\\.?\\s*sezon[^\\n]{0,100}?" + episodeNum + "\\.?\\s*bölüm","i"),
            new RegExp("\\b" + seasonNum + "x" + episodeNum + "\\b","i"),
            new RegExp(seasonNum + "[^\\n]{0,50}" + episodeNum + "\\.?\\s*bölüm","i")
          ];

          $("a[href]").each(function(_,el) {
            var txt = ($(el).text() || "").replace(/\\s+/g," ").trim();
            var href = $(el).attr("href");
            if (!href) return;
            var hay = txt + " " + href;
            for (var p=0;p<patterns.length;p++) {
              if (patterns[p].test(hay)) {
                wanted.push(abs(href, seriesUrl));
                break;
              }
            }
          });

          wanted = wanted.concat(episodeLinks);
          wanted = wanted.filter(function(v,i,a){return a.indexOf(v)===i;});

          var targets = wanted.length ? wanted : [seriesUrl];
          return Promise.all(targets.slice(0,8).map(function(u) {
            return findIframes(u).then(function(xs) {
              return xs.concat([u]);
            }).catch(function(){ return [u]; });
          })).then(function(groups) {
            var all = [];
            groups.forEach(function(g){ all=all.concat(g); });
            all = all.filter(function(v,i,a){return v && a.indexOf(v)===i;});

            return Promise.all(all.slice(0,12).map(function(u){ return resolveEmbed(u); }))
              .then(function(results) {
                var urls = [];
                results.forEach(function(arr){ urls=urls.concat(arr); });
                urls = urls.filter(function(v,i,a){return v && a.indexOf(v)===i;});

                return urls.map(function(u,i){ return makeStream(u, info.title + " S" + seasonNum + "E" + episodeNum, seriesUrl, i); });
              });
          });
        });
      });
    });
  }).catch(function(err) {
    console.log("[DiziMom] Error: " + err.message);
    return [];
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
