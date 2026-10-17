var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://yabancidizi.fun",
  "https://yabancidizi.org",
  "https://yabancidizi.news",
  "https://yabancidizi.pw",
  "https://yabancidizi.co"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "YabanciDizi";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Ch-Ua": "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": "\"Windows\"",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1"
};

function sanitizeText(str) {
  if (!str) return "";
  return str.replace(/&#(\d+);/g, function(match, dec) {
    return String.fromCharCode(dec);
  }).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").trim();
}

function normalizeTitle(str) {
  if (!str) return "";
  return str.toLowerCase()
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(s1, s2) {
  var a = s1 || "";
  var b = s2 || "";
  var matrix = [];
  for (var i = 0; i <= b.length; i++) matrix[i] = [i];
  for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (var i = 1; i <= b.length; i++) {
    for (var j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

async function fetchTmdbDetails(tmdbId, mediaType) {
  try {
    var type = mediaType === "movie" ? "movie" : "tv";
    var trUrl = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=tr-TR";
    var enUrl = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=en-US";

    var pTr = fetch(trUrl).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
    var pEn = fetch(enUrl).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

    var res = await Promise.all([pTr, pEn]);
    var dataTr = res[0] || {};
    var dataEn = res[1] || {};

    var titleTr = dataTr.title || dataTr.name || dataEn.title || dataEn.name || "";
    var titleEn = dataEn.title || dataEn.name || dataTr.title || dataTr.name || "";
    var origTitle = dataEn.original_title || dataEn.original_name || dataTr.original_title || dataTr.original_name || "";
    var date = dataEn.release_date || dataEn.first_air_date || dataTr.release_date || dataTr.first_air_date || "";
    var year = date ? parseInt(date.substring(0, 4), 10) : null;

    return {
      titleTr: titleTr || titleEn || origTitle,
      titleEn: titleEn || titleTr || origTitle,
      originalTitle: origTitle || titleTr || titleEn,
      year: year
    };
  } catch (e) {
    return null;
  }
}

function makeStream(url, label, quality, isHls, headers) {
  return {
    name: PROVIDER_NAME,
    title: label || "YabanciDizi",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "yabancidizi"
  };
}

async function searchYabanciDizi(query, base) {
  var results = [];
  try {
    var params = new URLSearchParams();
    params.append("q", query);

    var res = await fetch(base + "/search", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": base + "/",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: params.toString()
    });
    if (res.ok) {
      var json = await res.json();
      var list = json.sonuclar || [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (it.name && it.url) {
          results.push({
            title: sanitizeText(it.name),
            url: it.url,
            isMovie: it.url.indexOf("/film/") !== -1
          });
        }
      }
    }
  } catch (e) {}

  if (results.length === 0) {
    try {
      var htmlRes = await fetch(base + "/arama?q=" + encodeURIComponent(query), { headers: BASE_HEADERS });
      if (htmlRes.ok) {
        var html = await htmlRes.text();
        var $ = cheerio.load(html);
        $("div.mofy-movbox").each(function(i, el) {
          var a = $(el).find("div.mofy-movbox-text a").first();
          var href = a.attr("href");
          var title = a.text();
          if (href && title) {
            results.push({
              title: sanitizeText(title),
              url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href,
              isMovie: href.indexOf("/film/") !== -1
            });
          }
        });
      }
    } catch (e) {}
  }
  return results;
}

async function resolveVidMoly(molyUrl, referer) {
  try {
    var res = await fetch(molyUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/"
      }
    });
    if (!res.ok) return null;
    var html = await res.text();
    var m = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) || html.match(/sources:\s*\[\s*\{\s*file:\s*["']([^"']+)["']/i);
    if (m && m[1]) return m[1];
  } catch (e) {}
  return null;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  var tmdb = await fetchTmdbDetails(tmdbId, mediaType);
  if (!tmdb) return [];

  var isTv = mediaType === "tv";
  var sNum = parseInt(seasonNum, 10) || 1;
  var eNum = parseInt(episodeNum, 10) || 1;

  var titlesToSearch = [tmdb.titleTr, tmdb.titleEn, tmdb.originalTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var d = 0; d < DOMAINS.length; d++) {
    var base = DOMAINS[d];
    for (var t = 0; t < titlesToSearch.length; t++) {
      var query = titlesToSearch[t];
      var searchItems = await searchYabanciDizi(query, base);
      if (!searchItems || searchItems.length === 0) continue;

      var bestMatch = null;
      var bestScore = 999;
      var normTr = normalizeTitle(tmdb.titleTr);
      var normEn = normalizeTitle(tmdb.titleEn);

      for (var i = 0; i < searchItems.length; i++) {
        var it = searchItems[i];
        if (isTv && it.isMovie) continue;
        if (!isTv && !it.isMovie) continue;
        var itemNorm = normalizeTitle(it.title);
        var dist = Math.min(levenshteinDistance(itemNorm, normTr), levenshteinDistance(itemNorm, normEn));
        if (itemNorm.indexOf(normTr) !== -1 || itemNorm.indexOf(normEn) !== -1) {
          dist = Math.floor(dist / 2);
        }
        if (dist < bestScore) {
          bestScore = dist;
          bestMatch = it;
        }
      }

      if (!bestMatch || bestScore > 10) continue;

      var epUrl = bestMatch.url;
      if (isTv) {
        try {
          var seriesRes = await fetch(bestMatch.url, { headers: BASE_HEADERS });
          if (seriesRes.ok) {
            var sHtml = await seriesRes.text();
            var $s = cheerio.load(sHtml);
            var epCandidate = null;

            $s("a[href*='bolum']").each(function(idx, el) {
              var h = $s(el).attr("href");
              if (!h) return;
              var sM = h.match(/(\d+)-sezon/i);
              var eM = h.match(/(\d+)-bolum/i);
              if (sM && eM && parseInt(sM[1], 10) === sNum && parseInt(eM[1], 10) === eNum) {
                epCandidate = h.startsWith("http") ? h : base + (h.startsWith("/") ? "" : "/") + h;
              }
            });

            if (epCandidate) {
              epUrl = epCandidate;
            } else {
              epUrl = bestMatch.url.replace(/\/$/, "") + "/" + sNum + "-sezon-" + eNum + "-bolum";
            }
          }
        } catch (e) {}
      }

      var streams = [];
      try {
        var epRes = await fetch(epUrl, { headers: BASE_HEADERS });
        if (epRes.ok) {
          var epHtml = await epRes.text();
          var $ep = cheerio.load(epHtml);

          var tabs = [];
          $ep("div#series-tabs a").each(function(idx, el) {
            var eid = $ep(el).attr("data-eid");
            var type = $ep(el).attr("data-type");
            if (eid) tabs.push({ eid: eid, type: type || "1" });
          });

          var ts = Date.now() - 50000;
          for (var ti = 0; ti < tabs.length; ti++) {
            var tab = tabs[ti];
            var dil = tab.type === "2" ? "Dublaj" : "Altyazı";
            try {
              var srvRes = await fetch(base + "/ajax/service", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                  "X-Requested-With": "XMLHttpRequest",
                  "Referer": epUrl,
                  "User-Agent": USER_AGENT,
                  "Cookie": "udys=" + ts
                },
                body: "lang=" + encodeURIComponent(tab.type) + "&episode=" + encodeURIComponent(tab.eid) + "&type=langTab"
              });

              if (srvRes.ok) {
                var srvJson = await srvRes.json();
                if (srvJson && srvJson.data) {
                  var $srv = cheerio.load(srvJson.data);
                  var items = $srv("div.item").toArray();

                  for (var ii = 0; ii < items.length; ii++) {
                    var itEl = $srv(items[ii]);
                    var name = itEl.text();
                    var dataLink = itEl.attr("data-link");
                    if (!dataLink) continue;
                    var encLink = dataLink.replace(/\//g, "_").replace(/\+/g, "-");

                    if (name.indexOf("VidMoly") !== -1) {
                      var vdmRes = await fetch(base + "/api/moly/" + encLink, {
                        headers: { "User-Agent": USER_AGENT, "Referer": base + "/", "Cookie": "udys=" + ts }
                      });
                      if (vdmRes.ok) {
                        var vdmHtml = await vdmRes.text();
                        var ifrM = vdmHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                        if (ifrM && ifrM[1]) {
                          var molyM3u8 = await resolveVidMoly(ifrM[1], base + "/");
                          if (molyM3u8) {
                            streams.push(makeStream(molyM3u8, dil + " - VidMoly [YabanciDizi]", "1080p", true, {
                              "User-Agent": USER_AGENT,
                              "Referer": ifrM[1]
                            }));
                          }
                        }
                      }
                    } else if (name.indexOf("Mac") !== -1) {
                      var macRes = await fetch(base + "/api/drive/" + encLink, {
                        headers: { "User-Agent": USER_AGENT, "Referer": base + "/", "Cookie": "udys=" + ts }
                      });
                      if (macRes.ok) {
                        var macHtml = await macRes.text();
                        var subIfr = macHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                        if (subIfr && subIfr[1]) {
                          var frameRes = await fetch(subIfr[1], {
                            headers: { "User-Agent": USER_AGENT, "Referer": base + "/" }
                          });
                          if (frameRes.ok) {
                            var frameHtml = await frameRes.text();
                            var m3u8M = frameHtml.match(/file:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i) ||
                                        frameHtml.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                            if (m3u8M && m3u8M[1]) {
                              streams.push(makeStream(m3u8M[1], dil + " - Fast [YabanciDizi]", "1080p", true, {
                                "User-Agent": USER_AGENT,
                                "Referer": subIfr[1]
                              }));
                            }
                          }
                        }
                      }
                    } else if (name.indexOf("Okru") !== -1) {
                      var okRes = await fetch(base + "/api/ruplay/" + encLink, {
                        headers: { "User-Agent": USER_AGENT, "Referer": base + "/", "Cookie": "udys=" + ts }
                      });
                      if (okRes.ok) {
                        var okHtml = await okRes.text();
                        var okIfr = okHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                        if (okIfr && okIfr[1]) {
                          streams.push(makeStream(okIfr[1], dil + " - OK.ru [YabanciDizi]", "720p", false, {
                            "User-Agent": USER_AGENT,
                            "Referer": base + "/"
                          }));
                        }
                      }
                    }
                  }
                }
              }
            } catch (errTab) {}
          }
        }
      } catch (err) {}

      if (streams.length > 0) {
        return streams;
      }
    }
  }

  return [];
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
