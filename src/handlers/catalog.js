const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserConfig, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 }); // 2 giorni

async function getCatalog(catalogType, catalogId) {
  console.log(`📺 getCatalog: type=${catalogType}, catalogId=${catalogId}`);
  
  // Parse del catalogId per capire cosa chiedere
  // Formati possibili:
  // - sim-movie-{seedId}-{userUuid}
  // - sim-series-{seedId}-{userUuid}
  // - rec-movies-{userUuid}
  // - rec-series-{userUuid}
  // - setup-movie-{userUuid} (pagina di setup)
  
  const parts = catalogId.split('-');
  const prefix = parts[0]; // 'sim', 'rec', 'setup'
  const mediaType = parts[1]; // 'movie' o 'series'
  let seedId = null;
  let userUuid = null;
  
  if (prefix === 'sim') {
    // sim-movie-tt1234567-abc123
    seedId = parts[2];
    userUuid = parts.slice(3).join('-');
  } else if (prefix === 'rec') {
    // rec-movies-abc123
    userUuid = parts.slice(2).join('-');
  } else if (prefix === 'setup') {
    // setup-movie-abc123
    userUuid = parts.slice(2).join('-');
    // Pagina di setup: mostra messaggio per configurare l'addon
    return [{
      id: "setup_placeholder",
      type: catalogType,
      name: "⚠️ Configura il tuo addon",
      poster: null,
      description: "Vai su /configure per selezionare i tuoi film e serie preferiti",
      releaseInfo: "",
      extra: {}
    }];
  }
  
  if (!userUuid) {
    console.error('❌ No UUID found in catalogId:', catalogId);
    return [];
  }
  
  const cacheKey = `${catalogId}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`📦 Cache hit: ${cached.length} items`);
    return cached;
  }
  
  const language = await getUserLanguage(userUuid);
  let metas = [];
  
  if (prefix === 'sim' && seedId) {
    // Catalogo "Simili a X"
    console.log(`🎯 Simili a: seedId=${seedId}, type=${mediaType}`);
    
    // Cerca il seed nel database per avere il titolo
    const config = await getUserConfig(userUuid);
    let seedTitle = '';
    if (mediaType === 'movie') {
      const found = (config.selected_movies || []).find(m => m.id === seedId);
      seedTitle = found?.title || seedId;
    } else {
      const found = (config.selected_series || []).find(s => s.id === seedId);
      seedTitle = found?.title || seedId;
    }
    
    try {
      let items = await tmdb.getRecommendations(mediaType, seedId, language);
      if (!items || !items.length) {
        items = await tmdb.getSimilar(mediaType, seedId, language);
      }
      if (!items || !items.length) {
        items = await tmdb.getPopular(mediaType, language);
      }
      
      metas = items.slice(0, 15).map(item => ({
        id: `sim_${seedId}_${item.id}`,
        type: mediaType,
        name: item.title,
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        description: item.overview || `Simili a ${seedTitle}`,
        releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
        extra: {}
      }));
      
      console.log(`   Trovati ${metas.length} simili per ${seedTitle}`);
      
    } catch (err) {
      console.error(`Errore fetching per ${seedTitle}:`, err.message);
    }
    
  } else if (prefix === 'rec') {
    // Catalogo "Potrebbero piacerti anche"
    console.log(`✨ Raccomandazioni per ${mediaType}`);
    
    const config = await getUserConfig(userUuid);
    const seeds = mediaType === 'movie' 
      ? (config.selected_movies || [])
      : (config.selected_series || []);
    
    let allRecs = [];
    for (const seed of seeds.slice(0, 10)) {
      const seedId = seed.tmdb_id || seed.id;
      if (seedId) {
        try {
          const recs = await tmdb.getRecommendations(mediaType, seedId, language);
          allRecs.push(...recs);
        } catch (err) {
          // ignora errori per singoli seed
        }
      }
    }
    
    // Deduplica per ID
    const unique = new Map();
    for (const rec of allRecs) {
      if (!unique.has(rec.id)) {
        unique.set(rec.id, rec);
      }
    }
    
    metas = Array.from(unique.values()).slice(0, 30).map(item => ({
      id: `rec_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || `Potrebbe piacerti`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
    
    console.log(`   Trovate ${metas.length} raccomandazioni`);
  }
  
  // Fallback: se vuoto, restituisci popolari
  if (metas.length === 0) {
    console.log(`⚠️ Nessun risultato, uso popolari per ${mediaType || catalogType}`);
    try {
      const popular = await tmdb.getPopular(mediaType || catalogType, language);
      metas = popular.slice(0, 20).map(item => ({
        id: `pop_${item.id}`,
        type: mediaType || catalogType,
        name: item.title,
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        description: item.overview || `Popolare`,
        releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
        extra: {}
      }));
    } catch (err) {
      console.error('Error fetching popular:', err.message);
    }
  }
  
  console.log(`✅ Generati ${metas.length} items per ${catalogId}`);
  
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  if (keys.length) {
    cache.del(keys);
    console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} keys`);
  }
}

module.exports = { getCatalog, invalidateCache };
