function getManifest() {
  return {
    id: "stremio-rec-addon",
    version: "2.0.0",
    name: "Smart Recommendations",
    description: "Raccomandazioni basate sulla tua libreria Stremio (reale import) e continue watching",
    resources: ["catalog"],
    types: ["movie", "series", "anime"],
    catalogs: [
      { type: "movie", id: "rec-movies", name: "🎬 Simili ai tuoi film" },
      { type: "series", id: "rec-series", name: "📺 Simili alle tue serie" },
      { type: "anime", id: "rec-anime", name: "🍥 Simili ai tuoi anime" }
    ],
    idPrefixes: ["rec_"]
  };
}

module.exports = { getManifest };
