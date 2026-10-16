"use strict";

var cheerio = require("cheerio-without-node-native");

var DOMAINS = [
  "https://belgeselx.com"
];
var BASE_URL = DOMAINS[0];
var PROVIDER_NAME = "BelgeselX";

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
  }).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/<[^>]+>/g, "").trim();
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
    title: label || "BelgeselX",
    url: url,
    quality: quality || "1080p",
    type: isHls ? "hls" : "mp4",
    headers: headers || {
      "User-Agent": USER_AGENT,
      "Referer": BASE_URL + "/"
    },
    provider: "belgeselx"
  };
}

async function searchBelgeselX(query) {
  var results = [];
  try {
    var cx = "016376594590146270301:iwmy65ijgrm";
    var tokenRes = await fetch("https://cse.google.com/cse.js?cx=" + cx);
    if (tokenRes.ok) {
      var tokenText = await tokenRes.text();
      var cseLibVersion = tokenText.match(/cselibVersion": "([^"]+)"/)?.[1] || "dc6f600a0d4404e5";
      var cseToken = tokenText.match(/cse_token": "([^"]+)"/)?.[1];

      if (cseToken) {
        var searchUrl = "https://cse.google.com/cse/element/v1?rsz=filtered_cse&num=10&hl=tr&source=gcsc&cselibv=" + cseLibVersion + "&cx=" + cx + "&q=" + encodeURIComponent(query) + "&safe=off&cse_tok=" + cseToken + "&callback=google.search.cse.api9969&rurl=https%3A%2F%2Fbelgeselx.com%2F";
        var sRes = await fetch(searchUrl, { headers: { "User-Agent": USER_AGENT } });
        if (sRes.ok) {
          var sText = await sRes.text();
          var jsonStr = sText.substring(sText.indexOf("{"), sText.lastIndexOf("}") + 1);
          if (jsonStr) {
            var json = JSON.parse(jsonStr);
            var items = json.results || [];
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              var rawUrl = item.formattedUrl || item.clicktrackUrl || "";
              var titleNoFormatting = item.titleNoFormatting || item.title || "";

              var urlMatch = rawUrl.match(/https:\/\/belgeselx\.com\/[^\s&"']+/);
              if (!urlMatch && item.clicktrackUrl) {
                urlMatch = item.clicktrackUrl.match(/&q=(https:\/\/belgeselx\.com\/[^\s&"']+)/);
                if (urlMatch) urlMatch[0] = decodeURIComponent(urlMatch[1]);
              }

              if (urlMatch && urlMatch[0]) {
                var cleanUrl = urlMatch[0].replace(/<[^>]+>/g, "").trim();
                if (cleanUrl.indexOf("/belgeseldizi/") !== -1 || cleanUrl.indexOf("/belgesel/") !== -1) {
                  results.push({
                    title: sanitizeText(titleNoFormatting.replace(/\s*-\s*BelgeselX.*/i, "").replace(/\s*İzle.*/i, "")),
                    url: cleanUrl
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {}

  if (results.length === 0) {
    try {
      var categories = ["tarih-belgeselleri", "turk-tarihi-belgeselleri", "bilim-belgeselleri", "doga-belgeselleri"];
      for (var c = 0; c < categories.length; c++) {
        var catUrl = BASE_URL + "/ajax_konukat.php?url=" + categories[c] + "&page=1";
        var res = await fetch(catUrl, { headers: BASE_HEADERS });
        if (res.ok) {
          var html = await res.text();
          var $ = cheerio.load(html);
          $("a.px-card").each(function(_, el) {
            var href = $(el).attr("href");
            var title = $(el).find(".px-card-title").text().trim();
            if (href && title) {
              results.push({
                title: sanitizeText(title),
                url: href.startsWith("http") ? href : BASE_URL + href
              });
            }
          });
        }
      }
    } catch (errCat) {}
  }

  return results;
}

async function resolveOkRu(okUrl) {
  var streams = [];
  try {
    var res = await fetch(okUrl, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      var html = await res.text();
      var m = html.match(/data-options=["']([^"']+)["']/);
      if (m) {
        var jsonStr = m[1].replace(/&quot;/g, '"');
        var json = JSON.parse(jsonStr);
        var videos = json.flashvars?.metadata?.videos || [];
        for (var i = 0; i < videos.length; i++) {
          var v = videos[i];
          if (v && v.url) {
            var qual = v.name === "full" ? "1080p" : (v.name === "hd" ? "720p" : "480p");
            streams.push(makeStream(v.url, "OK.ru - " + qual, qual, false, {
              "User-Agent": USER_AGENT,
              "Referer": "https://odnoklassniki.ru/"
            }));
          }
        }
      }
    }
  } catch (e) {}
  return streams;
}

async function resolvePlayerEndpoint(pUrl, docUrl) {
  var streams = [];
  try {
    var pRes = await fetch(pUrl, { headers: { "User-Agent": USER_AGENT, "Referer": docUrl } });
    if (!pRes.ok) return streams;
    var pHtml = await pRes.text();
    var $p = cheerio.load(pHtml);

    var iframe = $p("iframe").attr("src");
    if (iframe) {
      var okMatch = iframe.match(/(\d{10,})/);
      if (okMatch) {
        var okUrl = "https://odnoklassniki.ru/videoembed/" + okMatch[1];
        var okStreams = await resolveOkRu(okUrl);
        for (var s = 0; s < okStreams.length; s++) {
          streams.push(okStreams[s]);
        }
      } else if (iframe.indexOf("dailymotion.com") !== -1) {
        streams.push(makeStream(iframe, "Dailymotion Player", "720p", false, {
          "User-Agent": USER_AGENT,
          "Referer": docUrl
        }));
      }
    }

    var m3u8s = pHtml.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'>]*/gi) || [];
    for (var m = 0; m < m3u8s.length; m++) {
      var directUrl = m3u8s[m];
      if (directUrl.indexOf("cid=") === -1 && directUrl.indexOf("default-user") === -1) {
        streams.push(makeStream(directUrl, "BelgeselX Stream", "1080p", directUrl.indexOf(".m3u8") !== -1, {
          "User-Agent": USER_AGENT,
          "Referer": docUrl
        }));
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
    var searchItems = await searchBelgeselX(query);
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

    var docUrl = bestMatch.url;
    try {
      var dRes = await fetch(docUrl, { headers: BASE_HEADERS });
      if (dRes.ok) {
        var dHtml = await dRes.text();
        var $d = cheerio.load(dHtml);

        var epCard = $d("a.px-ep-card, a.px-ep-row").first();
        var onClick = epCard.attr("onclick") || "";
        var epId = onClick.match(/\(\s*['"]?(\d+)['"]?\s*\)/)?.[1];
        if (!epId) {
          var script = $d("script").toArray().map(function(s) { return $d(s).html(); }).find(function(s) { return s && s.indexOf("bolumId") !== -1; });
          epId = script ? script.match(/bolumId\s*:\s*(\d+)/)?.[1] : null;
        }

        if (epId) {
          var playerEndpoints = [
            BASE_URL + "/video/data/new1.php?id=" + epId + "&sira=2",
            BASE_URL + "/video/data/new2.php?id=" + epId + "&sira=2",
            BASE_URL + "/video/data/new3.php?id=" + epId + "&sira=2",
            BASE_URL + "/video/data/new4.php?id=" + epId + "&sira=1",
            BASE_URL + "/video/data/new5.php?id=" + epId + "&sira=1"
          ];

          var streams = [];
          for (var pei = 0; pei < playerEndpoints.length; pei++) {
            var resStreams = await resolvePlayerEndpoint(playerEndpoints[pei], docUrl);
            for (var rsi = 0; rsi < resStreams.length; rsi++) {
              resStreams[rsi].title = bestMatch.title + " • Türkçe Dublaj (" + (resStreams[rsi].quality || "1080p") + ")" + (rsi > 0 ? " #" + (rsi + 1) : "");
              streams.push(resStreams[rsi]);
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
