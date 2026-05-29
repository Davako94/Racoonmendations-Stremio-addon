/**
 * src/manifest.js
 * Genera il manifest dell'addon Stremio Raccoonmendations.
 * Configurato per essere statico e compatibile al 100% con AIOMetadata,
 * delegando la rotazione e la dinamicità alla chiamata del catalogo.
 */

const { getUserConfig } = require('./services/userStore');

function normalizeBaseUrl(value) {
  if (!value) return '';
  return String(value).replace(/\/+$/g, '').replace(/\/+(?=\?)/g, '');
}

async function getManifest(userUuid, baseUrl) {
  baseUrl = normalizeBaseUrl(baseUrl);
  
  const resources = [
    {
      name: "catalog",
      types: ["movie", "series"],
      idPrefixes: []
    },
    {
      name: "meta",
      types: ["movie", "series"],
      idPrefixes: ["tt", "tmdb:"]
    }
  ];

  const types = ["movie", "series"];
  const idPrefixes = ["tt", "tmdb:"];
  const behaviorHints = {
    configurable: true,
    configurationRequired: false
  };

  try {
    const config = await getUserConfig(userUuid);

    // ============================================================
    // CASO A: NESSUNA CONFIGURAZIONE O CONTENUTI SELEZIONATI VUOTI
    // ============================================================
    const selectedMovies = config ? (config.selectedMovies || config.selected_movies || []) : [];
    const selectedSeries = config ? (config.selectedSeries || config.selected_series || []) : [];

    if (!config || (selectedMovies.length === 0 && selectedSeries.length === 0)) {
      return {
        id: "com.raccoonmendations.stremio",
        version: "3.2.0",
        name: "Raccoonmendations",
        description: "Configure your addon first at /configure",
        logo: `${baseUrl}/static/logo.png`,
        background: `${baseUrl}/static/cover.png`,
        resources,
        types,
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
        idPrefixes,
        behaviorHints
      };
    }

    // ============================================================
    // CASO B: MANIFEST CONFIGURATO COMPATIBILE (STRUTTURA FISSA)
    // ============================================================
    const catalogs = [
      {
        type: "movie",
        id: `raccoon_similar_movies_${userUuid}`,
        name: "🎬 Raccoonmendations - Consigliati per Te",
        extra: [
          { name: "skip", isRequired: false },
          { name: "search", isRequired: false }
        ]
      },
      {
        type: "series",
        id: `raccoon_similar_series_${userUuid}`,
        name: "📺 Raccoonmendations - Consigliate per Te",
        extra: [
          { name: "skip", isRequired: false },
          { name: "search", isRequired: false }
        ]
      },
      {
        type: "movie",
        id: `rec_${userUuid}`,
        name: "✨ Potrebbe piacerti anche (Film)",
        extra: [
          { name: "skip", isRequired: false },
          { name: "search", isRequired: false }
        ]
      },
      {
        type: "series",
        id: `rec_${userUuid}`,
        name: "✨ Potrebbe piacerti anche (Serie)",
        extra: [
          { name: "skip", isRequired: false },
          { name: "search", isRequired: false }
        ]
      }
    ];

    return {
      id: "com.raccoonmendations.stremio",
      version: "3.2.0",
      name: "Raccoonmendations",
      description: "Personalized recommendations based on your Stremio library",
      logo: `${baseUrl}/static/logo.png`,
      background: `${baseUrl}/static/cover.png`,
      resources,
      types,
      catalogs,
      idPrefixes,
      behaviorHints
    };

  } catch (error) {
    console.error("Manifest generation error:", error);
    return {
      id: "com.raccoonmendations.stremio",
      version: "3.2.0",
      name: "Raccoonmendations",
      description: "Error loading recommendations",
      logo: `${baseUrl}/static/logo.png`,
      background: `${baseUrl}/static/cover.png`,
      resources,
      types,
      catalogs: [],
      idPrefixes,
      behaviorHints
    };
  }
}

module.exports = { getManifest };