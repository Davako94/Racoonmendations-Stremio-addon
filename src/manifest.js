const { getUserConfig } = require('./services/userStore');
const crypto = require('crypto');

function getHourlySeed(userUuid) {
  const hourIndex = Math.floor(Date.now() / 3600000);
  const hash = crypto.createHash('sha256').update(`${userUuid}:${hourIndex}`).digest();
  return hash.readUInt32LE(0);
}

function sampleRandom(items, count, seed) {
  const result = [...items];
  if (typeof seed === 'number') {
    let state = seed >>> 0;
    const seededRandom = () => {
      state = Math.imul(state ^ (state >>> 15), 2246822519);
      state = (state + Math.imul(state ^ (state >>> 7), 3266489917)) >>> 0;
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
  } else {
    for (let i = result.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
  }
  return result.slice(0, Math.min(count, result.length));
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

    // Seleziona una rotazione casuale stabile per ora basata su UUID utente.
    const hourSeed = getHourlySeed(userUuid);
    const rotatedSeeds = {
      movies: sampleRandom(selectedMovies, 5, hourSeed),
      series: sampleRandom(selectedSeries, 5, hourSeed + 1)
    };
    console.log(`🔄 Hourly rotation for ${userUuid}: ${rotatedSeeds.movies.length} movie seeds, ${rotatedSeeds.series.length} series seeds`);

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
