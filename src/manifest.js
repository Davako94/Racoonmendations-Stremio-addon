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
      idPrefixes: ["tt", "tmdb"]
    };
  }

  try {
    const config = await getUserConfig(userUuid);
    
    if (!config) {
      return {
        id: "raccoonmendations",
        version: "3.0.0",
        name: "Raccoonmendations",
        description: "Configure your addon first at /configure",
        resources: ["catalog"],
        types: ["movie", "series"],
        catalogs: [],
        idPrefixes: ["tt", "tmdb"]
      };
    }

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
          { 
            type: "movie", 
            id: `setup_${userUuid}`, 
            name: "⚙️ Configure Raccoonmendations",
            extra: [{ name: "skip", isRequired: false }]
          },
          { 
            type: "series", 
            id: `setup_${userUuid}`, 
            name: "⚙️ Configure Raccoonmendations",
            extra: [{ name: "skip", isRequired: false }]
          }
        ],
        idPrefixes: ["tt", "tmdb"]
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
    
    // Cataloghi dinamici Film
    for (const movie of randomMovies) {
      if (movie.id && movie.title) {
        catalogs.push({
          type: "movie",
          id: `similar_${movie.id}_${userUuid}`,
          name: `🎬 Similar to ${movie.title}`,
          extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
        });
      }
    }
    
    // Cataloghi dinamici Serie
    for (const series of randomSeries) {
      if (series.id && series.title) {
        catalogs.push({
          type: "series",
          id: `similar_${series.id}_${userUuid}`,
          name: `📺 Similar to ${series.title}`,
          extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
        });
      }
    }
    
    // Cataloghi stabili generici
    catalogs.push({
      type: "movie",
      id: `rec_${userUuid}`,
      name: "✨ You might also like",
      extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
    });
    
    catalogs.push({
      type: "series",
      id: `rec_${userUuid}`,
      name: "✨ You might also like",
      extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
    });
    
    return {
      id: "raccoonmendations",
      version: "3.0.0",
      name: "Raccoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: catalogs,
      idPrefixes: ["tt", "tmdb"]
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
      idPrefixes: ["tt", "tmdb"]
    };
  }
}

module.exports = { getManifest };
