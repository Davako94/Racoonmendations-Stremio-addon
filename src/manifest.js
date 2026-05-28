const { getUserConfig } = require('./services/userStore');
const NodeCache = require('node-cache');

// Cache con TTL di 1 ora (3600 secondi)
const seedCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// ============================================================
// ROTAZIONE SEED DETERMINISTICA (ogni 1 ora)
// ============================================================
function rotateSeeds(movies, series, userUuid) {
  // Usa un bucket orario per cambiare i cataloghi ogni ora
  const crypto = require('crypto');
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  const seed = crypto.createHash('md5').update(`${hourBucket}:${userUuid || 'default'}`).digest('hex');
  const seedValue = parseInt(seed.substring(0, 8), 16);

  const shuffleWithSeed = (items) => {
    return [...items].sort((a, b) => {
      const hashA = parseInt(crypto.createHash('md5').update(String(a.id)).digest('hex').substring(0, 8), 16);
      const hashB = parseInt(crypto.createHash('md5').update(String(b.id)).digest('hex').substring(0, 8), 16);
      return (hashA + seedValue) - (hashB + seedValue);
    });
  };

  return {
    movies: shuffleWithSeed(movies).slice(0, 5),
    series: shuffleWithSeed(series).slice(0, 5)
  };
}

async function getManifest(userUuid) {
  // ============================================================
  // 1) MANIFEST SENZA UUID → AIOMetadata richiede cataloghi validi
  // ============================================================
  if (!userUuid) {
    return {
      id: "raccoonmendations",
      version: "3.2.0",
      name: "Raccoonmendations",
      description: "Configure your addon first at /configure",
      logo: "https://raccoonmendations-stremio-addon.vercel.app/static/logo.png",
      background: "https://raccoonmendations-stremio-addon.vercel.app/static/cover.png",
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
        idPrefixes: ["tt", "tmdb:"],
        behaviorHints: {
          configurable: true,
          configurationRequired: false
        }
    };
  }

  // ============================================================
  // 2) MANIFEST CON UUID → carica configurazione utente
  // ============================================================
  try {
    const config = await getUserConfig(userUuid);

    // Nessuna configurazione → manifest valido ma "setup"
    if (!config) {
      return {
        id: "raccoonmendations",
        version: "3.2.0",
        name: "Raccoonmendations",
        description: "Configure your addon first at /configure",
        logo: "https://raccoonmendations-stremio-addon.vercel.app/static/logo.png",
        background: "https://raccoonmendations-stremio-addon.vercel.app/static/cover.png",
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
        idPrefixes: ["tt", "tmdb:"],
        behaviorHints: {
          configurable: true,
          configurationRequired: false
        }
      };
    }

    const selectedMovies = config.selectedMovies || config.selected_movies || [];
    const selectedSeries = config.selectedSeries || config.selected_series || [];

    // Nessun contenuto selezionato → manifest valido ma "setup"
    if (selectedMovies.length === 0 && selectedSeries.length === 0) {
      return {
        id: "raccoonmendations",
        version: "3.2.0",
        name: "Raccoonmendations",
        description: "Configure your addon first at /configure",
        logo: "https://raccoonmendations-stremio-addon.vercel.app/static/logo.png",
        background: "https://raccoonmendations-stremio-addon.vercel.app/static/cover.png",
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
        idPrefixes: ["tt", "tmdb:"],
        behaviorHints: {
          configurable: true,
          configurationRequired: false
        }
      };
    }

    // ============================================================
    // 3) MANIFEST COMPLETO CON CATALOGHI DINAMICI
    // ============================================================

    // Controlla cache per i seed ruotati basati sull'ora corrente
    const cacheKey = `seeds_${userUuid}_${Math.floor(Date.now() / (1000 * 60 * 60))}`;
    let rotatedSeeds = seedCache.get(cacheKey);
    
    if (!rotatedSeeds) {
      // Genera nuovi seed ruotati per l'ora corrente
      rotatedSeeds = rotateSeeds(selectedMovies, selectedSeries, userUuid);
      seedCache.set(cacheKey, rotatedSeeds);
      console.log(`🔄 Nuovi seed ruotati per ${userUuid}: ${rotatedSeeds.movies.length} film, ${rotatedSeeds.series.length} serie`);
    } else {
      console.log(`✅ Seed dalla cache per ${userUuid}`);
    }

    const randomMovies = rotatedSeeds.movies;
    const randomSeries = rotatedSeeds.series;

    const catalogs = [];

    // Cataloghi dinamici Film
    for (const movie of randomMovies) {
      if (movie.id && movie.title) {
        catalogs.push({
          type: "movie",
          id: `similar_${movie.id}_${userUuid}`,
          name: `🎬 Similar to ${movie.title}`,
          extra: [
            { name: "skip", isRequired: false },
            { name: "search", isRequired: false }
          ]
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
          extra: [
            { name: "skip", isRequired: false },
            { name: "search", isRequired: false }
          ]
        });
      }
    }

    // Cataloghi generici
    catalogs.push({
      type: "movie",
      id: `rec_${userUuid}`,
      name: "✨ You might also like",
      extra: [
        { name: "skip", isRequired: false },
        { name: "search", isRequired: false }
      ]
    });

    catalogs.push({
      type: "series",
      id: `rec_${userUuid}`,
      name: "✨ You might also like",
      extra: [
        { name: "skip", isRequired: false },
        { name: "search", isRequired: false }
      ]
    });

    return {
      id: "raccoonmendations",
      version: "3.2.0",
      name: "Raccoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      logo: "https://raccoonmendations-stremio-addon.vercel.app/static/logo.png",
      background: "https://raccoonmendations-stremio-addon.vercel.app/static/cover.png",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs,
      idPrefixes: ["tt", "tmdb:"],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };

  } catch (error) {
    console.error("Manifest generation error:", error);
    return {
      id: "raccoonmendations",
      version: "3.2.0",
      name: "Raccoonmendations",
      description: "Error loading recommendations",
      logo: "https://raccoonmendations-stremio-addon.vercel.app/static/logo.png",
      background: "https://raccoonmendations-stremio-addon.vercel.app/static/cover.png",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["tt", "tmdb:"],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };
  }
}

module.exports = { getManifest };
