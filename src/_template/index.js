async function getStreams(tmdbId, mediaType, season, episode) {
  console.log("[provider]", { tmdbId, mediaType, season, episode });

  // Return:
  // [{
  //   name: "Provider",
  //   title: "1080p",
  //   url: "https://example.com/video.m3u8",
  //   quality: "1080p",
  //   headers: {}
  // }]

  return [];
}

module.exports = { getStreams };
