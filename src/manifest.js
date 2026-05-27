// Manifest STATICO - definisce l'identità e le capacità dell'add-on per Stremio
function getManifest() {
  return {
    id: "com.racconmendations.addon", // Consigliata la notazione reverse-DNS per evitare conflitti in Stremio
    version: "3.0.0",
    name: "Racconmendations",
    description: "🎬 Personalized recommendations based on your Stremio library",
    resources: ["catalog"],
    types: ["movie", "series", "anime"], // Aggiunto 'anime' per massima compatibilità
    catalogs: [
      { 
        type: "movie", 
        id: "raccon-movies", 
        name: "🎬 Raccon Movies",
        extra: [{ name: "search", required: false }]
      },
      { 
        type: "series", 
        id: "raccon-series", 
        name: "📺 Raccon Series",
        extra: [{ name: "search", required: false }]
      },
      { 
        // Gli anime spesso ricadono in "series", ma diamo loro un ID e un nome dedicati
        type: "series", 
        id: "raccon-anime", 
        name: "🌸 Raccon Anime",
        extra: [{ name: "search", required: false }]
      }
    ],
    idPrefixes: ["tt", "tmdb"]
  };
}

module.exports = { getManifest };
