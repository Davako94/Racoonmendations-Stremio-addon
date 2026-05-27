const { getUserConfig } = require('./services/userStore');

const EXTRA = [{ name: 'skip', isRequired: false }];

function getRotationSeed() {
  return Math.floor(Date.now() / (2 * 24 * 60 * 60 * 1000));
}

function deterministicShuffle(arr, seed) {
  if (!arr || !arr.length) return [];
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
  console.log(`📄 getManifest chiamato con UUID: ${userUuid || 'nessuno'}`);
  
  if (!userUuid) {
    return {
      id: 'com.raccoonmendations',
      version: '3.0.0',
      name: 'Raccoonmendations',
      description: 'Personalized Stremio recommendations. Visit /configure to set up.',
      resources: ['catalog'],
      types: ['movie', 'series', 'anime'],
      catalogs: [
        { type: 'movie', id: 'setup-movie', name: '⚙️ Configure Raccoonmendations', extra: EXTRA },
        { type: 'series', id: 'setup-series', name: '⚙️ Configure Raccoonmendations', extra: EXTRA },
        { type: 'anime', id: 'setup-anime', name: '⚙️ Configure Raccoonmendations', extra: EXTRA }
      ],
      idPrefixes: ['tt', 'tmdb:'],
      behaviorHints: { configurable: true, configurationRequired: true }
    };
  }

  try {
    const config = await getUserConfig(userUuid);
    console.log(`📄 Config: movies=${config?.selected_movies?.length || 0}, series=${config?.selected_series?.length || 0}, anime=${config?.selected_anime?.length || 0}`);

    if (!config || (!config.selected_movies?.length && !config.selected_series?.length && !config.selected_anime?.length)) {
      return {
        id: 'com.raccoonmendations',
        version: '3.0.0',
        name: 'Raccoonmendations',
        description: 'Please configure your addon at /configure',
        resources: ['catalog'],
        types: ['movie', 'series', 'anime'],
        catalogs: [
          { type: 'movie', id: `setup-movie-${userUuid}`, name: '⚙️ Configure - Select movies', extra: EXTRA },
          { type: 'series', id: `setup-series-${userUuid}`, name: '⚙️ Configure - Select series', extra: EXTRA },
          { type: 'anime', id: `setup-anime-${userUuid}`, name: '⚙️ Configure - Select anime', extra: EXTRA }
        ],
        idPrefixes: ['tt', 'tmdb:'],
        behaviorHints: { configurable: true, configurationRequired: false }
      };
    }

    const selectedMovies = config.selected_movies || [];
    const selectedSeries = config.selected_series || [];
    const selectedAnime = config.selected_anime || [];
    const seed = getRotationSeed();

    const rotatedMovies = deterministicShuffle(selectedMovies, seed).slice(0, 3);
    const rotatedSeries = deterministicShuffle(selectedSeries, seed + 1).slice(0, 3);
    const rotatedAnime = deterministicShuffle(selectedAnime, seed + 2).slice(0, 3);

    const catalogs = [];

    // Similar to Movies
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

    // Similar to Series
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

    // Similar to Anime
    for (const anime of rotatedAnime) {
      if (anime.id && anime.title) {
        catalogs.push({
          type: 'anime',
          id: `sim-anime-${anime.id}-${userUuid}`,
          name: `🍥 Similar to ${anime.title}`,
          extra: EXTRA
        });
      }
    }

    // Recommendations
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
    
    catalogs.push({
      type: 'anime',
      id: `rec-anime-${userUuid}`,
      name: '🍥 You might also like',
      extra: EXTRA
    });

    console.log(`📄 Manifest generato con ${catalogs.length} cataloghi`);

    return {
      id: 'com.raccoonmendations',
      version: '3.0.0',
      name: 'Raccoonmendations',
      description: 'Personalized recommendations based on your Stremio library',
      resources: ['catalog'],
      types: ['movie', 'series', 'anime'],
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
      types: ['movie', 'series', 'anime'],
      catalogs: [
        { type: 'movie', id: `error-movie-${userUuid}`, name: '❌ Error - Please reconfigure', extra: EXTRA },
        { type: 'series', id: `error-series-${userUuid}`, name: '❌ Error - Please reconfigure', extra: EXTRA },
        { type: 'anime', id: `error-anime-${userUuid}`, name: '❌ Error - Please reconfigure', extra: EXTRA }
      ],
      idPrefixes: ['tt', 'tmdb:'],
      behaviorHints: { configurable: true, configurationRequired: false }
    };
  }
}

module.exports = { getManifest };
