const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const catalogHandler = require('./src/handlers/catalog');
const { getManifest } = require('./src/manifest');
const { saveUserConfig, getUserConfig } = require('./src/services/userStore');
const tmdb = require('./src/services/tmdb');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src/public')));

// Manifest
app.get('/manifest.json', (req, res) => {
  const userUuid = req.query.uuid;
  res.json(getManifest(userUuid));
});

// Catalogo
app.get('/catalog/:type/:catalogId.json', async (req, res) => {
  const { type, catalogId } = req.params;
  if (!['movie', 'series'].includes(type)) {
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

// API: salva configurazione utente
app.post('/api/save-config', async (req, res) => {
  const { stremioEmail, selectedMovies, selectedSeries, selectedAnime, language, prefs, existingUuid } = req.body;
  const userUuid = existingUuid || uuidv4();
  await saveUserConfig(userUuid, {
    stremioEmail,
    selectedMovies,
    selectedSeries,
    selectedAnime,
    language: language || 'en',
    prefs
  });
  const manifestUrl = `${process.env.ADDON_BASE_URL || req.protocol + '://' + req.get('host')}/manifest.json?uuid=${userUuid}`;
  res.json({ success: true, manifestUrl, userUuid });
});

// API: ricerca TMDB (multilingua)
app.get('/api/search', async (req, res) => {
  const { q, type, language = 'en' } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const results = await tmdb.searchTmdb(q, type, language);
  res.json(results);
});

// API: ottieni lingue supportate
app.get('/api/languages', (req, res) => {
  res.json([
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' }
  ]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Addon running on port ${PORT}`));
