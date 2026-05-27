// Manifest STATICO - cataloghi fissi per Stremio
function getManifest() {
  return {
    id: "racconmendations",
    version: "3.0.0",
    name: "Racconmendations",
    description: "🎬 Personalized recommendations based on your Stremio library",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: "raccon-movies", name: "🎬 Racconmendations Movies" },
      { type: "series", id: "raccon-series", name: "📺 Racconmendations Series" }
    ],
    idPrefixes: ["tt", "tmdb"]
  };
}

module.exports = { getManifest };
