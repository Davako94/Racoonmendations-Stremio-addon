// Questo file ora è un endpoint che genera il manifest DINAMICO
// In base all'UUID, recupera i seed e crea un catalogo per ognuno

async function getManifest(userUuid, req) {
  if (!userUuid) {
    // Manifest base senza UUID (nessun catalogo personale)
    return {
      id: "racoonmendations",
      version: "3.0.0",
      name: "Racoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["sim_", "rec_", "pop_", "seed_"]
    };
  }
  
  // Recupera i seed dell'utente dal database
  const { getUserConfig } = require('./services/userStore');
  const config = await getUserConfig(userUuid);
  
  if (!config) {
    return {
      id: "racoonmendations",
      version: "3.0.0",
      name: "Racoonmendations",
      description: "Configure your addon first at /configure",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["sim_", "rec_", "pop_", "seed_"]
    };
  }
  
  const selectedMovies = config.selected_movies || [];
  const selectedSeries = config.selected_series || [];
  
  // Crea cataloghi per ogni film selezionato (max 5 casuali)
  const shuffledMovies = [...selectedMovies];
  for (let i = shuffledMovies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledMovies[i], shuffledMovies[j]] = [shuffledMovies[j], shuffledMovies[i]];
  }
  const randomMovies = shuffledMovies.slice(0, 5);
  
  // Crea cataloghi per ogni serie selezionata (max 5 casuali)
  const shuffledSeries = [...selectedSeries];
  for (let i = shuffledSeries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledSeries[i], shuffledSeries[j]] = [shuffledSeries[j], shuffledSeries[i]];
  }
  const randomSeries = shuffledSeries.slice(0, 5);
  
  // Costruisci la lista dei cataloghi
  const catalogs = [];
  
  // Cataloghi per film
  for (const movie of randomMovies) {
    catalogs.push({
      type: "movie",
      id: `sim-movie-${movie.id}-${userUuid}`,
      name: `🎬 Simili a ${movie.title}`
    });
  }
  
  // Cataloghi per serie
  for (const series of randomSeries) {
    catalogs.push({
      type: "series",
      id: `sim-series-${series.id}-${userUuid}`,
      name: `📺 Simili a ${series.title}`
    });
  }
  
  // Catalogo "Potrebbero piacerti anche"
  catalogs.push({
    type: "movie",
    id: `rec-movies-${userUuid}`,
    name: "✨ Potrebbero piacerti anche"
  });
  catalogs.push({
    type: "series",
    id: `rec-series-${userUuid}`,
    name: "✨ Potrebbero piacerti anche"
  });
  
  return {
    id: "racoonmendations",
    version: "3.0.0",
    name: "Racoonmendations",
    description: "Personalized recommendations based on your Stremio library",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: catalogs,
    idPrefixes: ["sim_", "rec_", "pop_", "seed_"]
  };
}

module.exports = { getManifest };
