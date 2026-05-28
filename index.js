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
// MANIFEST - UNICA ROUTE
// ============================================================
app.get('/manifest.json', async (req, res) => {
  const userUuid = req.query.uuid;
  console.log(`📄 Manifest: ${userUuid}`);
  const manifest = await getManifest(userUuid);
  res.json(manifest);
});

// ============================================================
// CATALOGO - UNICA ROUTE (cattura TUTTO)
// ============================================================
app.get('*', async (req, res) => {
  const url = req.url;
  console.log(`🌐 Request: ${url}`);
  
  // Verifica se è una richiesta di catalogo
  if (url.includes('/catalog/')) {
    const parts = url.split('/');
    // Formato: /catalog/movie/similar--xxx--uuid.json oppure /catalog/movie/similar--xxx--uuid.json?uuid=xxx
    let catalogId = null;
    let catalogType = null;
    
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'catalog' && i + 2 < parts.length) {
        catalogType = parts[i + 1];
        catalogId = parts[i + 2].replace('.json', '');
        break;
      }
    }
    
    // Estrai UUID dalla query string o dal path
    let userUuid = req.query.uuid;
    
    if (!userUuid && catalogId) {
      // Cerca UUID nel catalogId (formato: similar--tt123--uuid)
      const uuidMatch = catalogId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      if (uuidMatch) {
        userUuid = uuidMatch[1];
      }
    }
    
    console.log(`   Catalog: type=${catalogType}, id=${catalogId}, uuid=${userUuid}`);
    
    if (!catalogType || !['movie', 'series'].includes(catalogType)) {
      return res.json({ metas: [] });
    }
    
    // Setup catalog
    if (catalogId && catalogId.includes('setup')) {
      return res.json({ metas: [{
        id: 'setup',
        type: catalogType,
        name: '⚙️ Configure Raccoonmendations',
        poster: null,
        description: 'Open /configure to select your favorites',
        releaseInfo: '',
        extra: {}
      }] });
    }
    
    if (!userUuid) {
      console.log('   No UUID, returning empty');
      return res.json({ metas: [] });
    }
    
    try {
      const metas = await catalogHandler.getCatalog(catalogType, catalogId, userUuid);
      res.json({ metas });
    } catch (err) {
      console.error('Catalog error:', err);
      res.json({ metas: [] });
    }
    return;
  }
  
  // Health check
  if (url === '/health') {
    return res.json({ status: 'ok' });
  }
  
  // Configure page
  if (url === '/configure' || url === '/') {
    return res.sendFile(path.join(__dirname, 'src/public/configure.html'));
  }
  
  // API routes
  if (url.startsWith('/api/')) {
    if (url === '/api/languages') {
      return res.json([
        { code: 'en', name: 'English', flag: '🇬🇧' },
        { code: 'it', name: 'Italiano', flag: '🇮🇹' },
        { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
        { code: 'es', name: 'Español', flag: '🇪🇸' },
        { code: 'fr', name: 'Français', flag: '🇫🇷' }
      ]);
    }
    
    if (url === '/api/search' && req.query.q) {
      try {
        const results = await tmdb.searchTmdb(req.query.q, req.query.type || 'movie', req.query.language || 'en');
        return res.json(results || []);
      } catch(e) { return res.json([]); }
    }
    
    if (url === '/api/stremio/login' && req.method === 'POST') {
      return handleStremioLogin(req, res);
    }
    
    if (url === '/api/save-config' && req.method === 'POST') {
      return handleSaveConfig(req, res);
    }
  }
  
  // Poster proxy
  if (url.startsWith('/api/poster')) {
    const imagePath = req.query.path;
    if (!imagePath) return res.status(400).json({ error: 'Path required' });
    try {
      const proxyUrl = `https://image.tmdb.org/t/p/${req.query.size || 'w185'}${imagePath}`;
      const imageResponse = await fetch(proxyUrl);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.setHeader('Content-Type', 'image/jpeg');
      imageResponse.body.pipe(res);
    } catch(e) {
      res.redirect(`https://image.tmdb.org/t/p/w185${imagePath}`);
    }
    return;
  }
  
  // 404 per tutto il resto
  res.status(404).json({ error: 'Not found' });
});

// ============================================================
// HANDLERS SEPARATI
// ============================================================

async function handleStremioLogin(req, res) {
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
}

async function handleSaveConfig(req, res) {
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
    const manifestUrl = `${baseUrl}/manifest.json?uuid=${finalUuid}`;
    
    console.log(`✅ Config saved: ${finalUuid}`);
    res.json({ success: true, manifestUrl, userUuid: finalUuid });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// ============================================================
// AVVIO
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦝 Raccoonmendations running on port ${PORT}`);
  console.log(`   Configure: http://localhost:${PORT}/configure`);
  console.log(`   Manifest: http://localhost:${PORT}/manifest.json?uuid=YOUR_UUID`);
});

module.exports = app;
