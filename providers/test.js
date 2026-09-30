// CSNuvio Test Provider
// Purpose: verify that the repository manifest and JavaScript provider
// are loaded and executed correctly by Nuvio.
//
// This uses a public test HLS stream. It does not scrape a movie/TV site.

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log("[CSNuvio Test] getStreams:", tmdbId, mediaType, seasonNum, episodeNum);

  return Promise.resolve([
    {
      name: "CSNuvio Test",
      title: "Public HLS Test Stream",
      url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      quality: "720p",
      type: "hls",
      headers: {}
    }
  ]);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
