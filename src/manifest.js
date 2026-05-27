const { getUserConfig } = require('./services/userStore');

const EXTRA = [{ name: 'skip', isRequired: false }];

// ─── Rotazione deterministica: cambia ogni 2 giorni ──────────────────────────
// Stessa rotazione per tutti gli utenti nello stesso periodo → cache efficiente
function getRotationSeed() {
  return Math.floor(Date.now() / (2 * 24 * 60 * 60 * 1000));
}

function deterministicShuffle(arr, seed) {
  const a = [...arr];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 17), 0x45d9f3b) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getManifest(userUuid) {
  if (!userUuid) {
    return {
      id: 'com.raccoonmendations',
      version: '3.0.0',
      name: 'Raccoonmendations',
      description: 'Personalized Stremio recommendations. Visit /configure to set up.',
      resources: ['catalog'],
      types: ['movie', 'series'],
      catalogs: [],
      idPrefixes: ['tt', 'tmdb:'],
      behaviorHints: { configurable: true, configurationRequired: true }
    };
  }

  try {
    const config = await getUserConfig(userUuid);

    if (!config || (!config.selected_movies?.length && !config.selected_series?.length)) {
      return {
        id: 'com.raccoonmendations',
        version: '3.0.0',
        name: 'Raccoonmendations',
        description: 'Please configure your addon at /configure',
        resources: ['catalog'],
        types: ['movie', 'series'],
        catalogs: [
          { type: 'movie',  id: `setup-movie-${userUuid}`,  name: '⚙️ Configure Raccoonmendations', extra: EXTRA },
          { type: 'series', id: `setup-series-${userUuid}`, name: '⚙️ Configure Raccoonmendations', extra: EXTRA }
        ],
        idPrefixes: ['tt', 'tmdb:'],
        behaviorHints: { configurable: true, configurationRequired: false }
      };
    }

    const selectedMovies = config.selected_movies || [];
    const selectedSeries = config.selected_series || [];
    const seed = getRotationSeed();

    // 2 film e 2 serie casuali, ruotano ogni 2 giorni
    const rotatedMovies = deterministicShuffle(selectedMovies, seed).slice(0, 2);
    const rotatedSeries = deterministicShuffle(selectedSeries, seed + 1).slice(0, 2);

    const catalogs = [];

    for (const movie of rotatedMovies) {
      if (movie.id && movie.title) {
        catalogs.push({
          type: 'movie',
          id: `sim-movie-${movie.id}-${userUuid}`,
          name: `🎬 Similar to ${movie.title}`,
          extra: EXTRA
        });
      }
    }

    for (const series of rotatedSeries) {
      if (series.id && series.title) {
        catalogs.push({
          type: 'series',
          id: `sim-series-${series.id}-${userUuid}`,
          name: `📺 Similar to ${series.title}`,
          extra: EXTRA
        });
      }
    }

    // Raccomandazioni personalizzate
    // BUGFIX: "rec-movie" non "rec-movies" → parts[1]="movie" ✓
    catalogs.push({
      type: 'movie',
      id: `rec-movie-${userUuid}`,
      name: '✨ You might also like',
      extra: EXTRA
    });
    catalogs.push({
      type: 'series',
      id: `rec-series-${userUuid}`,
      name: '✨ You might also like',
      extra: EXTRA
    });

    return {
      id: 'com.raccoonmendations',
      version: '3.0.0',
      name: 'Raccoonmendations',
      description: 'Personalized recommendations based on your Stremio library',
      resources: ['catalog'],
      types: ['movie', 'series'],
      catalogs,
      idPrefixes: ['tt', 'tmdb:'],
      behaviorHints: { configurable: true, configurationRequired: false }
    };

  } catch (error) {
    console.error('getManifest error:', error);
    return {
      id: 'com.raccoonmendations',
      version: '3.0.0',
      name: 'Raccoonmendations',
      description: 'Error loading manifest',
      resources: ['catalog'],
      types: ['movie', 'series'],
      catalogs: [],
      idPrefixes: ['tt', 'tmdb:'],
      behaviorHints: { configurable: true, configurationRequired: false }
    };
  }
}

module.exports = { getManifest };
