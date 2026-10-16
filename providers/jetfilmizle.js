"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://jetfilmizle.now",
  "https://jetfilmizle.co"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "JetFilmizle";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var BASE_HEADERS = {
  "User-Agent": USER_AGENT,
  "Referer": BASE_URL + "/",
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

function makeStream(url, label, quality, isHls, headers) {
  return {
    name: PROVIDER_NAME,
    title: label || "JetFilmizle",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "jetfilmizle"
  };
}

async function searchJetFilm(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/arama?q=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("div.film-card, article").each(function(_, el) {
        var a = $(el).find("a").first();
        var href = a.attr("href");
        var title = $(el).find(".card-title a, h2, h3").text().trim() || a.attr("title");
        if (href && title) {
          results.push({
            title: sanitizeText(title.split("\n")[0].replace(/\s*izle$/i, "")),
            url: href.startsWith("http") ? href : BASE_URL + href
          });
        }
      });
    }
  } catch (e) {}
  return results;
}

async function resolveVideoPark(iframeUrl) {
  var streams = [];
  try {
    var pRes = await fetch(iframeUrl, { headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" } });
    if (!pRes.ok) return streams;
    var pHtml = await pRes.text();

    var pubMatch = pHtml.match(/const\s+PUB_ID\s*=\s*["']([^"']+)["']/);
    var pubId = pubMatch ? pubMatch[1] : null;

    var videoMatch = pHtml.match(/const\s+VIDEO_ID\s*=\s*["']([^"']+)["']/);
    var videoId = videoMatch ? videoMatch[1] : null;

    var publisherMatch = pHtml.match(/const\s+PUBLISHER_ID\s*=\s*["']([^"']+)["']/);
    var publisherId = publisherMatch ? publisherMatch[1] : null;

    var workerMatch = pHtml.match(/const\s+WORKER_URL\s*=\s*["']([^"']+)["']/);
    var workerUrl = workerMatch ? workerMatch[1] : "https://dplayer.erikkalinina1994.workers.dev";

    if (pubId) {
      var apiUrl = workerUrl + "/api/stream?pubId=" + encodeURIComponent(pubId) + "&title=" + encodeURIComponent(videoId || "Video");
      if (publisherId) apiUrl += "&publisherId=" + encodeURIComponent(publisherId);

      var apiRes = await fetch(apiUrl, { headers: { "User-Agent": USER_AGENT, "Referer": "https://videopark.top/" } });
      if (apiRes.ok) {
        var data = await apiRes.json();
        var fileUrl = data.hlsSource?.file || (data.mp4Sources && data.mp4Sources[0]?.file) || (data.sources && data.sources[0]?.file);
        if (fileUrl) {
          streams.push(makeStream(fileUrl, "VideoPark Player", "1080p", fileUrl.indexOf(".m3u8") !== -1 || fileUrl.indexOf("/m/") !== -1, {
            "User-Agent": USER_AGENT,
            "Referer": "https://videopark.top/"
          }));
        }
      }
    }
  } catch (e) {}
  return streams;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var resTr = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=tr-TR").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=en-US").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

  var titleTr = resTr ? (resTr.title || resTr.name) : "";
  var titleEn = resEn ? (resEn.title || resEn.name) : "";
  var origTitle = (resEn && resEn.original_title) || (resEn && resEn.original_name) || "";

  var titlesToSearch = [titleTr, titleEn, origTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  for (var t = 0; t < titlesToSearch.length; t++) {
    var query = titlesToSearch[t];
    var searchItems = await searchJetFilm(query);
    if (!searchItems || searchItems.length === 0) continue;

    var bestMatch = null;
    var bestScore = 999;
    var normTr = normalizeTitle(titleTr);
    var normEn = normalizeTitle(titleEn);

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

    var targetUrl = bestMatch.url;
    try {
      var mRes = await fetch(targetUrl, { headers: BASE_HEADERS });
      var cookie = mRes.headers.get("set-cookie") || "";

      if (mRes.ok) {
        var mHtml = await mRes.text();
        var $m = cheerio.load(mHtml);
        var filmId = $m("input[name=film_id]").val();

        if (filmId) {
          var playerTypes = ["dublaj", "altyazili"];
          var streams = [];

          for (var pi = 0; pi < playerTypes.length; pi++) {
            var pType = playerTypes[pi];
            var params = new URLSearchParams();
            params.append("film_id", filmId);
            params.append("source_index", "0");
            params.append("player_type", pType);

            var postRes = await fetch(BASE_URL + "/jetplayer", {
              method: "POST",
              headers: {
                "User-Agent": USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": targetUrl,
                "Cookie": cookie
              },
              body: params.toString()
            });

            if (postRes.ok) {
              var pHtml = await postRes.text();
              var $p = cheerio.load(pHtml);
              var iframeSrc = $p("iframe").attr("src");

              if (iframeSrc) {
                var fullIframe = iframeSrc.startsWith("//") ? "https:" + iframeSrc : iframeSrc;
                if (fullIframe.indexOf("videopark") !== -1) {
                  var pStreams = await resolveVideoPark(fullIframe);
                  for (var psi = 0; psi < pStreams.length; psi++) {
                    pStreams[psi].title = titleTr + " • " + (pType === "dublaj" ? "Türkçe Dublaj" : "Türkçe Altyazılı") + " (" + (pStreams[psi].quality || "1080p") + ")";
                    streams.push(pStreams[psi]);
                  }
                } else {
                  streams.push(makeStream(fullIframe, titleTr + " • " + (pType === "dublaj" ? "Türkçe Dublaj" : "Türkçe Altyazılı") + " (1080p)", "1080p", fullIframe.indexOf(".m3u8") !== -1, {
                    "User-Agent": USER_AGENT,
                    "Referer": targetUrl
                  }));
                }
              }
            }
          }

          if (streams.length > 0) {
            return streams;
          }
        }
      }
    } catch (e) {}
  }

  return [];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
