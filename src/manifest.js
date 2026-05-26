function getManifest(userUuid = null) {
  // I cataloghi ora saranno generati dinamicamente in base ai seed
  // Per ora restituiamo un manifesto base, i cataloghi verranno creati al volo
  return {
    id: "stremio-rec-addon",
    version: "3.0.0",
    name: "Smart Recommendations",
    description: "Personalized recommendations based on your favorite movies and series",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { type: "movie", id: `recommended-${userUuid || 'default'}`, name: "🎬 Recommended for You" },
      { type: "series", id: `recommended-${userUuid || 'default'}`, name: "📺 Recommended Series" }
    ],
    idPrefixes: ["rec_", "sim_"]
  };
}

module.exports = { getManifest };
