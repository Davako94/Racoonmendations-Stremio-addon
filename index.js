const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');
const { saveUserConfig, getUserConfig, getUserSeeds, getUserLanguage } = require('./src/services/userStore');
const stremioApi = require('./src/services/stremioApi');
const tmdb = require('./src/services/tmdb');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// ============================================================
// MANIFEST
// ============================================================
app.get('/manifest.json', (req, res) => {
  const userUuid = req.query.uuid;
  res.json(getManifest(userUuid));
});

// ============================================================
// CATALOGO
// ============================================================
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (!['movie', 'series'].includes(type)) {
    return res.status(400).json({ metas: [] });
  }
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId);
    res.json({ metas });
  } catch (err) {
    console.error('Catalog error:', err);
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
// API: LOGIN STREMIO (REALE)
// ============================================================
app.post('/api/stremio/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }
  
  try {
    console.log(`🔐 Attempting Stremio login for: ${email}`);
    
    // Login e fetch libreria
    const auth = await stremioApi.stremioLogin(email, password);
    console.log('✅ Stremio login successful');
    
    const rawLibrary = await stremioApi.getStremioLibraryRaw(auth.token);
    console.log(`📚 Raw library items: ${rawLibrary.length}`);
    
    // Filtra solo attivi
    const activeItems = rawLibrary.filter(i => !i.removed && !i.temp);
    console.log(`📚 Active items: ${activeItems.length} (movies: ${activeItems.filter(i => i.type === 'movie').length}, series: ${activeItems.filter(i => i.type === 'series' || i.type === 'show').length})`);
    
    // Calcola continue watching
    const continueWatching = stremioApi.getContinueWatchingFromLibrary(rawLibrary);
    console.log(`⏯️ Continue watching: ${continueWatching.length}`);
    
    // Estrai i seed di base
    const seeds = stremioApi.extractSeedsFromLibrary(rawLibrary, continueWatching);
    console.log(`🌱 Seeds extracted: ${seeds.length}`);
    
    // Arricchisci ogni seed con poster da TMDB (se manca)
    const enrichedSeeds = await Promise.all(seeds.map(async (seed) => {
      if (!seed.poster && seed.title) {
        try {
          const searchResults = await tmdb.searchTmdb(seed.title, seed.type, 'en');
          if (searchResults && searchResults.length > 0) {
            seed.poster_path = searchResults[0].poster_path;
            seed.tmdb_id = searchResults[0].id;
          }
        } catch(e) { 
          // ignora errori di TMDB
        }
      }
      return seed;
    }));
    
    // Prepara la risposta per la UI
    const libraryForUI = activeItems.map(item => ({
      id: stremioApi.extractContentId(item._id || item.id) || (item._id || item.id),
      title: item.name,
      type: item.type === 'series' || item.type === 'show' ? 'series' : 'movie',
      poster_path: item.poster,
      year: item.year
    }));
    
    // Deduplica la libreria per ID
    const uniqueLibrary = [];
    const seenIds = new Set();
    for (const item of libraryForUI) {
      if (item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        uniqueLibrary.push(item);
      }
    }
    
    console.log(`✅ Final library for UI: ${uniqueLibrary.length} items`);
    
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

// ============================================================
// API: SALVA CONFIGURAZIONE UTENTE
// ============================================================
app.post('/api/save-config', async (req, res) => {
  const { 
    stremioEmail, 
    selectedMovies, 
    selectedSeries, 
    selectedAnime, 
    language, 
    prefs, 
    existingUuid 
  } = req.body;
  
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
    const manifestUrl = `${baseUrl}/manifest.json?uuid=${userUuid}`;
    
    console.log(`✅ Config saved for user: ${userUuid}`);
    
    res.json({ 
      success: true, 
      manifestUrl, 
      userUuid 
    });
  } catch (error) {
    console.error('❌ Error saving config:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ============================================================
// API: RICERCA TMDB (multilingua)
// ============================================================
app.get('/api/search', async (req, res) => {
  const { q, type, language = 'en' } = req.query;
  
  if (!q || q.length < 2) {
    return res.json([]);
  }
  
  try {
    let results;
    if (type === 'anime') {
      results = await tmdb.searchAnime(q);
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
// API: LINGUE SUPPORTATE
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
// API: INVALIDA CACHE (webhook)
// ============================================================
app.post('/api/invalidate/:userUuid', (req, res) => {
  const { userUuid } = req.params;
  catalogHandler.invalidateCache(userUuid);
  console.log(`🗑️ Cache invalidated for user: ${userUuid}`);
  res.json({ ok: true });
});

// ============================================================
// API: OTTIENE STATISTICHE UTENTE
// ============================================================
app.get('/api/user-stats/:userUuid', async (req, res) => {
  const { userUuid } = req.params;
  try {
    const config = await getUserConfig(userUuid);
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
    console.error('Error getting user stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    addon: 'racoonmendations',
    version: '3.0.0'
  });
});

// ============================================================
// AVVIO SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦝 Racoonmendations addon running on port ${PORT}`);
  console.log(`📋 Configure page: http://localhost:${PORT}/configure`);
  console.log(`📄 Manifest: http://localhost:${PORT}/manifest.json`);
});
