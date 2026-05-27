function getManifest(userUuid = null) {
  return {
    id: "racoonmendations",
    version: "3.0.0",
    name: "Racoonmendations",
    description: "Personalized movie & series recommendations by Raccoon - based on your Stremio library",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: `racoon-movies-${userUuid || 'default'}`, name: "🎬 Racoonmendations Movies" },
      { type: "series", id: `racoon-series-${userUuid || 'default'}`, name: "📺 Racoonmendations Series" }
    ],
    idPrefixes: ["racoon_", "sim_", "rand_"],
    logo: "https://raw.githubusercontent.com/yourusername/stremio-rec-addon/main/racoon-icon.png"
  };
}

module.exports = { getManifest };
