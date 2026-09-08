const path = require("path");

const [providerId, tmdbId, mediaType = "movie", season, episode] =
  process.argv.slice(2);

if (!providerId || !tmdbId) {
  console.error(
    "Usage: npm run test:provider -- <providerId> <tmdbId> [movie|tv] [season] [episode]"
  );
  process.exit(1);
}

const provider = require(
  path.join(__dirname, "..", "providers", `${providerId}.js`)
);

Promise.resolve(
  provider.getStreams(
    tmdbId,
    mediaType,
    season ? Number(season) : undefined,
    episode ? Number(episode) : undefined
  )
)
  .then(streams => {
    if (!Array.isArray(streams)) {
      throw new Error("getStreams() must return an array");
    }

    console.log(JSON.stringify(streams, null, 2));
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
