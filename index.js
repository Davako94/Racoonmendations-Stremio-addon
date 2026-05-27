const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fetch = require('node-fetch');
const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');
const { saveUserConfig, getUserConfig, getUserConfigByEmail } = require('./src/services/userStore');
const stremioApi = require('./src/services/stremioApi');
const tmdb = require('./src/services/tmdb');

const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'src/public')));

// ============================================================
// MANIFEST
// ============================================================
app.get('/manifest.json', async (req, res) => {
  const userUuid = req.query.uuid;
  const manifest = await getManifest(userUuid);
  res.json(manifest);
});

app.get('/:uuid/manifest.json', async (req, res) => {
  const manifest = await getManifest(req.params.uuid);
  res.json(manifest);
});

// ============================================================
// CATALOGO
// ============================================================
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  const userUuid = req.query.uuid;
  
  if (!['movie', 'series'].includes(type)) {
    return res.json({ metas: [] });
  }
  
  const metas = await catalogHandler.getCatalog(type, catalogId, userUuid);
  res.json({ metas });
});

app.get('/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  const { uuid, type, catalogId } = req.params;
  
  if (!['movie', 'series'].includes(type)) {
    return res.json({ metas: [] });
  }
  
  const metas = await catalogHandler.getCatalog(type, catalogId, uuid);
  res.json({ metas });
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
  
  try {
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
    const results = await tmdb.searchTmdb(q, type, language);
    res.json(results || []);
  } catch (error) {
    res.status(500).json([]);
  }
});

app.get('/api/languages', (req, res) => {
  res.json([
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' }
  ]);
});

app.post('/api/invalidate/:userUuid', (req, res) => {
  catalogHandler.invalidateCache(req.params.userUuid);
  res.json({ ok: true });
});

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.redirect('/configure');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦝 Raccoonmendations running on port ${PORT}`);
  console.log(`   Configure: http://localhost:${PORT}/configure`);
});

module.exports = app;
