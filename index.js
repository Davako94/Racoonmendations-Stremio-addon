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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

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

// ============================================================
// MANIFEST
// ============================================================

app.get('/manifest.json', async (req, res) => {
  try {
    const manifest = await getManifest(req.query.uuid);
    res.json(manifest);
  } catch (err) {
    console.error('Manifest error:', err);
    res.status(500).json({ error: 'Manifest error' });
  }
});

app.get('/:uuid/manifest.json', async (req, res) => {
  try {
    const manifest = await getManifest(req.params.uuid);
    res.json(manifest);
  } catch (err) {
    console.error('Manifest error:', err);
    res.status(500).json({ error: 'Manifest error' });
  }
});

app.get('/stremio/:uuid/config/manifest.json', async (req, res) => {
  try {
    const manifest = await getManifest(req.params.uuid);
    res.json(manifest);
  } catch (err) {
    console.error('Manifest error:', err);
    res.status(500).json({ error: 'Manifest error' });
  }
});

// ============================================================
// META
// ============================================================

app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;

    const mediaType = type === 'movie' ? 'movie' : 'tv';

    const details = await tmdb.getMeta(mediaType, id);

    if (!details) {
      return res.json({ meta: null });
    }

    res.json({
      meta: details
    });

  } catch (err) {
    console.error('Meta error:', err);
    res.json({ meta: null });
  }
});

app.get('/:uuid/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;

    const mediaType = type === 'movie' ? 'movie' : 'tv';

    const details = await tmdb.getMeta(mediaType, id);

    if (!details) {
      return res.json({ meta: null });
    }

    res.json({
      meta: details
    });

  } catch (err) {
    console.error('Meta error:', err);
    res.json({ meta: null });
  }
});

// ============================================================
// CATALOG
// ============================================================

app.get('/catalog/:type/:catalogId.json', async (req, res) => {
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

app.get('/:uuid/catalog/:type/:catalogId.json', async (req, res) => {
  try {
    const metas = await catalogHandler.getCatalog(
      req.params.type,
      req.params.catalogId,
      req.params.uuid
    );

    res.json({ metas });

  } catch (err) {
    console.error('Catalog error:', err);
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
      id: String(
        stremioApi.extractContentId(item._id || item.id)
      ),
      title: item.name,
      type:
        item.type === 'series' || item.type === 'show'
          ? 'series'
          : 'movie',
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

    const userUuid =
      existing?.uuid ||
      existingUuid ||
      uuidv4();

    const finalUuid = await saveUserConfig(userUuid, {
      stremioEmail: stremioEmail || 'manual@mode.com',
      selectedMovies: selectedMovies || [],
      selectedSeries: selectedSeries || [],
      selectedAnime: selectedAnime || [],
      language: language || 'en',
      prefs: prefs || ''
    });

    const baseUrl =
      process.env.ADDON_BASE_URL ||
      `${req.protocol}://${req.get('host')}`;

    const manifestUrl =
      `${baseUrl}/manifest.json?uuid=${finalUuid}`;

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

    const { q, type, language = 'en' } = req.query;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    const results =
      type === 'anime'
        ? await tmdb.searchAnime(q, language)
        : await tmdb.searchTmdb(q, type, language);

    res.json(results || []);

  } catch (err) {

    console.error('Search error:', err);

    res.json([]);
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
