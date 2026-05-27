const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserConfig, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 }); // 2 giorni

async function getCatalog(catalogType, catalogId) {
  console.log(`📺 getCatalog: type=${catalogType}, catalogId=${catalogId}`);
  
  // Parse del catalogId
  const parts = catalogId.split('-');
  const prefix = parts[0]; // 'sim', 'rec', 'setup'
  const mediaType = parts[1]; // 'movie' o 'series'
  let seedId = null;
  let userUuid = null;
  
  if (prefix === 'sim') {
    seedId = parts[2];
    userUuid = parts.slice(3).join('-');
  } else if (prefix === 'rec') {
    userUuid = parts.slice(2).join('-');
  } else if (prefix === 'setup') {
    userUuid = parts.slice(2).join('-');
    return [{
      id: "setup_placeholder",
      type: catalogType,
      name: "⚠️ Configure your addon",
      poster: null,
      description: "Go to /configure to select your favorite movies and series",
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
    
    // Cerca il seed nel database
    const config = await getUserConfig(userUuid);
    let seedTitle = '';
    let seedGenres = [];
    if (mediaType === 'movie') {
      const found = (config.selected_movies || []).find(m => m.id === seedId);
      seedTitle = found?.title || seedId;
      seedGenres = found?.genres || [];
    } else {
      const found = (config.selected_series || []).find(s => s.id === seedId);
      seedTitle = found?.title || seedId;
      seedGenres = found?.genres || [];
    }
    
    try {
      // Raccogliamo da MULTIPLE FONTI per avere più varietà
      let allItems = [];
      
      // Fonte 1: Recommendations
      const recs = await tmdb.getRecommendations(mediaType, seedId, language);
      allItems.push(...recs);
      
      // Fonte 2: Similar
      const similar = await tmdb.getSimilar(mediaType, seedId, language);
      allItems.push(...similar);
      
      // Fonte 3: Se abbiamo i generi, cerca per genere (solo per varietà)
      if (seedGenres && seedGenres.length > 0) {
        const genreId = seedGenres[0]?.id || seedGenres[0];
        if (genreId) {
          const byGenre = await tmdb.getByGenre(mediaType, genreId, language);
          allItems.push(...byGenre);
        }
      }
      
      // Fonte 4: Popolari dello stesso genere
      const popular = await tmdb.getPopular(mediaType, language);
      allItems.push(...popular);
      
      // Deduplica per ID
      const unique = new Map();
      for (const item of allItems) {
        if (item.id && !unique.has(item.id)) {
          unique.set(item.id, item);
        }
      }
      
      // Converti in array e mescola per evitare ordine prevedibile
      let items = Array.from(unique.values());
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      
      // Prendi i primi 50
      items = items.slice(0, 50);
      
      metas = items.map(item => ({
        id: `sim_${seedId}_${item.id}`,
        type: mediaType,
        name: item.title,
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        description: item.overview || `Similar to ${seedTitle}`,
        releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
        voteAverage: item.vote_average || 0,
        extra: {}
      }));
      
      // Ordina per voto (opzionale, commenta se vuoi casuale)
      // metas.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));
      
      console.log(`   Trovati ${metas.length} simili per ${seedTitle} (da ${unique.size} unici)`);
      
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
    
    // Raccogli raccomandazioni da TUTTI i seed
    for (const seed of seeds) {
      const seedId = seed.tmdb_id || seed.id;
      if (seedId) {
        try {
          const recs = await tmdb.getRecommendations(mediaType, seedId, language);
          allRecs.push(...recs);
          
          const similar = await tmdb.getSimilar(mediaType, seedId, language);
          allRecs.push(...similar);
        } catch (err) {
          // ignora errori per singoli seed
        }
      }
    }
    
    // Aggiungi anche popolari come fallback
    const popular = await tmdb.getPopular(mediaType, language);
    allRecs.push(...popular);
    
    // Deduplica
    const unique = new Map();
    for (const rec of allRecs) {
      if (!unique.has(rec.id)) {
        unique.set(rec.id, rec);
      }
    }
    
    // Mescola
    let items = Array.from(unique.values());
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    
    // Prendi i primi 50
    items = items.slice(0, 50);
    
    metas = items.map(item => ({
      id: `rec_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || `Potrebbe piacerti`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
    
    console.log(`   Trovate ${metas.length} raccomandazioni (da ${unique.size} unici)`);
  }
  
  // Fallback definitivo: se ancora vuoto, popolari
  if (metas.length === 0) {
    console.log(`⚠️ Nessun risultato, uso popolari per ${mediaType || catalogType}`);
    try {
      const popular = await tmdb.getPopular(mediaType || catalogType, language);
      metas = popular.slice(0, 50).map(item => ({
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
