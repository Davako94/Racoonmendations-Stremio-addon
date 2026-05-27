// src/manifest.js

const { getUserConfig } = require('./services/userStore');

async function getManifest(userUuid) {

  if (!userUuid) {

    return {
      id: 'raccoonmendations',
      version: '3.1.0',

      name: 'Raccoonmendations',

      description:
        'Personalized recommendations based on your library',

      resources: [
        'catalog',
        'meta'
      ],

      types: [
        'movie',
        'series'
      ],

      behaviorHints: {
        configurable: true,
        configurationRequired: false
      },

      catalogs: [],

      idPrefixes: ['tt']
    };
  }

  try {

    const config =
      await getUserConfig(userUuid);

    if (!config) {

      return {
        id: 'raccoonmendations',
        version: '3.1.0',

        name: 'Raccoonmendations',

        description:
          'Configure addon first',

        resources: [
          'catalog',
          'meta'
        ],

        types: [
          'movie',
          'series'
        ],

        behaviorHints: {
          configurable: true,
          configurationRequired: false
        },

        catalogs: [],

        idPrefixes: ['tt']
      };
    }

    const selectedMovies =
      config.selected_movies || [];

    const selectedSeries =
      config.selected_series || [];

    const catalogs = [];

    const randomMovies =
      selectedMovies
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

    const randomSeries =
      selectedSeries
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

    for (const movie of randomMovies) {

      if (!movie.id || !movie.title) continue;

      catalogs.push({
        type: 'movie',
        id: `sim-movie-${movie.id}-${userUuid}`,
        name: `🎬 Similar to ${movie.title}`
      });
    }

    for (const series of randomSeries) {

      if (!series.id || !series.title) continue;

      catalogs.push({
        type: 'series',
        id: `sim-series-${series.id}-${userUuid}`,
        name: `📺 Similar to ${series.title}`
      });
    }

    catalogs.push({
      type: 'movie',
      id: `rec-movies-${userUuid}`,
      name: '✨ Recommended Movies'
    });

    catalogs.push({
      type: 'series',
      id: `rec-series-${userUuid}`,
      name: '✨ Recommended Series'
    });

    return {

      id: 'raccoonmendations',

      version: '3.1.0',

      name: 'Raccoonmendations',

      description:
        'Personalized recommendations based on your library',

      resources: [
        'catalog',
        'meta'
      ],

      types: [
        'movie',
        'series'
      ],

      behaviorHints: {
        configurable: true,
        configurationRequired: false
      },

      catalogs,

      idPrefixes: ['tt']
    };

  } catch (err) {

    console.error('Manifest error:', err);

    return {
      id: 'raccoonmendations',
      version: '3.1.0',

      name: 'Raccoonmendations',

      description: 'Error',

      resources: [
        'catalog',
        'meta'
      ],

      types: [
        'movie',
        'series'
      ],

      catalogs: [],

      idPrefixes: ['tt']
    };
  }
}

module.exports = {
  getManifest
};
