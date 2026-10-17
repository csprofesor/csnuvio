"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://anizm.com.tr",
  "https://anizm.org"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "Anizm";

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
    title: label || "Anizm",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": "https://anizmplayer.com/"
    },
    provider: "anizm"
  };
}

async function searchAnizm(query) {
  var results = [];
  try {
    var searchUrl = BASE_URL + "/arama?arama=" + encodeURIComponent(query);
    var res = await fetch(searchUrl, { headers: BASE_HEADERS });
    if (res.ok) {
      var html = await res.text();
      var $ = cheerio.load(html);
      $("article.v3-catalog-card, div.searchResultItem, div.posterBlock, .v3-poster-rail").each(function(_, el) {
        var a = $(el).is("a") ? $(el) : $(el).find("a[href]").first();
        var href = a.attr("href");
        var name = $(el).find("h2, h3, h4, .v3-card-copy h3").text() || a.attr("title") || a.text();
        if (href) {
          var slug = href.split("/").filter(Boolean).pop();
          if (slug && !slug.includes("sayfa=") && !slug.includes("arama=") && !results.some(function(r) { return r.slug === slug; })) {
            results.push({
              slug: slug,
              title: sanitizeText(name.split("\n")[0])
            });
          }
        }
      });
    }
  } catch (e) {}
  return results;
}

async function resolveAnizmPlayer(playerPageUrl) {
  var streams = [];
  try {
    var pRes = await fetch(playerPageUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL + "/"
      }
    });
    if (!pRes.ok) return streams;
    var pHtml = await pRes.text();

    var allKeys = pHtml.match(/\b[a-f0-9]{32}\b/g) || [];
    for (var k = 0; k < allKeys.length; k++) {
      var key = allKeys[k];
      if (key === "00000000000000000000000000000000") continue;

      try {
        var params = new URLSearchParams();
        params.append("hash", key);
        params.append("r", BASE_URL + "/");

        var postRes = await fetch("https://anizmplayer.com/player/index.php?data=" + key + "&do=getVideo", {
          method: "POST",
          headers: {
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://anizmplayer.com",
            "Referer": "https://anizmplayer.com/video/" + key
          },
          body: params.toString()
        });

        if (postRes.ok) {
          var text = await postRes.text();
          var postData = JSON.parse(text);
          var videoUrl = postData.securedLink || postData.videoSource;
          if (videoUrl) {
            streams.push(makeStream(videoUrl, "Anizm Player", "1080p", videoUrl.indexOf(".m3u8") !== -1, {
              "User-Agent": USER_AGENT,
              "Referer": "https://anizmplayer.com/"
            }));
            break;
          }
        }
      } catch (errKey) {}
    }
  } catch (e) {}
  return streams;
}

async function _getStreamsCore(tmdbId, mediaType, seasonNum, episodeNum) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var resTr = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=tr-TR").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  var resEn = await fetch("https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=8265bd1679663a7ea12ac168da84d2e8&language=en-US").then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });

  var titleTr = resTr ? (resTr.title || resTr.name) : "";
  var titleEn = resEn ? (resEn.title || resEn.name) : "";
  var origTitle = (resEn && resEn.original_title) || (resEn && resEn.original_name) || "";

  var titlesToSearch = [titleTr, titleEn, origTitle].filter(function(v, i, self) {
    return v && self.indexOf(v) === i;
  });

  var eNum = parseInt(episodeNum, 10) || 1;

  for (var t = 0; t < titlesToSearch.length; t++) {
    var query = titlesToSearch[t];
    var searchItems = await searchAnizm(query);
    if (!searchItems || searchItems.length === 0) continue;

    var bestMatch = null;
    var bestScore = 999;
    var normTr = normalizeTitle(titleTr);
    var normEn = normalizeTitle(titleEn);

    for (var i = 0; i < searchItems.length; i++) {
      var it = searchItems[i];
      var itemNorm = normalizeTitle(it.title || it.slug);
      var dist = Math.min(levenshteinDistance(itemNorm, normTr), levenshteinDistance(itemNorm, normEn));
      if (itemNorm.indexOf(normTr) !== -1 || itemNorm.indexOf(normEn) !== -1 || it.slug.indexOf(normTr) !== -1) {
        dist = Math.floor(dist / 2);
      }
      if (dist < bestScore) {
        bestScore = dist;
        bestMatch = it;
      }
    }

    if (!bestMatch) continue;

    var epPageUrl = BASE_URL + "/" + bestMatch.slug + "-" + eNum + "-bolum";

    try {
      var epRes = await fetch(epPageUrl, { headers: BASE_HEADERS });
      if (epRes.ok) {
        var epHtml = await epRes.text();
        var $ep = cheerio.load(epHtml);

        var btn = $ep(".v3-translator-button[data-sources], button[data-sources]").first();
        var sourcesUrl = btn.attr("data-sources");
        if (!sourcesUrl) {
          sourcesUrl = $ep("button[data-sources]").attr("data-sources");
        }

        if (sourcesUrl) {
          var fullSourcesUrl = sourcesUrl.startsWith("http") ? sourcesUrl : BASE_URL + sourcesUrl;
          var srcRes = await fetch(fullSourcesUrl, {
            headers: {
              "User-Agent": USER_AGENT,
              "X-Requested-With": "XMLHttpRequest",
              "Referer": epPageUrl
            }
          });

          if (srcRes.ok) {
            var srcData = await srcRes.json();
            var videos = srcData.videos || [];
            for (var vi = 0; vi < Math.min(videos.length, 3); vi++) {
              var vidId = videos[vi].id;
              var vidInfoUrl = BASE_URL + "/video/" + vidId;
              var vidRes = await fetch(vidInfoUrl, {
                headers: {
                  "User-Agent": USER_AGENT,
                  "X-Requested-With": "XMLHttpRequest",
                  "Referer": epPageUrl
                }
              });

              if (vidRes.ok) {
                var vidData = await vidRes.json();
                var playerIframe = vidData.url;
                if (vidData.player) {
                  var $p = cheerio.load(vidData.player);
                  playerIframe = $p("iframe").attr("src") || vidData.url;
                }

                if (playerIframe) {
                  var fullPlayerUrl = playerIframe.startsWith("http") ? playerIframe : (playerIframe.startsWith("//") ? "https:" + playerIframe : BASE_URL + playerIframe);
                  var streams = await resolveAnizmPlayer(fullPlayerUrl);
                  if (streams && streams.length > 0) {
                    for (var si = 0; si < streams.length; si++) {
                      streams[si].title = titleTr + " • Türkçe Altyazılı (" + (streams[si].quality || "1080p") + ")" + (si > 0 ? " #" + (si + 1) : "");
                    }
                    return streams;
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {}
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
      setTimeout(function() { resolve([]); }, 2200);
    })
  ]);
}
