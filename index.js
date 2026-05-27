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

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// ============================================================
// MANIFEST - TUTTI I FORMATI
// ============================================================

// Formato 1: /:uuid/manifest.json (Stremio standard)
app.get('/:uuid/manifest.json', async (req, res) => {
  const userUuid = req.params.uuid;
  try {
    const manifest = await getManifest(userUuid);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: 'Manifest error' });
  }
});

// Formato 2: /manifest.json?uuid=xxx (legacy)
app.get('/manifest.json', async (req, res) => {
  const userUuid = req.query.uuid || null;
  try {
    const manifest = await getManifest(userUuid);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: 'Manifest error' });
  }
});

// Formato 3: /stremio/:uuid/config/manifest.json (AIOMetadata)
app.get('/stremio/:uuid/config/manifest.json', async (req, res) => {
  const userUuid = req.params.uuid;
  try {
    const manifest = await getManifest(userUuid);
    // AIOMetadata richiede che i cataloghi abbiano URL assoluti
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const fixedCatalogs = (manifest.catalogs || []).map(c => ({
      ...c,
      id: c.id,
      // Mantieni l'ID come è
    }));
    manifest.catalogs = fixedCatalogs;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json(manifest);
  } catch (err) {
    console.error('AIOMetadata manifest error:', err);
    res.status(500).json({ error: 'Manifest error' });
  }
});

// ============================================================
// CATALOGO - TUTTI I FORMATI
// ============================================================

// Formato 1: /:uuid/catalog/:type/:id.json (Stremio standard)
app.get('/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  const userUuid = req.params.uuid;
  
  if (!['movie', 'series'].includes(type)) {
    return res.json({ metas: [] });
  }
  
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId, userUuid);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err);
    res.json({ metas: [] });
  }
});

// Formato 2: /catalog/:type/:id.json (legacy con query uuid)
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  const userUuid = req.query.uuid;
  
  if (!['movie', 'series'].includes(type)) {
    return res.json({ metas: [] });
  }
  
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId, userUuid);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err);
    res.json({ metas: [] });
  }
});

// Formato 3: /stremio/:uuid/catalog/:type/:id.json (AIOMetadata)
app.get('/stremio/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  const { uuid, type, catalogId } = req.params;
  
  if (!['movie', 'series'].includes(type)) {
    return res.json({ metas: [] });
  }
  
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId, uuid);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ metas });
  } catch (err) {
    console.error('AIOMetadata catalog error:', err);
    res.json({ metas: [] });
  }
});

// ============================================================
// CONFIG PAGE
// ============================================================
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/configure.html'));
});

// ============================================================
// PROXY IMMAGINI
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

// Poster proxy per AIOMetadata
app.get('/poster/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    let posterPath = null;
    const mediaType = type === 'movie' ? 'movie' : 'tv';
    const details = await tmdb.getDetails(mediaType, id, 'en');
    posterPath = details?.poster_path;
    
    if (posterPath) {
      const proxyUrl = `https://image.tmdb.org/t/p/w342${posterPath}`;
      const imageResponse = await fetch(proxyUrl);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.setHeader('Content-Type', 'image/jpeg');
      imageResponse.body.pipe(res);
    } else {
      res.status(404).send('Poster not found');
    }
  } catch (error) {
    res.status(404).send('Poster not found');
  }
});

// ============================================================
// API: LOGIN STREMIO
// ============================================================
app.post('/api/stremio/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }
  
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
      if (item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        uniqueLibrary.push(item);
      }
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
    const finalUuid = await saveUserConfig(userUuid, {
      stremioEmail: stremioEmail || 'manual@mode.com',
      selectedMovies: selectedMovies || [],
      selectedSeries: selectedSeries || [],
      selectedAnime: selectedAnime || [],
      language: language || 'en',
      prefs: prefs || ''
    });

    const baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;
    // URL nel formato che AIOMetadata preferisce
    const manifestUrl = `${baseUrl}/stremio/${finalUuid}/config/manifest.json`;

    console.log(`✅ Config saved for user: ${finalUuid}`);
    res.json({ success: true, manifestUrl, userUuid: finalUuid });
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
// API: LINGUE
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
// ROOT
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

module.exports = app;
