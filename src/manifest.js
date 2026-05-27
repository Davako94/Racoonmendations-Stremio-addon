const { getUserConfig } = require('./services/userStore');

async function getManifest(userUuid) {
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
  
  try {
    // Recupera i seed dell'utente dal database
    const config = await getUserConfig(userUuid);
    
    if (!config || (!config.selected_movies?.length && !config.selected_series?.length)) {
      return {
        id: "racoonmendations",
        version: "3.0.0",
        name: "Racoonmendations",
        description: "Configure your addon first at /configure",
        resources: ["catalog"],
        types: ["movie", "series"],
        catalogs: [
          { type: "movie", id: `setup-movie-${userUuid}`, name: "⚙️ Configure Racoonmendations" },
          { type: "series", id: `setup-series-${userUuid}`, name: "⚙️ Configure Racoonmendations" }
        ],
        idPrefixes: ["sim_", "rec_", "pop_", "seed_"]
      };
    }
    
    const selectedMovies = config.selected_movies || [];
    const selectedSeries = config.selected_series || [];
    
    // Seleziona 5 film casuali
    const shuffledMovies = [...selectedMovies];
    for (let i = shuffledMovies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledMovies[i], shuffledMovies[j]] = [shuffledMovies[j], shuffledMovies[i]];
    }
    const randomMovies = shuffledMovies.slice(0, 5);
    
    // Seleziona 5 serie casuali
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
      if (movie.id && movie.title) {
        catalogs.push({
          type: "movie",
          id: `sim-movie-${movie.id}-${userUuid}`,
          name: `🎬 Simili a ${movie.title}`
        });
      }
    }
    
    // Cataloghi per serie
    for (const series of randomSeries) {
      if (series.id && series.title) {
        catalogs.push({
          type: "series",
          id: `sim-series-${series.id}-${userUuid}`,
          name: `📺 Simili a ${series.title}`
        });
      }
    }
    
    // Catalogo "Potrebbero piacerti anche" per film
    catalogs.push({
      type: "movie",
      id: `rec-movies-${userUuid}`,
      name: "✨ Potrebbero piacerti anche"
    });
    
    // Catalogo "Potrebbero piacerti anche" per serie
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
    
  } catch (error) {
    console.error('Error generating manifest:', error);
    return {
      id: "racoonmendations",
      version: "3.0.0",
      name: "Racoonmendations",
      description: "Error loading recommendations",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["sim_", "rec_", "pop_", "seed_"]
    };
  }
}

module.exports = { getManifest };
