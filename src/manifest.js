const { getUserConfig } = require('./services/userStore');

async function getManifest(userUuid) {
  if (!userUuid) {
    return {
      id: "raccoonmendations",
      version: "3.0.0",
      name: "Raccoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["tt", "tmdb:"]
    };
  }

  try {
    const config = await getUserConfig(userUuid);
    
    // Gestione di sicurezza se il config non esiste nel DB
    if (!config) {
      return {
        id: "raccoonmendations",
        version: "3.0.0",
        name: "Raccoonmendations",
        description: "Configure your addon first at /configure",
        resources: ["catalog"],
        types: ["movie", "series"],
        catalogs: [],
        idPrefixes: ["tt", "tmdb:"]
      };
    }

    // Supporta sia camelCase (usato in save-config) che snake_case per retrocompatibilità
    const selectedMovies = config.selectedMovies || config.selected_movies || [];
    const selectedSeries = config.selectedSeries || config.selected_series || [];
    
    if (selectedMovies.length === 0 && selectedSeries.length === 0) {
      return {
        id: "raccoonmendations",
        version: "3.0.0",
        name: "Raccoonmendations",
        description: "Configure your addon first at /configure",
        resources: ["catalog"],
        types: ["movie", "series"],
        catalogs: [
          { type: "movie", id: `setup-${userUuid}`, name: "⚙️ Configure Raccoonmendations" },
          { type: "series", id: `setup-${userUuid}`, name: "⚙️ Configure Raccoonmendations" }
        ],
        idPrefixes: ["tt", "tmdb:"]
      };
    }
    
    // Seleziona 3 film casuali
    const shuffledMovies = [...selectedMovies];
    for (let i = shuffledMovies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledMovies[i], shuffledMovies[j]] = [shuffledMovies[j], shuffledMovies[i]];
    }
    const randomMovies = shuffledMovies.slice(0, 3);
    
    // Seleziona 3 serie casuali
    const shuffledSeries = [...selectedSeries];
    for (let i = shuffledSeries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledSeries[i], shuffledSeries[j]] = [shuffledSeries[j], shuffledSeries[i]];
    }
    const randomSeries = shuffledSeries.slice(0, 3);
    
    const catalogs = [];
    
    for (const movie of randomMovies) {
      if (movie.id && movie.title) {
        catalogs.push({
          type: "movie",
          id: `similar--${movie.id}--${userUuid}`,
          name: `🎬 Similar to ${movie.title}`
        });
      }
    }
    
    for (const series of randomSeries) {
      if (series.id && series.title) {
        catalogs.push({
          type: "series",
          id: `similar--${series.id}--${userUuid}`,
          name: `📺 Similar to ${series.title}`
        });
      }
    }
    
    catalogs.push({
      type: "movie",
      id: `rec-${userUuid}`,
      name: "✨ You might also like"
    });
    
    catalogs.push({
      type: "series",
      id: `rec-${userUuid}`,
      name: "✨ You might also like"
    });
    
    return {
      id: "raccoonmendations",
      version: "3.0.0",
      name: "Raccoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: catalogs,
      idPrefixes: ["tt", "tmdb:"]
    };
    
  } catch (error) {
    console.error('Error generating manifest:', error);
    return {
      id: "raccoonmendations",
      version: "3.0.0",
      name: "Raccoonmendations",
      description: "Error loading recommendations",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["tt", "tmdb:"]
    };
  }
}

module.exports = { getManifest };
