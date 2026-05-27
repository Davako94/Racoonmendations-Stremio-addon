const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fetch = require('node-fetch');
const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');
const { saveUserConfig, getUserConfig, getUserSeeds } = require('./src/services/userStore');
const stremioApi = require('./src/services/stremioApi');
const tmdb = require('./src/services/tmdb');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// ============================================================
// MANIFEST - STATICO & DINAMICO (compatibile Stremio)
// ============================================================
app.get('/manifest.json', (req, res) => {
  try {
    const manifest = getManifest();
    res.json(manifest);
  } catch (err) {
    console.error('❌ Manifest error:', err);
    res.status(500).json({ 
      id: "racconmendations",
      version: "3.0.0",
      name: "Racconmendations Error",
      description: "Error loading manifest",
      resources: ["catalog"],
      types: ["movie", "series"],
      catalogs: [],
      idPrefixes: ["tt", "tmdb"]
    });
  }
});

// Endpoint per aiometadata / Installazioni dinamiche Stremio
app.get('/stremio/:userUuid/:compressedConfig/manifest.json', (req, res) => {
  try {
    // Volendo potresti passare req.params.userUuid a getManifest se un giorno vorrai personalizzarlo
    const manifest = getManifest();
    res.json(manifest);
  } catch (err) {
    console.error('❌ Dynamic Manifest error:', err);
    res.status(500).json({ error: 'Manifest error' });
  }
});

// ============================================================
// CATALOGO (Rotte native Stremio e Fallback)
// ============================================================

// 1. ROTTA NATIVA STREMIO (Parametri nel path) - FONDAMENTALE
app.get('/stremio/:userUuid/:compressedConfig/catalog/:type/:catalogId.json', async (req, res) => {
  const { userUuid, type, catalogId } = req.params;
  
  console.log(`📺 Stremio Path request: type=${type}, catalogId=${catalogId}, uuid=${userUuid}`);
  
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ metas: [] });
  }
  
  try {
    // Passiamo tipo, ID del catalogo specifico (es. raccon-anime) e UUID
    const metas = await catalogHandler.getCatalog(type, catalogId, userUuid);
    res.json({ metas: metas || [] });
  } catch (err) {
    console.error('❌ Path Catalog error:', err);
    res.status(500).json({ metas: [] });
  }
});

// 2. ROTTA FALLBACK / LEGACY (Con query string)
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  
  console.log(`📺 Legacy Catalog request: type=${type}, catalogId=${catalogId}`);
  
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ metas: [] });
  }
  
  try {
    const userUuid = req.query.uuid;
    
    if (!userUuid) {
      const setupMetas = [{
        id: "setup_placeholder",
        type: type,
        name: "⚙️ Configure Racconmendations",
        poster: null,
        description: "Open /configure to select your favorite movies and series",
        releaseInfo: "",
        extra: {}
      }];
      return res.json({ metas: setupMetas });
    }
    
    const metas = await catalogHandler.getCatalog(type, catalogId, userUuid);
    res.json({ metas: metas || [] });
  } catch (err) {
    console.error('❌ Legacy Catalog error:', err);
    res.status(500).json({ metas: [] });
  }
});

// ============================================================
// CONFIG PAGE
// ============================================================
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/configure.html'));
});

// ============================================================
// PROXY PER IMMAGINI TMDB
// ============================================================
app.get('/api/poster', async (req, res) => {
  const { path: imagePath, size = 'w185' } = req.query;
  if (!imagePath) {
    return res.status(400).json({ error: 'Path required' });
  }
  
  try {
    const proxyUrl = `https://image.tmdb.org/t/p/${size}${imagePath}`;
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.setHeader('Content-Type', 'image/jpeg');
    
    const imageResponse = await fetch(proxyUrl);
    if (!imageResponse.ok) {
      throw new Error(`TMDB image error: ${imageResponse.status}`);
    }
    
    imageResponse.body.pipe(res);
  } catch (error) {
    console.error('Poster proxy error:', error.message);
    res.redirect(`https://image.tmdb.org/t/p/w185${imagePath}`);
  }
});

app.get('/poster/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    let posterPath = null;
    if (type === 'movie') {
      const details = await tmdb.getDetails?.('movie', id, 'en');
      posterPath = details?.poster_path;
    } else {
      const details = await tmdb.getDetails?.('series', id, 'en');
      posterPath = details?.poster_path;
    }
    
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
    console.error('Poster proxy error:', error.message);
    res.status(404).send('Poster not found');
  }
});

// ============================================================
// API: CONFIGURATION ENDPOINTS
// ============================================================
app.post('/api/config/save', async (req, res) => {
  const { userUuid, stremioEmail, selectedMovies, selectedSeries, selectedAnime, language, prefs } = req.body;
  const finalUuid = userUuid || uuidv4();
  
  try {
    await saveUserConfig(finalUuid, {
      stremioEmail: stremioEmail || 'manual@mode.com',
      selectedMovies: selectedMovies || [],
      selectedSeries: selectedSeries || [],
      selectedAnime: selectedAnime || [],
      language: language || 'en',
      prefs: prefs || ''
    });
    
    const baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;
    // FIX STREMIO: L'URL restituito deve essere il manifest path-based, non il catalogo legacy
    const manifestUrl = `${baseUrl}/stremio/${finalUuid}/config/manifest.json`;
    
    console.log(`✅ Config saved for user: ${finalUuid}`);
    res.json({ success: true, manifestUrl, userUuid: finalUuid });
  } catch (error) {
    console.error('❌ Error saving config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/config/load/:userUuid', async (req, res) => {
  const { userUuid } = req.params;
  try {
    const config = await getUserConfig(userUuid);
    if (!config) {
      return res.json({ success: false, error: 'User not found' });
    }
    res.json({
      success: true,
      config: {
        movies: config.selected_movies || [],
        series: config.selected_series || [],
        anime: config.selected_anime || [],
        language: config.language || 'en',
        preferences: config.preferences || ''
      }
    });
  } catch (error) {
    console.error('Error loading config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/config/update/:userUuid', async (req, res) => {
  const { userUuid } = req.params;
  const { selectedMovies, selectedSeries, selectedAnime, language, prefs } = req.body;
  
  try {
    const existing = await getUserConfig(userUuid);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    await saveUserConfig(userUuid, {
      stremioEmail: existing.stremio_email,
      selectedMovies: selectedMovies || existing.selected_movies || [],
      selectedSeries: selectedSeries || existing.selected_series || [],
      selectedAnime: selectedAnime || existing.selected_anime || [],
      language: language || existing.language || 'en',
      prefs: prefs || existing.preferences || ''
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/config/is-trusted/:uuid', async (req, res) => {
  const { uuid } = req.params;
  try {
    const config = await getUserConfig(uuid);
    res.json({ trusted: !!config });
  } catch (error) {
    res.json({ trusted: false });
  }
});

// Legacy Save Endpoint
app.post('/api/save-config', async (req, res) => {
  const { stremioEmail, selectedMovies, selectedSeries, selectedAnime, language, prefs, existingUuid } = req.body;
  const userUuid = existingUuid || uuidv4();
  
  try {
    await saveUserConfig(userUuid, {
      stremioEmail: stremioEmail || 'manual@mode.com',
      selectedMovies: selectedMovies || [],
      selectedSeries: selectedSeries || [],
      selectedAnime: selectedAnime || [],
      language: language || 'en',
      prefs: prefs || ''
    });
    
    const baseUrl = process.env.ADDON_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const manifestUrl = `${baseUrl}/stremio/${userUuid}/config/manifest.json`;
    
    console.log(`✅ Config saved for user: ${userUuid}`);
    res.json({ success: true, manifestUrl, userUuid });
  } catch (error) {
    console.error('❌ Error saving config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// API: LOGIN STREMIO & TMDB SEARCH
// ============================================================
app.post('/api/stremio/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }
  
  try {
    console.log(`🔐 Attempting Stremio login for: ${email}`);
    const auth = await stremioApi.stremioLogin(email, password);
    console.log('✅ Stremio login successful');
    
    const rawLibrary = await stremioApi.getStremioLibraryRaw(auth.token);
    const activeItems = rawLibrary.filter(i => !i.removed && !i.temp);
    const continueWatching = stremioApi.getContinueWatchingFromLibrary(rawLibrary);
    const seeds = stremioApi.extractSeedsFromLibrary(rawLibrary, continueWatching);
    
    const enrichedSeeds = await Promise.all(seeds.map(async (seed) => {
      if (!seed.poster && seed.title) {
        try {
          const searchResults = await tmdb.searchTmdb(seed.title, seed.type, 'en');
          if (searchResults && searchResults.length > 0) {
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
        id: cw.content_id,
        title: cw.title,
        type: cw.type,
        poster_path: cw.poster,
        progressPercent: cw.percent
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
    console.error('❌ Stremio login error:', error.message);
    res.status(401).json({
      success: false,
      error: error.message || 'Stremio login failed. Please check your credentials.'
    });
  }
});

app.get('/api/search', async (req, res) => {
  const { q, type, language = 'en' } = req.query;
  if (!q || q.length < 2) return res.json([]);
  
  try {
    let results;
    if (type === 'anime') {
      results = await tmdb.searchAnime(q, language);
    } else {
      results = await tmdb.searchTmdb(q, type, language);
    }
    res.json(results || []);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json([]);
  }
});

// ============================================================
// API UTILITY (Lingue, Cache, Health)
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

app.post('/api/invalidate/:userUuid', (req, res) => {
  const { userUuid } = req.params;
  if (catalogHandler && catalogHandler.invalidateCache) {
    catalogHandler.invalidateCache(userUuid);
  }
  console.log(`🗑️ Cache invalidated for user: ${userUuid}`);
  res.json({ ok: true });
});

app.get('/api/user-stats/:userUuid', async (req, res) => {
  const { userUuid } = req.params;
  try {
    const config = await getUserConfig(userUuid);
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
    console.error('Error getting user stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/cache/health', (req, res) => {
  const keysCount = catalogHandler?.cache?.keys()?.length || 0;
  res.json({ status: 'ok', keys: keysCount });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    addon: 'racconmendations',
    version: '3.0.0'
  });
});

// ============================================================
// AVVIO SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦝 Racconmendations addon running on port ${PORT}`);
  console.log(`📋 Configure page: http://localhost:${PORT}/configure`);
  console.log(`📄 Manifest: http://localhost:${PORT}/manifest.json`);
});

module.exports = app;
