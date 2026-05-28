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

// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  // Prefer echoing the request Origin to support credentialed requests from webviews/mobile apps.
  // Some mobile and webview requests use Origin: null, so fall back to wildcard in that case.
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    // Tell caches to vary responses by origin
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
// BODY
// ============================================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================
// STATIC
// ============================================================

app.use('/static', express.static(path.join(__dirname, 'src/public')));

const setNoCacheHeaders = (res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

// ============================================================
// MANIFEST CONFIGURATION (Compatibile AIOMetadata)
// ============================================================

const handleManifest = async (req, res) => {
  setNoCacheHeaders(res);

  try {
    let uuid = req.params.uuid || req.query.uuid;
    const baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;

    // ============================================================
    // 🔥 PATCH: Estrai UUID dal Referer se mancante
    // ============================================================
    if (!uuid && req.headers.referer) {
      const match = req.headers.referer.match(/\/([0-9a-fA-F-]{36})(\/|$)/);
      if (match) {
        uuid = match[1];
        console.log(`📌 UUID estratto dal Referer: ${uuid}`);
      }
    }

    console.log(`📄 Manifest richiesto (uuid: ${uuid || "none"})`);

    const manifest = await getManifest(uuid);
    res.json(manifest);

  } catch (err) {
    console.error('Manifest error:', err);
    res.status(500).json({ error: 'Manifest error' });
  }
};

app.get('/manifest.json', handleManifest);
app.get('/:uuid/manifest.json', handleManifest);
app.get('/stremio/:uuid/config/manifest.json', handleManifest);
app.get('/stremio/:uuid/:compressedConfig/manifest.json', handleManifest);

// ============================================================
// META
// ============================================================

const handleMeta = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { type, id } = req.params;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    const details = await tmdb.getMeta(mediaType, id);

    if (!details) {
      return res.json({ meta: null });
    }

    res.json({ meta: details });
  } catch (err) {
    console.error('Meta error:', err);
    res.json({ meta: null });
  }
};

app.get('/meta/:type/:id.json', handleMeta);
app.get('/:uuid/meta/:type/:id.json', handleMeta);
app.get('/stremio/:uuid/meta/:type/:id.json', handleMeta);

// ============================================================
// CATALOG
// ============================================================

app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  setNoCacheHeaders(res);
  try {
    const metas = await catalogHandler.getCatalog(
      req.params.type,
      req.params.catalogId,
      req.query.uuid
    );
    res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err);
    res.json({ metas: [] });
  }
});

const handleUuidCatalog = async (req, res) => {
  setNoCacheHeaders(res);
  try {
    console.log(`📺 Catalog Requested: ${req.params.type}/${req.params.catalogId} (uuid: ${req.params.uuid})`);
    const metas = await catalogHandler.getCatalog(
      req.params.type,
      req.params.catalogId,
      req.params.uuid
    );
    res.json({ metas });
  } catch (err) {
    console.error('Catalog path error:', err);
    res.json({ metas: [] });
  }
};

app.get('/:uuid/catalog/:type/:catalogId.json', handleUuidCatalog);
app.get('/stremio/:uuid/catalog/:type/:catalogId.json', handleUuidCatalog);
app.get('/stremio/:uuid/:compressedConfig/catalog/:type/:catalogId.json', handleUuidCatalog);

app.get('/:uuid/:compressedConfig/meta/:type/:id.json', handleMeta);
app.get('/stremio/:uuid/:compressedConfig/meta/:type/:id.json', handleMeta);

// ============================================================
// CONFIG PAGE
// ============================================================

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/configure.html'));
});

// ============================================================
// POSTER PROXY
// ============================================================

app.get('/api/poster', async (req, res) => {
  try {
    const { path: imagePath, size = 'w342' } = req.query;

    if (!imagePath) {
      return res.status(400).json({ error: 'Missing path' });
    }

    const url = `https://image.tmdb.org/t/p/${size}${imagePath}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`TMDB ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');

    res.send(buffer);
  } catch (err) {
    console.error('Poster proxy error:', err);
    res.status(500).end();
  }
});

// ============================================================
// LOGIN STREMIO
// ============================================================

app.post('/api/stremio/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password required'
      });
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
      if (!item.id) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
    }

    res.json({
      success: true,
      library: unique
    });
  } catch (err) {
    console.error('Stremio login error:', err);
    res.status(401).json({
      success: false,
      error: err.message
    });
  }
});

// ============================================================
// SAVE CONFIG
// ============================================================

app.post('/api/save-config', async (req, res) => {
  try {
    const {
      stremioEmail,
      selectedMovies,
      selectedSeries,
      selectedAnime,
      language,
      prefs,
      existingUuid
    } = req.body;

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

    const baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    const manifestUrl = `${baseUrl}/${finalUuid}/manifest.json`;

    res.json({
      success: true,
      manifestUrl,
      userUuid: finalUuid
    });
  } catch (err) {
    console.error('Save config error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ============================================================
// SEARCH
// ============================================================

app.get('/api/search', async (req, res) => {
  try {
    const { q, type = 'movie', language = 'en' } = req.query;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    const results = await tmdb.search(q, type === 'series' ? 'tv' : type, language);

    res.json(results || []);
  } catch (err) {
    console.error('Search error:', err);
    res.json([]);
  }
});

// ============================================================
// RECOMMENDATIONS PREVIEW
// ============================================================

app.get('/api/recommendations/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { language = 'en' } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'ID required' });
    }

    const results = await tmdb.getRecommendationsWithScores(type, id, language);

    res.json({
      success: true,
      recommendations: results.slice(0, 20)
    });
  } catch (err) {
    console.error('Recommendations preview error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ============================================================
// LANGUAGES
// ============================================================

app.get('/api/languages', (req, res) => {
  res.json([
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' }
  ]);
});

// ============================================================
// INVALIDATE CACHE
// ============================================================

app.post('/api/invalidate/:userUuid', (req, res) => {
  catalogHandler.invalidateCache(req.params.userUuid);
  res.json({ ok: true });
});

// ============================================================
// USER STATS
// ============================================================

app.get('/api/user-stats/:userUuid', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userUuid);
    if (!config) {
      return res.json({ success: false, error: 'User not found' });
    }
    res.json({
      success: true,
      stats: {
        movies: config.selected_movies?.length || 0,
        series: config.selected_series?.length || 0,
        anime: config.selected_anime?.length || 0,
        language: config.language || 'en'
      }
    });
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// DEBUG SEEDS
// ============================================================

app.get('/api/debug-seeds/:userUuid', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userUuid);
    res.json({
      success: true,
      hasConfig: !!config,
      moviesCount: config?.selected_movies?.length || 0,
      seriesCount: config?.selected_series?.length || 0,
      movies: config?.selected_movies?.slice(0, 5).map(m => ({ id: m.id, title: m.title })),
      series: config?.selected_series?.slice(0, 5).map(s => ({ id: s.id, title: s.title })),
      language: config?.language || 'en'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.1.0',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// ROOT
// ============================================================

app.get('/', (req, res) => {
  res.redirect('/configure');
});

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🦝 Raccoonmendations running on ${PORT}`);
});

module.exports = app;
