const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

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

  // Nuova logica di parsing compatibile con AIOMetadata (separatore '_')
  if (catalogId.startsWith('similar_')) {
    const parts = catalogId.split('_');
    if (parts.length >= 2) {
      seedId = parts[1]; // Prende l'ID di TMDB o IMDb (es. tt1529235 o 12345)
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
      
      const merged = [...recs, ...similar];
      const unique = new Map();
      for (const item of merged) {
        if (item && item.id && !unique.has(item.id)) unique.set(item.id, item);
      }
      
      items = Array.from(unique.values());
      items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
      items = items.slice(0, 20);
      console.log(`   Trovati ${items.length} elementi simili`);
    } catch (err) {
      console.error(`   Errore nel recupero dei simili TMDB:`, err.message);
    }
  }

  if (isRecommendations) {
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    items = await tmdb.getPopular(mediaType, language, 2);
    items = items.slice(0, 20);
  }

  if (!items.length) {
    const fallbackType = catalogType === 'movie' ? 'movie' : 'tv';
    items = await tmdb.getPopular(fallbackType, language, 1);
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
