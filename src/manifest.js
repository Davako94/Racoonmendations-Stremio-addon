const { getUserConfig } = require('./services/userStore');

// ─── Extra standard per tutti i cataloghi (paginazione + AIOMetadata) ─────────
const EXTRA_SUPPORTED = [
  { name: 'skip', isRequired: false }
];

async function getManifest(userUuid) {
  // ── Manifest base senza UUID ──────────────────────────────────────────────
  if (!userUuid) {
    return {
      id: 'com.racoonmendations',
      version: '3.0.0',
      name: 'Racoonmendations',
      description: 'Personalized recommendations based on your Stremio library. Visit /configure to set up.',
      logo: 'https://i.imgur.com/8bLEBUn.png',
      resources: ['catalog'],
      types: ['movie', 'series'],
      catalogs: [],
      idPrefixes: ['tt', 'tmdb:'],
      behaviorHints: {
        configurable: true,
        configurationRequired: true
      }
    };
  }

  try {
    const config = await getUserConfig(userUuid);

    // ── Utente non configurato ────────────────────────────────────────────
    if (!config || (!config.selected_movies?.length && !config.selected_series?.length)) {
      return {
        id: 'com.racoonmendations',
        version: '3.0.0',
        name: 'Racoonmendations',
        description: 'Configure your addon at /configure',
        resources: ['catalog'],
        types: ['movie', 'series'],
        catalogs: [
          { type: 'movie',  id: `setup-movie-${userUuid}`,  name: '⚙️ Configure Racoonmendations', extra: EXTRA_SUPPORTED },
          { type: 'series', id: `setup-series-${userUuid}`, name: '⚙️ Configure Racoonmendations', extra: EXTRA_SUPPORTED }
        ],
        idPrefixes: ['tt', 'tmdb:'],
        behaviorHints: { configurable: true, configurationRequired: false }
      };
    }

    const selectedMovies = config.selected_movies || [];
    const selectedSeries = config.selected_series || [];

    // ── Fisher-Yates shuffle ─────────────────────────────────────────────
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const randomMovies = shuffle(selectedMovies).slice(0, 5);
    const randomSeries = shuffle(selectedSeries).slice(0, 5);

    const catalogs = [];

    // ── Cataloghi "Simili a…" per i film scelti ──────────────────────────
    for (const movie of randomMovies) {
      if (movie.id && movie.title) {
        catalogs.push({
          type: 'movie',
          // BUGFIX: "sim-movie-ID-UUID" → parts[0]=sim parts[1]=movie parts[2]=ID parts[3..]=UUID
          id: `sim-movie-${movie.id}-${userUuid}`,
          name: `🎬 Similar to ${movie.title}`,
          extra: EXTRA_SUPPORTED
        });
      }
    }

    // ── Cataloghi "Simili a…" per le serie scelte ────────────────────────
    for (const series of randomSeries) {
      if (series.id && series.title) {
        catalogs.push({
          type: 'series',
          // BUGFIX: "sim-series-ID-UUID"
          id: `sim-series-${series.id}-${userUuid}`,
          name: `📺 Similar to ${series.title}`,
          extra: EXTRA_SUPPORTED
        });
      }
    }

    // ── Catalogo raccomandazioni personalizzate film ──────────────────────
    // BUGFIX: era "rec-movies-UUID" → parts[1]="movies" ≠ "movie" → bug mediaType
    // Ora: "rec-movie-UUID" → parts[1]="movie" ✓
    catalogs.push({
      type: 'movie',
      id: `rec-movie-${userUuid}`,
      name: '✨ You might also like',
      extra: EXTRA_SUPPORTED
    });

    // ── Catalogo raccomandazioni personalizzate serie ─────────────────────
    // "rec-series-UUID" → parts[1]="series" ✓ (era già corretto)
    catalogs.push({
      type: 'series',
      id: `rec-series-${userUuid}`,
      name: '✨ You might also like',
      extra: EXTRA_SUPPORTED
    });

    return {
      id: 'com.racoonmendations',
      version: '3.0.0',
      name: 'Racoonmendations',
      description: 'Personalized recommendations based on your Stremio library',
      resources: ['catalog'],
      types: ['movie', 'series'],
      catalogs,
      idPrefixes: ['tt', 'tmdb:'],
      // ── AIOMetadata: behaviorHints necessario per installazione cataloghi ─
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    };

  } catch (error) {
    console.error('getManifest error:', error);
    return {
      id: 'com.racoonmendations',
      version: '3.0.0',
      name: 'Racoonmendations',
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
