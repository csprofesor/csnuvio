var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://sezonlukdizi.org",
  "https://sezonlukdizi.net",
  "https://sezonlukdizi.cc",
  "https://sezonlukdizi.vip",
  "https://sezonlukdizi.pro"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "SezonlukDizi";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
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
    title: label || "SezonlukDizi",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "sezonlukdizi"
  };
}

async function searchSezonlukDizi(query, base) {
  var results = [];
  try {
    var res = await fetch(base + "/diziler.asp?adi=" + encodeURIComponent(query), { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("div.afis a").each(function(i, el) {
        var href = $(el).attr("href");
        var title = $(el).find("div.description").text() || $(el).attr("title");
        if (href && title) {
          results.push({
            title: sanitizeText(title),
            url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href
          });
        }
      });
    }
  } catch (e) {}
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

async function resolveEmbed(iframeUrl, referer, label) {
  try {
    if (iframeUrl.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(iframeUrl, referer);
      if (m3u8) {
        return makeStream(m3u8, (label || "VidMoly") + " [SezonlukDizi]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": iframeUrl
        });
      }
    } else if (iframeUrl.indexOf("pixeldrain") !== -1 || iframeUrl.indexOf("/u/") !== -1) {
      var pid = iframeUrl.split("/u/").pop().split("?")[0].split("/")[0];
      if (pid) {
        return makeStream("https://pixeldrain.com/api/file/" + pid + "?download", (label || "PixelDrain") + " [SezonlukDizi]", "1080p", false, {
          "User-Agent": USER_AGENT,
          "Referer": iframeUrl
        });
      }
    } else {
      var res = await fetch(iframeUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Referer": referer || BASE_URL + "/"
        }
      });
      if (res.ok) {
        var html = await res.text();
        var m = html.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
        if (m && m[1]) {
          return makeStream(m[1], (label || "Fast Player") + " [SezonlukDizi]", "1080p", true, {
            "User-Agent": USER_AGENT,
            "Referer": iframeUrl
          });
        }
        var mp4 = html.match(/player\.src\(\[\{src:\s*["']([^"']+)["']/i) || html.match(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);
        if (mp4 && mp4[1]) {
          var mp4Url = mp4[1].startsWith("http") ? mp4[1] : "https://video.sibnet.ru" + mp4[1];
          return makeStream(mp4Url, (label || "SibNet") + " [SezonlukDizi]", "720p", false, {
            "User-Agent": USER_AGENT,
            "Referer": iframeUrl
          });
        }
      }
    }
  } catch (e) {}
  return null;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === "movie") {
    return [];
  }

  var tmdb = await fetchTmdbDetails(tmdbId, mediaType);
  if (!tmdb) return [];

  var sNum = parseInt(seasonNum, 10) || 1;
  var eNum = parseInt(episodeNum, 10) || 1;

  var titlesToSearch = [tmdb.titleTr, tmdb.titleEn, tmdb.originalTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var d = 0; d < DOMAINS.length; d++) {
    var base = DOMAINS[d];
    for (var t = 0; t < titlesToSearch.length; t++) {
      var query = titlesToSearch[t];
      var searchItems = await searchSezonlukDizi(query, base);
      if (!searchItems || searchItems.length === 0) continue;

      var bestMatch = null;
      var bestScore = 999;
      var normTr = normalizeTitle(tmdb.titleTr);
      var normEn = normalizeTitle(tmdb.titleEn);

      for (var i = 0; i < searchItems.length; i++) {
        var it = searchItems[i];
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

      var epUrl = null;
      var endpoint = bestMatch.url.split("/").filter(Boolean).pop();
      try {
        var epListRes = await fetch(base + "/bolumler/" + endpoint, { headers: BASE_HEADERS });
        if (epListRes.ok) {
          var epListHtml = await epListRes.text();
          var $epL = cheerio.load(epListHtml);
          $epL("table.unstackable tbody tr").each(function(idx, el) {
            var s = parseInt($epL(el).find("td:nth-of-type(2)").text().replace(/[^0-9]/g, ""), 10);
            var e = parseInt($epL(el).find("td:nth-of-type(3)").text().replace(/[^0-9]/g, ""), 10);
            if (s === sNum && e === eNum) {
              var h = $epL(el).find("td:nth-of-type(4) a").attr("href");
              if (h) epUrl = h.startsWith("http") ? h : base + (h.startsWith("/") ? "" : "/") + h;
            }
          });
        }
      } catch (e) {}

      if (!epUrl) {
        epUrl = bestMatch.url.replace(/\/$/, "") + "/" + sNum + "-sezon-" + eNum + "-bolum.html";
      }

      var streams = [];
      try {
        var epRes = await fetch(epUrl, { headers: BASE_HEADERS });
        if (epRes.ok) {
          var epHtml = await epRes.text();
          var $ep = cheerio.load(epHtml);
          var bid = $ep("div#dilsec").attr("data-id") || $ep("[data-id]").attr("data-id");

          var aspNum = "22";
          var siteJsMatch = epHtml.match(/dataAlternatif(\d+)\.asp/);
          if (siteJsMatch) aspNum = siteJsMatch[1];

          if (bid) {
            var langs = ["1", "0"]; // 1: Altyazı, 0: Dublaj
            for (var li = 0; li < langs.length; li++) {
              var dil = langs[li];
              var dilLabel = dil === "1" ? "Altyazı" : "Dublaj";
              try {
                var altRes = await fetch(base + "/ajax/dataAlternatif" + aspNum + ".asp", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": epUrl,
                    "User-Agent": USER_AGENT
                  },
                  body: "bid=" + encodeURIComponent(bid) + "&dil=" + dil
                });
                if (altRes.ok) {
                  var altJson = await altRes.json();
                  if (altJson && altJson.status === "success" && Array.isArray(altJson.data)) {
                    for (var vi = 0; vi < altJson.data.length; vi++) {
                      var veri = altJson.data[vi];
                      var embedRes = await fetch(base + "/ajax/dataEmbed" + aspNum + ".asp", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                          "X-Requested-With": "XMLHttpRequest",
                          "Referer": epUrl,
                          "User-Agent": USER_AGENT
                        },
                        body: "id=" + encodeURIComponent(veri.id)
                      });
                      if (embedRes.ok) {
                        var embedHtml = await embedRes.text();
                        var ifrMatch = embedHtml.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                        var iframeSrc = ifrMatch ? ifrMatch[1] : null;

                        if (!iframeSrc) {
                          var fnMatch = embedHtml.match(/(vidmoly|sruby|filemoon|pixel|okru|mailru)\('([^']+)'/i);
                          if (fnMatch) {
                            var plat = fnMatch[1].toLowerCase();
                            var vidId = fnMatch[2];
                            if (plat === "vidmoly") iframeSrc = "https://vidmoly.me/embed-" + vidId + ".html";
                            else if (plat === "sruby") iframeSrc = "https://rubyvidhub.com/embed-" + vidId + ".html";
                            else if (plat === "filemoon") iframeSrc = "https://bysejikuar.com/e/" + vidId;
                            else if (plat === "pixel") iframeSrc = "https://pixeldrain.com/u/" + vidId;
                            else if (plat === "okru") iframeSrc = "https://ok.ru/videoembed/" + vidId;
                            else if (plat === "mailru") iframeSrc = "https://my.mail.ru/video/embed/" + vidId;
                          }
                        }

                        if (iframeSrc) {
                          if (iframeSrc.startsWith("//")) iframeSrc = "https:" + iframeSrc;
                          var s = await resolveEmbed(iframeSrc, epUrl, dilLabel + " - " + veri.baslik);
                          if (s) streams.push(s);
                        }
                      }
                    }
                  }
                }
              } catch (errAlt) {}
            }
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
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
