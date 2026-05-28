const { getUserConfig } = require('./services/userStore');

async function getManifest(userUuid) {
  // ============================================================
  // 1) MANIFEST SENZA UUID → deve essere comunque valido
  //    (AIOMetadata richiede almeno 1 catalogo valido)
  // ============================================================
  if (!userUuid) {
    return {
      id: "raccoonmendations",
      version: "3.1.0",
      name: "Raccoonmendations",
      description: "Configure your addon first at /configure",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [
        {
          type: "movie",
          id: "setup",
          name: "⚙️ Configure Raccoonmendations",
          extra: [{ name: "skip", isRequired: false }]
        },
        {
          type: "series",
          id: "setup",
          name: "⚙️ Configure Raccoonmendations",
          extra: [{ name: "skip", isRequired: false }]
        }
      ],
      idPrefixes: ["tt", "tmdb"]
    };
  }

  // ============================================================
  // 2) MANIFEST CON UUID → carica configurazione utente
  // ============================================================
  try {
    const config = await getUserConfig(userUuid);

    // Nessuna configurazione trovata → manifest valido ma "vuoto"
    if (!config) {
      return {
        id: "raccoonmendations",
        version: "3.1.0",
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

    const selectedMovies = config.selectedMovies || config.selected_movies || [];
    const selectedSeries = config.selectedSeries || config.selected_series || [];

    // Nessun contenuto selezionato → manifest valido ma "setup"
    if (selectedMovies.length === 0 && selectedSeries.length === 0) {
      return {
        id: "raccoonmendations",
        version: "3.1.0",
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

    // ============================================================
    // 3) MANIFEST COMPLETO CON CATALOGHI DINAMICI
    // ============================================================

    // Shuffle helper
    const shuffle = arr => arr.sort(() => Math.random() - 0.5);

    const randomMovies = shuffle([...selectedMovies]).slice(0, 3);
    const randomSeries = shuffle([...selectedSeries]).slice(0, 3);

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

    // Cataloghi generici
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
      version: "3.1.0",
      name: "Raccoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs,
      idPrefixes: ["tt", "tmdb"]
    };

  } catch (error) {
    console.error("Manifest generation error:", error);
    return {
      id: "raccoonmendations",
      version: "3.1.0",
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
