const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

// Cache with 1 hour TTL for catalog refresh
// Check every 10 minutes to clean expired entries
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// ============================================================
// SCORING ALGORITHM (ispirato a Watchly)
// ============================================================
function scoreItem(item) {
  // Formula IMDb weighted rating: (v/(v+m))*R + (m/(v+m))*C
  // v = numero voti, m = voti minimi per considerare il voto, R = voto medio, C = voto medio database
  
  const R = item.vote_average || 0; // Voto medio dell'elemento
  const v = item.vote_count || 0; // Numero di voti
  const m = 100; // Numero minimo di voti per considerare il voto
  const C = 6.5; // Voto medio di tutti i film su TMDB
  
  let baseScore = (v / (v + m)) * R + (m / (v + m)) * C;
  
  // Bonus per popolarità e rating elevato (Watchly: +5%)
  if ((item.popularity || 0) > 500 && R > 7.5) {
    baseScore += 0.5;
  }
  
  // Bonus per numero di voti elevato (Watchly: +10%)
  if (v >= 100 && R >= 7.0) {
    baseScore += 1.0;
  }
  
  // Normalizza su 0-10
  return Math.min(10, Math.max(0, baseScore));
}

// ============================================================
// MERGE E SCORE RISULTATI
// ============================================================
function mergeAndScoreItems(recs, similar) {
  const merged = [...recs, ...similar];
  const unique = new Map();
  
  for (const item of merged) {
    if (item && item.id && !unique.has(item.id)) {
      unique.set(item.id, {
        ...item,
        score: scoreItem(item)
      });
    }
  }
  
  const items = Array.from(unique.values());
  // Ordina per score decrescente
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  return items;
}

async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`📺 getCatalog: ${catalogType}/${catalogId} (uuid: ${userUuid})`);

  // Fallback: se AIOMetadata non passa userUuid via query string, lo estraiamo dall'ID del catalogo
  let finalUuid = userUuid;
  if (!finalUuid && catalogId.includes('_')) {
    const parts = catalogId.split('_');
    finalUuid = parts[parts.length - 1]; // L'UUID si trova sempre alla fine
  }

  const cacheKey = `${catalogId}:${finalUuid || 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache: ${cached.length} items`);
    return cached;
  }

  let seedId = null;
  let isRecommendations = false;

  // Logica di parsing compatibile con AIOMetadata (separatore '_')
  if (catalogId.startsWith('similar_')) {
    const parts = catalogId.split('_');
    if (parts.length >= 2) {
      seedId = parts[1]; // Prende l'ID di TMDB o IMDb
      if (seedId.startsWith('tmdb:')) seedId = seedId.replace('tmdb:', '');
      console.log(`   🎯 Seed trovato: ${seedId}`);
    }
  }
  
  if (catalogId.startsWith('rec_')) {
    isRecommendations = true;
    console.log(`   ✨ Caricamento Recommendations`);
  }

  const language = await getUserLanguage(finalUuid);
  let items = [];

  if (seedId) {
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    try {
      const [recs, similar] = await Promise.all([
        tmdb.getRecommendations(mediaType, seedId, language).catch(() => []),
        tmdb.getSimilar(mediaType, seedId, language).catch(() => [])
      ]);
      
      items = mergeAndScoreItems(recs, similar);
      items = items.slice(0, 20);
      console.log(`   Trovati ${items.length} elementi simili (scored)`);
    } catch (err) {
      console.error(`   Errore nel recupero dei simili TMDB:`, err.message);
    }
  }

  if (isRecommendations) {
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    items = await tmdb.getPopular(mediaType, language, 2);
    // Aggiungi score anche ai risultati popolari
    items = items.map(item => ({
      ...item,
      score: scoreItem(item)
    })).sort((a, b) => (b.score || 0) - (a.score || 0));
    items = items.slice(0, 20);
  }

  if (!items.length) {
    const fallbackType = catalogType === 'movie' ? 'movie' : 'tv';
    items = await tmdb.getPopular(fallbackType, language, 1);
    items = items.map(item => ({
      ...item,
      score: scoreItem(item)
    })).sort((a, b) => (b.score || 0) - (a.score || 0));
    items = items.slice(0, 20);
  }

  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: catalogType === 'movie' ? 'movie' : 'series',
    name: item.title || item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    description: item.overview || '',
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
    extra: {}
  }));

  console.log(`✅ Generati ${metas.length} elementi meta`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per UUID: ${keys.length}`);
}

module.exports = { getCatalog, invalidateCache };

