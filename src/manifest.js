const { getUserConfig } = require('./services/userStore');

async function getManifest(userUuid) {
  if (!userUuid) {
    return {
      id: "racconmendations",
      version: "3.0.0",
      name: "Racconmendations",
      description: "🎬 Personalized recommendations based on your Stremio library",
      logo: "https://racconmendations.vercel.app/raccoon-icon.png",
      background: "https://racconmendations.vercel.app/background.jpg",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["sim_", "rec_", "pop_", "seed_"],
      behaviorHints: {
        configurable: true,
        configurationRequired: true
      }
    };
  }
  
  try {
    const config = await getUserConfig(userUuid);
    
    if (!config || (!config.selected_movies?.length && !config.selected_series?.length)) {
      return {
        id: "racconmendations",
        version: "3.0.0",
        name: "Racconmendations",
        description: "⚙️ Configure your addon first at /configure",
        logo: "https://racconmendations.vercel.app/raccoon-icon.png",
        resources: ["catalog"],
        types: ["movie", "series"],
        catalogs: [
          { type: "movie", id: `setup-${userUuid}`, name: "⚙️ Configure Racconmendations" }
        ],
        idPrefixes: ["sim_", "rec_", "pop_", "seed_"],
        behaviorHints: {
          configurable: true,
          configurationRequired: true
        }
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
    
    const catalogs = [];
    
    for (const movie of randomMovies) {
      if (movie.id && movie.title) {
        catalogs.push({
          type: "movie",
          id: `sim-${movie.id}-${userUuid}`,
          name: `🎬 ${movie.title}`
        });
      }
    }
    
    for (const series of randomSeries) {
      if (series.id && series.title) {
        catalogs.push({
          type: "series",
          id: `sim-${series.id}-${userUuid}`,
          name: `📺 ${series.title}`
        });
      }
    }
    
    // Catalogo "Potrebbero piacerti anche"
    catalogs.push({
      type: "movie",
      id: `rec-${userUuid}`,
      name: "✨ Ti potrebbe piacere"
    });
    
    return {
      id: "racconmendations",
      version: "3.0.0",
      name: "Racconmendations",
      description: "🎬 Personalized recommendations based on your Stremio library",
      logo: "https://racconmendations.vercel.app/raccoon-icon.png",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: catalogs,
      idPrefixes: ["sim_", "rec_", "pop_", "seed_"],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };
    
  } catch (error) {
    console.error('Error generating manifest:', error);
    return {
      id: "racconmendations",
      version: "3.0.0",
      name: "Racconmendations",
      description: "Error loading recommendations",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["sim_", "rec_", "pop_", "seed_"]
    };
  }
}

module.exports = { getManifest };
