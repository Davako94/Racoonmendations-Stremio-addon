const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');
const { saveUserConfig, getUserConfig, updateUserSeeds } = require('./src/services/userStore');
const stremioApi = require('./src/services/stremioApi');
const tmdb = require('./src/services/tmdb');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// Manifest - supporta UUID come parametro query
app.get('/manifest.json', (req, res) => {
  const userUuid = req.query.uuid;
  res.json(getManifest(userUuid));
});

// Catalogo - estrae l'UUID dall'ID del catalogo
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (!['movie', 'series', 'anime'].includes(type)) {
    return res.status(400).json({ metas: [] });
  }
  try {
    const metas = await catalogHandler.getCatalog(type, catalogId);
    res.json({ metas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ metas: [] });
  }
});

// Config page
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/configure.html'));
});

// API: login Stremio + fetch library
app.post('/api/stremio/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { authKey, userId } = await stremioApi.stremioLogin(email, password);
    const library = await stremioApi.getStremioLibrary(authKey, userId);
    const continueWatching = stremioApi.getContinueWatchingFromLibrary(library);
    const allSeeds = stremioApi.extractSeedsFromLibrary(library, continueWatching);
    
    // Per ogni seed, arricchisci con TMDB ID
    const enrichedSeeds = await Promise.all(allSeeds.map(async seed => {
      if (seed.id && seed.id.startsWith('tt')) {
        return { ...seed, tmdb_id: seed.id };
      }
      const searchResults = await tmdb.searchTmdb(seed.title, seed.type);
      if (searchResults.length > 0) {
        return { ...seed, tmdb_id: searchResults[0].id };
      }
      return seed;
    }));
    
    res.json({ 
      success: true, 
      library: enrichedSeeds,
      continueWatching 
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ success: false, error: err.message });
  }
});

// API: salva configurazione utente
app.post('/api/save-config', async (req, res) => {
  const { stremioEmail, selectedMovies, selectedSeries, selectedAnime, prefs, existingUuid } = req.body;
  const userUuid = existingUuid || uuidv4();
  await saveUserConfig(userUuid, {
    stremioEmail,
    selectedMovies,
    selectedSeries,
    selectedAnime,
    prefs
  });
  // URL CORRETTO: manifest.json con UUID come parametro
  const manifestUrl = `${process.env.ADDON_BASE_URL || req.protocol + '://' + req.get('host')}/manifest.json?uuid=${userUuid}`;
  res.json({ success: true, manifestUrl, userUuid });
});

// API: ricerca TMDB (per frontend)
app.get('/api/search', async (req, res) => {
  const { q, type } = req.query;
  if (!q || q.length < 2) return res.json([]);
  let results;
  if (type === 'anime') {
    results = await tmdb.searchAnime(q);
  } else {
    results = await tmdb.searchTmdb(q, type);
  }
  res.json(results);
});

// API: invalida cache (webhook)
app.post('/api/invalidate/:userUuid', (req, res) => {
  catalogHandler.invalidateCache(req.params.userUuid);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Addon running on port ${PORT}`));
