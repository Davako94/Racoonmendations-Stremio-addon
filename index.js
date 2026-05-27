const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fetch = require('node-fetch');
const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');
const { saveUserConfig, getUserConfig } = require('./src/services/userStore');
const stremioApi = require('./src/services/stremioApi');
const tmdb = require('./src/services/tmdb');

const app = express();

// ============================================================
// CORS — obbligatorio per Stremio e AIOMetadata
// Deve stare PRIMA di tutto il resto
// ============================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// ============================================================
// HELPER: estrai UUID dal path o dalla query
// Supporta tutti e tre i formati:
//   /:uuid/manifest.json          ← formato standard Stremio
//   /manifest.json?uuid=:uuid     ← formato legacy
//   /stremio/:uuid/config/manifest.json ← formato AIOMetadata
// ============================================================
function extractUuid(req) {
  return req.params.uuid || req.query.uuid || null;
}

// ============================================================
// MANIFEST — formato standard Stremio /:uuid/manifest.json
// ============================================================
app.get('/:uuid/manifest.json', async (req, res) => {
  const userUuid = req.params.uuid;
  try {
    const manifest = await getManifest(userUuid);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    return res.json(manifest);
  } catch (err) {
    console.error('Manifest error:', err);
    return res.status(500).json(fallbackManifest());
  }
});

// MANIFEST — formato legacy /manifest.json?uuid=
app.get('/manifest.json', async (req, res) => {
  const userUuid = req.query.uuid || null;
  try {
    const manifest = await getManifest(userUuid);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    return res.json(manifest);
  } catch (err) {
    console.error('Manifest error:', err);
    return res.status(500).json(fallbackManifest());
  }
});

// MANIFEST — formato AIOMetadata /stremio/:uuid/config/manifest.json
app.get('/stremio/:uuid/config/manifest.json', async (req, res) => {
  const userUuid = req.params.uuid;
  try {
    const manifest = await getManifest(userUuid);
    // AIOMetadata usa questo URL, aggiorniamo i catalog ID in modo
    // che i catalog URL usino lo stesso prefisso /stremio/:uuid/
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    return res.json(manifest);
  } catch (err) {
    console.error('Manifest error:', err);
    return res.status(500).json(fallbackManifest());
  }
});

function fallbackManifest() {
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

// ============================================================
// CATALOGO — formato standard /:uuid/catalog/:type/:id.json
// ============================================================
app.get('/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err);
    return res.json({ metas: [] });
  }
});

// CATALOGO — formato legacy /catalog/:type/:id.json
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (!['movie', 'series'].includes(type)) return res.json({ metas: [] });
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err);
    return res.json({ metas: [] });
  }
});

// ============================================================
// CONFIG PAGE
// ============================================================
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/configure.html'));
});

// ============================================================
// PROXY IMMAGINI TMDB
// ============================================================
app.get('/api/poster', async (req, res) => {
  const { path: imagePath, size = 'w185' } = req.query;
  if (!imagePath) return res.status(400).json({ error: 'Path required' });
  try {
    const proxyUrl = `https://image.tmdb.org/t/p/${size}${imagePath}`;
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Content-Type', 'image/jpeg');
    const imageResponse = await fetch(proxyUrl);
    if (!imageResponse.ok) throw new Error(`TMDB ${imageResponse.status}`);
    imageResponse.body.pipe(res);
  } catch (error) {
    res.redirect(`https://image.tmdb.org/t/p/w185${imagePath}`);
  }
});

// ============================================================
// API: LOGIN STREMIO
// ============================================================
app.post('/api/stremio/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
  try {
    console.log(`🔐 Stremio login: ${email}`);
    const auth = await stremioApi.stremioLogin(email, password);
    const rawLibrary = await stremioApi.getStremioLibraryRaw(auth.token);
    const activeItems = rawLibrary.filter(i => !i.removed && !i.temp);
    const continueWatching = stremioApi.getContinueWatchingFromLibrary(rawLibrary);
    const seeds = stremioApi.extractSeedsFromLibrary(rawLibrary, continueWatching);

    const enrichedSeeds = await Promise.all(seeds.map(async (seed) => {
      if (!seed.poster && seed.title) {
        try {
          const searchResults = await tmdb.searchTmdb(seed.title, seed.type, 'en');
          if (searchResults?.length > 0) {
            seed.poster_path = searchResults[0].poster_path;
            seed.tmdb_id = searchResults[0].id;
          }
        } catch(e) {}
      }
      return seed;
    }));

    const libraryForUI = activeItems.map(item => ({
      id: stremioApi.extractContentId(item._id || item.id) || (item._id || item.id),
      title: item.name,
      type: item.type === 'series' || item.type === 'show' ? 'series' : 'movie',
      poster_path: item.poster,
      year: item.year
    }));

    const uniqueLibrary = [];
    const seenIds = new Set();
    for (const item of libraryForUI) {
      if (item.id && !seenIds.has(item.id)) { seenIds.add(item.id); uniqueLibrary.push(item); }
    }

    res.json({
      success: true,
      library: uniqueLibrary,
      continueWatching: continueWatching.map(cw => ({
        id: cw.content_id, title: cw.title, type: cw.type,
        poster_path: cw.poster, progressPercent: cw.percent
      })),
      seeds: enrichedSeeds,
      stats: {
        total: uniqueLibrary.length,
        movies: uniqueLibrary.filter(i => i.type === 'movie').length,
        series: uniqueLibrary.filter(i => i.type === 'series').length,
        continueWatching: continueWatching.length
      }
    });
  } catch (error) {
    console.error('Stremio login error:', error.message);
    res.status(401).json({ success: false, error: error.message || 'Login failed' });
  }
});

// ============================================================
// API: SALVA CONFIGURAZIONE
// ============================================================
app.post('/api/save-config', async (req, res) => {
  const { stremioEmail, selectedMovies, selectedSeries, selectedAnime, language, prefs, existingUuid } = req.body;
  const userUuid = existingUuid || uuidv4();
  try {
    await saveUserConfig(userUuid, {
      stremioEmail: stremioEmail || 'manual@mode.com',
      selectedMovies: selectedMovies || [],
      selectedSeries: selectedSeries || [],
      selectedAnime:  selectedAnime  || [],
      language: language || 'en',
      prefs: prefs || ''
    });

    const baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;

    // URL nel formato standard Stremio: /:uuid/manifest.json
    // Questo è il formato che sia Stremio che AIOMetadata accettano correttamente
    const manifestUrl = `${baseUrl}/${userUuid}/manifest.json`;

    console.log(`✅ Config saved for user: ${userUuid}`);
    res.json({ success: true, manifestUrl, userUuid });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// API: RICERCA TMDB
// ============================================================
app.get('/api/search', async (req, res) => {
  const { q, type, language = 'en' } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    const results = type === 'anime'
      ? await tmdb.searchAnime(q, language)
      : await tmdb.searchTmdb(q, type, language);
    res.json(results || []);
  } catch (error) {
    res.status(500).json([]);
  }
});

// ============================================================
// API: INVALIDA CACHE
// ============================================================
app.post('/api/invalidate/:userUuid', (req, res) => {
  catalogHandler.invalidateCache(req.params.userUuid);
  res.json({ ok: true });
});

// ============================================================
// API: STATISTICHE UTENTE
// ============================================================
app.get('/api/user-stats/:userUuid', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userUuid);
    if (!config) return res.json({ success: false, error: 'User not found' });
    res.json({ success: true, stats: {
      movies: config.selected_movies?.length || 0,
      series: config.selected_series?.length || 0,
      anime:  config.selected_anime?.length  || 0,
      language: config.language || 'en'
    }});
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// DEBUG
// ============================================================
app.get('/api/debug-seeds/:userUuid', async (req, res) => {
  try {
    const config = await getUserConfig(req.params.userUuid);
    res.json({
      success: true, hasConfig: !!config,
      moviesCount: config?.selected_movies?.length || 0,
      seriesCount: config?.selected_series?.length || 0,
      movies: config?.selected_movies?.slice(0,5).map(m => ({ id: m.id, title: m.title })),
      series: config?.selected_series?.slice(0,5).map(s => ({ id: s.id, title: s.title })),
      language: config?.language || 'en'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '3.0.0' });
});

// ============================================================
// ROOT — redirect a /configure
// ============================================================
app.get('/', (req, res) => {
  res.redirect('/configure');
});

// ============================================================
// AVVIO
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦝 Raccoonmendations running on port ${PORT}`);
  console.log(`   Configure: http://localhost:${PORT}/configure`);
  console.log(`   Manifest:  http://localhost:${PORT}/<uuid>/manifest.json`);
});
