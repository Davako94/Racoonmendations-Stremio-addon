const { getUserConfig } = require('./services/userStore');
const crypto = require('crypto');

function normalizeBaseUrl(value) {
  if (!value) return '';
  return String(value).replace(/\/+$|\/+(?=\?)/g, '');
}

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

async function getManifest(userUuid, baseUrl = process.env.ADDON_BASE_URL || 'https://raccoonmendations-stremio-addon.vercel.app') {
  baseUrl = normalizeBaseUrl(baseUrl);
  // ============================================================
  // 1) MANIFEST SENZA UUID → AIOMetadata richiede cataloghi validi
  // ============================================================
  if (!userUuid) {
    return {
      id: "raccoonmendations",
      version: "3.2.0",
      name: "Raccoonmendations",
      description: "Configure your addon first at /configure",
      logo: `${baseUrl}/static/logo.png`,
      background: `${baseUrl}/static/cover.png`,
      resources: ["catalog", "meta"],
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
        logo: `${baseUrl}/static/logo.png`,
        background: `${baseUrl}/static/cover.png`,
        resources: ["catalog", "meta"],
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
        logo: `${baseUrl}/static/logo.png`,
        background: `${baseUrl}/static/cover.png`,
        resources: ["catalog", "meta"],
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
      logo: `${baseUrl}/static/logo.png`,
      background: `${baseUrl}/static/cover.png`,
      resources: ["catalog", "meta"],
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
      logo: `${baseUrl}/static/logo.png`,
      background: `${baseUrl}/static/cover.png`,
      resources: ["catalog", "meta"],
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

module.exports = { getManifest, getPublicManifest };

// ============================================================
// PUBLIC MANIFEST - Hourly rotating demo for aggregators
// ============================================================

async function getPublicManifest(baseUrl = process.env.ADDON_BASE_URL || 'https://raccoonmendations-stremio-addon.vercel.app') {
  baseUrl = normalizeBaseUrl(baseUrl);
  
  // Demo popular titles for public access (will rotate hourly)
  const demoMovies = [
    { id: 550, title: "Fight Club" },
    { id: 278, title: "The Shawshank Redemption" },
    { id: 238, title: "The Godfather" },
    { id: 240, title: "The Godfather Part II" },
    { id: 424, title: "Schindler's List" },
    { id: 129, title: "Spirited Away" },
    { id: 680, title: "Pulp Fiction" },
    { id: 634649, title: "Spider-Man: Across the Spider-Verse" },
    { id: 569094, title: "Spider-Man: Beyond the Spider-Verse" },
    { id: 315635, title: "Mad Max: Fury Road" },
    { id: 157336, title: "Interstellar" },
    { id: 11, title: "Star Wars" },
    { id: 24, title: "Kill Bill: Vol. 1" },
    { id: 343668, title: "Dune" }
  ];

  const demoSeries = [
    { id: 1399, title: "Game of Thrones" },
    { id: 1396, title: "Breaking Bad" },
    { id: 1668, title: "Friends" },
    { id: 4057, title: "The Office" },
    { id: 37854, title: "Stranger Things" },
    { id: 78316, title: "The Last of Us" },
    { id: 1402, title: "The Wire" },
    { id: 2734, title: "The Office (UK)" },
    { id: 85271, title: "Wednesday" },
    { id: 69050, title: "Succession" }
  ];

  // Use fixed seed for public (all users see same rotation at same time)
  const hourSeed = Math.floor(Date.now() / 3600000);
  
  // Rotate to 5 movies and 5 series every hour
  const rotatedMovies = sampleRandom(demoMovies, 5, hourSeed);
  const rotatedSeries = sampleRandom(demoSeries, 5, hourSeed + 1);

  console.log(`📡 Public manifest: ${rotatedMovies.length} demo movies, ${rotatedSeries.length} demo series`);

  const catalogs = [];

  // Dynamic catalogs for movies
  for (const movie of rotatedMovies) {
    if (movie.id && movie.title) {
      catalogs.push({
        type: "movie",
        id: `similar_${movie.id}_public`,
        name: `🎬 Similar to ${movie.title}`,
        extra: [
          { name: "skip", isRequired: false },
          { name: "search", isRequired: false }
        ]
      });
    }
  }

  // Dynamic catalogs for series
  for (const series of rotatedSeries) {
    if (series.id && series.title) {
      catalogs.push({
        type: "series",
        id: `similar_${series.id}_public`,
        name: `📺 Similar to ${series.title}`,
        extra: [
          { name: "skip", isRequired: false },
          { name: "search", isRequired: false }
        ]
      });
    }
  }

  // Add generic catalogs
  catalogs.push({
    type: "movie",
    id: "rec_public",
    name: "✨ Popular Movies",
    extra: [
      { name: "skip", isRequired: false },
      { name: "search", isRequired: false }
    ]
  });

  catalogs.push({
    type: "series",
    id: "rec_public",
    name: "✨ Popular Series",
    extra: [
      { name: "skip", isRequired: false },
      { name: "search", isRequired: false }
    ]
  });

  return {
    id: "raccoonmendations",
    version: "3.2.0",
    name: "Raccoonmendations",
    description: "Popular recommendations powered by TMDB - Install addon to personalize",
    logo: `${baseUrl}/static/logo.png`,
    background: `${baseUrl}/static/logo.png`,
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    catalogs: catalogs,
    idPrefixes: ["tt", "tmdb:"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}
