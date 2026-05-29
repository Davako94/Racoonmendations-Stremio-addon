// app.js

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fetch = require('node-fetch');

const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');

const {
  saveUserConfig,
  getUserConfig,
  getUserConfigByEmail
} = require('./src/services/userStore');

const stremioApi = require('./src/services/stremioApi');
const tmdb = require('./src/services/tmdb');

const app = express();

function normalizeBaseUrl(value) {
  if (!value) {
    console.warn('⚠️  Empty baseUrl provided, using default');
    return 'https://racoonmendations-stremio-addon.vercel.app';
  }
  const normalized = String(value).replace(/\/+$|\/+(?=\?)/g, '');
  if (!normalized.startsWith('http')) {
    console.warn('⚠️  Invalid baseUrl format, using default:', value);
    return 'https://racoonmendations-stremio-addon.vercel.app';
  }
  return normalized;
}

// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  const allowed = 'Content-Type, Accept, Authorization, X-Requested-With, Range';
  res.setHeader('Access-Control-Allow-Headers', allowed);
  res.setHeader('Access-Control-Expose-Headers', 'Cache-Control, Content-Length, Content-Type, Date, ETag');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// ============================================================
// BODY PARSERS
// ============================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// STATIC FILES
// ============================================================

app.use('/static', express.static(path.join(__dirname, 'src/public')));

// ============================================================
// CACHE HEADERS UTILITIES
// ============================================================

const setCatalogCacheHeaders = (res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Pragma', 'cache');
};

// ============================================================
// MANIFEST ENDPOINT (Compatibile AIOMetadata e Stremio Manager)
// ============================================================

const handleManifest = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Vary', 'Origin, Authorization');
  
  try {
    let uuid = req.params.uuid || req.query.uuid;
    let baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;
    baseUrl = normalizeBaseUrl(baseUrl);

    // Estrazione di sicurezza dell'UUID direttamente dalla stringa dell'URL (per URL complessi o nidificati)
    if (!uuid && req.originalUrl) {
      const pathParts = req.originalUrl.split('/');
      const uuidRegex = /([0-9a-fA-F-]{36})/;
      for (const part of pathParts) {
        const match = part.match(uuidRegex);
        if (match) {
          uuid = match[1];
          break;
        }
      }
    }

    // Fallback dell'UUID dal Referer header
    if (!uuid && req.headers.referer) {
      const match = req.headers.referer.match(/\/([0-9a-fA-F-]{36})(\/|$)/);
      if (match) {
        uuid = match[1];
      }
    }

    // 🌍 CASO A: NESSUN UUID = Public Manifest (Modalità indicizzazione AIOMetadata)
    if (!uuid) {
      console.log(`📡 Public manifest requested (aggregator mode)`);
      const publicManifest = {
        id: "com.raccoonmendations.stremio",
        version: "3.2.0",
        name: "Raccoonmendations",
        description: "Personalized recommendations powered by TMDB - Configure at /configure",
        logo: `${baseUrl}/static/logo.png`,
        background: `${baseUrl}/static/logo.png`,
        resources: [
          { name: "catalog", types: ["movie", "series"], idPrefixes: [] },
          { name: "meta", types: ["movie", "series"], idPrefixes: ["tt", "tmdb:"] }
        ],
        types: ["movie", "series"],
        catalogs: [
          {
            type: "movie",
            id: "raccoon_public_movies",
            name: "✨ Raccoonmendations - Film Popolari",
            extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
          },
          {
            type: "series",
            id: "raccoon_public_series",
            name: "✨ Raccoonmendations - Serie Popolari",
            extra: [{ name: "skip", isRequired: false }, { name: "search", isRequired: false }]
          }
        ],
        idPrefixes: ["tt", "tmdb:"],
        behaviorHints: {
          configurable: true,
          configurationRequired: false
        }
      };
      return res.json(publicManifest);
    }

    // 🔐 CASO B: UUID PRESENTE = Manifest Utente Personalizzato
    console.log(`📄 Personalized manifest requested for UUID: ${uuid}`);
    const manifest = await getManifest(uuid, baseUrl);
    return res.json(manifest);

  } catch (err) {
    console.error('❌ Manifest error:', err.message);
    return res.status(500).json({ 
      error: 'Manifest generation failed',
      details: err.message
    });
  }
};

app.get('/manifest.json', handleManifest);
app.get('/:uuid/manifest.json', handleManifest);
app.get('/stremio/:uuid/config/manifest.json', handleManifest);
app.get('/stremio/:uuid/:compressedConfig/manifest.json', handleManifest);

// ============================================================
// META ENDPOINTS
// ============================================================

const handleMeta = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Vary', 'Origin');
  
  try {
    const { type, id } = req.params;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    
    let tmdbId = id;
    if (tmdbId.startsWith('tmdb:')) {
      tmdbId = tmdbId.replace('tmdb:', '');
    }

    const details = await tmdb.getMeta(mediaType, tmdbId);
    if (!details) {
      return res.json({ meta: null });
    }
    return res.json({ meta: details });
  } catch (err) {
    console.error('Meta error:', err);
    return res.json({ meta: null });
  }
};

app.get('/meta/:type/:id.json', handleMeta);
app.get('/:uuid/meta/:type/:id.json', handleMeta);
app.get('/stremio/:uuid/meta/:type/:id.json', handleMeta);
app.get('/:uuid/:compressedConfig/meta/:type/:id.json', handleMeta);
app.get('/stremio/:uuid/:compressedConfig/meta/:type/:id.json', handleMeta);

// ============================================================
// CATALOG ENDPOINTS
// ============================================================

app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  setCatalogCacheHeaders(res);
  try {
    const metas = await catalogHandler.getCatalog(
      req.params.type,
      req.params.catalogId,
      req.query.uuid || 'public'
    );
    return res.json({ metas: metas || [] });
  } catch (err) {
    console.error('Catalog error:', err);
    return res.json({ metas: [] });
  }
});

const handleUuidCatalog = async (req, res) => {
  setCatalogCacheHeaders(res);
  try {
    console.log(`📺 Catalog Requested: ${req.params.type}/${req.params.catalogId} (uuid: ${req.params.uuid})`);
    const metas = await catalogHandler.getCatalog(
      req.params.type,
      req.params.catalogId,
      req.params.uuid
    );
    return res.json({ metas: metas || [] });
  } catch (err) {
    console.error('Catalog path error:', err);
    return res.json({ metas: [] });
  }
};

app.get('/:uuid/catalog/:type/:catalogId.json', handleUuidCatalog);
app.get('/stremio/:uuid/catalog/:type/:catalogId.json', handleUuidCatalog);
app.get('/stremio/:uuid/:compressedConfig/catalog/:type/:catalogId.json', handleUuidCatalog);

// ============================================================
// OTHER API ROUTES (CONFIG, LOGIN, SEARCH, ETC.)
// ============================================================

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/configure.html'));
});

app.get('/api/poster', async (req, res) => {
  try {
    const { path: imagePath, size = 'w342' } = req.query;
    if (!imagePath) return res.status(400).json({ error: 'Missing path' });

    const url = `https://image.tmdb.org/t/p/${size}${imagePath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TMDB ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return res.send(buffer);
  } catch (err) {
    console.error('Poster proxy error:', err);
    return res.status(500).end();
  }
});

app.post('/api/stremio/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const auth = await stremioApi.stremioLogin(email, password);
    const rawLibrary = await stremioApi.getStremioLibraryRaw(auth.token);
    const activeItems = rawLibrary.filter(i => !i.removed && !i.temp);

    const libraryForUI = activeItems.map(item => ({
      id: String(stremioApi.extractContentId(item._id || item.id)),
      title: item.name,
      type: item.type === 'series' || item.type === 'show' ? 'series' : 'movie',
      poster_path: item.poster,
      year: item.year
    }));

    const unique = [];
    const seen = new Set();
    for (const item of libraryForUI) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
    }

    return res.json({ success: true, library: unique });
  } catch (err) {
    console.error('Stremio login error:', err);
    return res.status(401).json({ success: false, error: err.message });
  }
});

app.post('/api/save-config', async (req, res) => {
  try {
    const { stremioEmail, selectedMovies, selectedSeries, selectedAnime, language, prefs, existingUuid } = req.body;

    const existing = await getUserConfigByEmail(stremioEmail);
    const userUuid = existing?.uuid || existingUuid || uuidv4();

    const finalUuid = await saveUserConfig(userUuid, {
      stremioEmail: stremioEmail || 'manual@mode.com',
      selectedMovies: selectedMovies || [],
      selectedSeries: selectedSeries || [],
      selectedAnime: selectedAnime || [],
      language: language || 'en',
      prefs: prefs || ''
    });

    const baseUrl = normalizeBaseUrl(process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`);
    const manifestUrl = `${baseUrl}/${finalUuid}/manifest.json`;

    return res.json({ success: true, manifestUrl, userUuid: finalUuid });
  } catch (err) {
    console.error('Save config error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'movie', language = 'en' } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const results = await tmdb.search(q, type === 'series' ? 'tv' : type, language);
    return res.json(results || []);
  } catch (err) {
    console.error('Search error:', err);
    return res.json([]);
  }
});

app.get('/api/recommendations/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { language = 'en' } = req.query;
    if (!id) return res.status(400).json({ error: 'ID required' });

    const results = await tmdb.getRecommendationsWithScores(type, id, language);
    return res.json({ success: true, recommendations: results.slice(0, 20) });
  } catch (err) {
    console.error('Recommendations preview error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/languages', (req, res) => {
  return res.json([
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' }
  ]);
});

app.post('/api/invalidate/:userUuid', (req, res) => {
  catalogHandler.invalidateCache(req.params.userUuid);
  return res.json({ ok: true });
});

app.get('/api/user-stats/:userUuid', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userUuid);
    if (!config) return res.json({ success: false, error: 'User not found' });
    return res.json({
      success: true,
      stats: {
        movies: config.selectedMovies?.length || config.selected_movies?.length || 0,
        series: config.selectedSeries?.length || config.selected_series?.length || 0,
        anime: config.selectedAnime?.length || config.selected_anime?.length || 0,
        language: config.language || 'en'
      }
    });
  } catch (error) {
    console.error('User stats error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/debug-seeds/:userUuid', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userUuid);
    const mList = config?.selectedMovies || config?.selected_movies || [];
    const sList = config?.selectedSeries || config?.selected_series || [];
    return res.json({
      success: true,
      hasConfig: !!config,
      moviesCount: mList.length,
      seriesCount: sList.length,
      movies: mList.slice(0, 5).map(m => ({ id: m.id, title: m.title })),
      series: sList.slice(0, 5).map(s => ({ id: s.id, title: s.title })),
      language: config?.language || 'en'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  return res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/favicon.ico', (req, res) => {
  return res.sendFile(path.join(__dirname, 'src/public/logo.png'));
});

app.get('/', (req, res) => {
  return res.redirect('/configure');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦝 Raccoonmendations running on port ${PORT}`);
});

module.exports = app;