var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://dizimag.club",
  "https://dizimag.co"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "DiziMag";
var TMDB_API_KEY = "8265bd1679663a7ea12ac168da84d2e8";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
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
    var resTr = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=tr-TR");
    var dataTr = resTr.ok ? await resTr.json() : null;

    var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=en-US");
    var dataEn = resEn.ok ? await resEn.json() : null;

    var titleTr = dataTr ? (dataTr.title || dataTr.name) : "";
    var titleEn = dataEn ? (dataEn.title || dataEn.name) : "";
    var origTitle = (dataEn && dataEn.original_title) || (dataEn && dataEn.original_name) || "";
    var date = (dataEn && (dataEn.release_date || dataEn.first_air_date)) || "";
    var year = date ? parseInt(date.substring(0, 4), 10) : null;

    return {
      titleTr: titleTr || titleEn || origTitle,
      titleEn: titleEn || origTitle || titleTr,
      originalTitle: origTitle,
      year: year
    };
  } catch (e) {
    return null;
  }
}

function makeStream(url, label, quality, isHls, headers) {
  return {
    name: PROVIDER_NAME,
    title: label || "DiziMag",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "dizimag"
  };
}

async function searchDiziMag(query, base) {
  var results = [];
  try {
    var res = await fetch(base + "/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": base + "/",
        "User-Agent": USER_AGENT
      },
      body: "query=" + encodeURIComponent(query)
    });
    if (res.ok) {
      var text = await res.text();
      var html = text;
      try {
        var json = JSON.parse(text);
        if (json && json.theme) html = json.theme;
      } catch (errJson) {}

      var $ = cheerio.load(html);
      $("a[href*='/dizi/'], a[href*='/film/']").each(function(i, el) {
        var href = $(el).attr("href");
        var rawTitle = $(el).text().trim() || $(el).attr("title") || "";
        var title = sanitizeText(rawTitle.split("\n")[0]);
        if (href && title) {
          results.push({
            title: title,
            url: href.startsWith("http") ? href : base + (href.startsWith("/") ? "" : "/") + href,
            isMovie: href.indexOf("/film/") !== -1
          });
        }
      });
    }
  } catch (e) {}

  if (results.length === 0) {
    try {
      var htmlRes = await fetch(base + "/?s=" + encodeURIComponent(query), { headers: BASE_HEADERS });
      if (htmlRes.ok) {
        var sHtml = await htmlRes.text();
        var $s = cheerio.load(sHtml);
        $s("a[href*='/dizi/'], a[href*='/film/']").each(function(i, el) {
          var href = $s(el).attr("href");
          var rawTitle = $s(el).text().trim() || $s(el).attr("title") || "";
          var title = sanitizeText(rawTitle.split("\n")[0]);
          if (href && title) {
            results.push({
              title: title,
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

async function resolveDiziMagPlayer(targetUrl, referer) {
  var streams = [];
  try {
    if (targetUrl.indexOf("pichive") !== -1 || targetUrl.indexOf("dplayer") !== -1) {
      streams.push(makeStream(targetUrl, "DiziMag Player", "1080p", false, {
        "User-Agent": USER_AGENT,
        "Referer": referer || BASE_URL + "/"
      }));
      return streams;
    }

    if (targetUrl.indexOf("vidmoly") !== -1) {
      var m3u8 = await resolveVidMoly(targetUrl, referer);
      if (m3u8) {
        streams.push(makeStream(m3u8, "VidMoly [DiziMag]", "1080p", true, {
          "User-Agent": USER_AGENT,
          "Referer": targetUrl
        }));
      }
      return streams;
    }

    var fetchUrl = targetUrl;
    var fetchReferer = referer || BASE_URL + "/";
    if (targetUrl.indexOf("yabancidizim.com/rplayer/") !== -1) {
      var hash = targetUrl.substring(targetUrl.indexOf("rplayer/") + 8).replace(".html", "");
      if (hash) {
        fetchUrl = "https://ksdpictures.site/ch/" + hash + "?st=ZGl6aW1hZy5vbmU=";
        fetchReferer = "https://yabancidizim.com/";
      }
    }

    var res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": fetchReferer
      }
    });
    if (!res.ok) return streams;
    var html = await res.text();

    var videoMatch = html.match(/videoFile\s*=\s*["']([^"']+)["']/i) ||
                     html.match(/var\s+SOURCE\s*=\s*["']([^"']+)["']/i) ||
                     html.match(/file:\s*["']([^"']+)["']/i) ||
                     html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);

    if (videoMatch && videoMatch[1]) {
      var srcUrl = videoMatch[1].replace(/\\\//g, "/");
      var isHls = srcUrl.indexOf(".m3u8") !== -1;
      streams.push(makeStream(srcUrl, "DiziMag Player", "1080p", isHls, {
        "User-Agent": USER_AGENT,
        "Referer": fetchUrl
      }));
    }
  } catch (e) {}
  return streams;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
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
      var searchItems = await searchDiziMag(query, base);
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

      var baseHeaders = {
        "User-Agent": USER_AGENT,
        "Referer": base + "/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
      };

      var targetPageUrl = bestMatch.url;
      if (isTv) {
        try {
          var seriesRes = await fetch(bestMatch.url, { headers: baseHeaders });
          if (seriesRes.ok) {
            var sHtml = await seriesRes.text();
            var $s = cheerio.load(sHtml);
            var epCandidate = null;

            $s("a[href]").each(function(idx, el) {
              var h = $s(el).attr("href");
              if (!h) return;
              var seMatch = h.match(/\/s(\d+)e(\d+)/i);
              if (seMatch) {
                if (parseInt(seMatch[1], 10) === sNum && parseInt(seMatch[2], 10) === eNum) {
                  epCandidate = h.startsWith("http") ? h : base + (h.startsWith("/") ? "" : "/") + h;
                }
              }
            });

            if (epCandidate) {
              targetPageUrl = epCandidate;
            } else {
              var cleanSlug = bestMatch.url.split("/dizi/").pop().replace(/\/$/, "");
              targetPageUrl = base + "/dizi/dizi/" + cleanSlug + "/s" + sNum + "e" + eNum;
            }
          }
        } catch (e) {}
      }

      var streams = [];
      try {
        var pageRes = await fetch(targetPageUrl, { headers: baseHeaders });
        if (pageRes.ok) {
          var pHtml = await pageRes.text();
          var $p = cheerio.load(pHtml);

          var iframes = [];
          $p("iframe[src]").each(function(idx, el) {
            var src = $p(el).attr("src");
            if (src && iframes.indexOf(src) === -1) iframes.push(src);
          });

          $p("[data-frame], [data-hhs], [data-video], [data-src], [data-url]").each(function(idx, el) {
            var attrs = ["data-frame", "data-hhs", "data-video", "data-src", "data-url"];
            for (var a = 0; a < attrs.length; a++) {
              var val = $p(el).attr(attrs[a]);
              if (val && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("//"))) {
                if (iframes.indexOf(val) === -1) iframes.push(val);
              }
            }
          });

          for (var ii = 0; ii < iframes.length; ii++) {
            var ifr = iframes[ii];
            if (ifr.startsWith("//")) ifr = "https:" + ifr;
            else if (ifr.startsWith("/")) ifr = base + ifr;

            var resS = await resolveDiziMagPlayer(ifr, targetPageUrl);
            for (var si = 0; si < resS.length; si++) {
              streams.push(resS[si]);
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
