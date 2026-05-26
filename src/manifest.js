function getManifest(userUuid = null) {
  const baseCatalogs = [
    { type: "movie", id: "rec-movies", name: "🎬 Simili ai tuoi film" },
    { type: "series", id: "rec-series", name: "📺 Simili alle tue serie" },
    { type: "anime", id: "rec-anime", name: "🍥 Simili ai tuoi anime" }
  ];
  
  // Se abbiamo un UUID, lo aggiungiamo all'ID del catalogo per personalizzazione
  const catalogs = userUuid 
    ? baseCatalogs.map(c => ({ ...c, id: `${c.id}-${userUuid}` }))
    : baseCatalogs;
  
  return {
    id: "stremio-rec-addon",
    version: "2.0.0",
    name: "Smart Recommendations",
    description: "Raccomandazioni personalizzate basate sulla tua libreria Stremio",
    resources: ["catalog"],
    types: ["movie", "series", "anime"],
    catalogs: catalogs,
    idPrefixes: ["rec_"]
  };
}

module.exports = { getManifest };
