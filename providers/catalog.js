"use strict";

var cheerio = require("cheerio-without-node-native");

var PROVIDER_NAME = "CSNuvio Ana Sayfa Kataloğu";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function sanitizeText(str) {
  if (!str) return "";
  return str.replace(/&#(\d+);/g, function(match, dec) {
    return String.fromCharCode(dec);
  }).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").trim();
}

async function getHdcItems(page) {
  var p = page || 1;
  var url = "https://hdfilmcehennemiv4.com" + (p > 1 ? "/sayfa/" + p + "/" : "/");
  try {
    var res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    var html = await res.text();
    var $ = cheerio.load(html);
    var items = [];
    $("a[href*='.html']").each(function(_, el) {
      var href = $(el).attr("href");
      var img = $(el).find("img").first();
      var title = $(el).text().trim() || img.attr("alt") || $(el).attr("title");
      var poster = img.attr("data-src") || img.attr("src");
      if (href && title && !items.some(function(i) { return i.url === href; })) {
        var cleanTitle = sanitizeText(title.replace(/\s*(?:İzle|izle|HD|1080p|Türkçe Dublaj|Altyazılı).*$/gi, ""));
        if (cleanTitle) {
          items.push({
            title: cleanTitle,
            url: href.startsWith("http") ? href : "https://hdfilmcehennemiv4.com" + href,
            posterUrl: poster ? (poster.startsWith("//") ? "https:" + poster : (poster.startsWith("http") ? poster : "https://hdfilmcehennemiv4.com" + poster)) : null,
            type: "movie"
          });
        }
      }
    });
    return items;
  } catch (e) {
    return [];
  }
}

async function getDizillaItems(page) {
  var p = page || 1;
  var url = "https://dizilla.now" + (p > 1 ? "/diziler?sayfa=" + p : "/");
  try {
    var res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    var html = await res.text();
    var $ = cheerio.load(html);
    var items = [];
    $("a[href*='/dizi/']").each(function(_, el) {
      var href = $(el).attr("href");
      var img = $(el).find("img").first();
      var title = $(el).find("h2, h3, .title").text().trim() || img.attr("alt") || $(el).attr("title");
      var poster = img.attr("data-src") || img.attr("src");
      if (href && title && !items.some(function(i) { return i.url === href; })) {
        var cleanTitle = sanitizeText(title);
        if (cleanTitle && cleanTitle.length > 2) {
          items.push({
            title: cleanTitle,
            url: href.startsWith("http") ? href : "https://dizilla.now" + (href.startsWith("/") ? "" : "/") + href,
            posterUrl: poster ? (poster.startsWith("//") ? "https:" + poster : (poster.startsWith("http") ? poster : "https://dizilla.now" + poster)) : null,
            type: "series"
          });
        }
      }
    });
    return items;
  } catch (e) {
    return [];
  }
}

async function getSelcukItems(page) {
  var p = page || 1;
  var url = "https://selcukflix.app" + (p > 1 ? "/film-izle?page=" + p : "/");
  try {
    var res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return [];
    var html = await res.text();
    var $ = cheerio.load(html);
    var items = [];
    $("a[href*='/film/'], a[href*='/dizi/']").each(function(_, el) {
      var href = $(el).attr("href");
      var img = $(el).find("img").first();
      var title = $(el).find("h2, h3, .title").text().trim() || img.attr("alt") || $(el).attr("title");
      var poster = img.attr("data-src") || img.attr("src");
      if (href && title && !items.some(function(i) { return i.url === href; })) {
        var cleanTitle = sanitizeText(title);
        if (cleanTitle && cleanTitle.length > 2) {
          items.push({
            title: cleanTitle,
            url: href.startsWith("http") ? href : "https://selcukflix.app" + (href.startsWith("/") ? "" : "/") + href,
            posterUrl: poster ? (poster.startsWith("//") ? "https:" + poster : (poster.startsWith("http") ? poster : "https://selcukflix.app" + poster)) : null,
            type: href.indexOf("/dizi/") !== -1 ? "series" : "movie"
          });
        }
      }
    });
    return items;
  } catch (e) {
    return [];
  }
}

async function getMainPage(page, category) {
  var p = page || 1;
  var promises = [
    getHdcItems(p),
    getDizillaItems(p),
    getSelcukItems(p)
  ];

  var results = await Promise.all(promises);
  var combined = [];
  for (var i = 0; i < results.length; i++) {
    var arr = results[i] || [];
    for (var j = 0; j < arr.length; j++) {
      combined.push(arr[j]);
    }
  }
  return combined;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return [];
}

function hardCapGetStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return Promise.resolve([]);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: hardCapGetStreams,
    getMainPage: getMainPage,
    getCatalog: getMainPage
  };
} else {
  global.getStreams = hardCapGetStreams;
  global.getMainPage = getMainPage;
  global.getCatalog = getMainPage;
}
