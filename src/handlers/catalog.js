const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`📺 getCatalog: ${catalogType}/${catalogId} (uuid: ${userUuid})`);

  const cacheKey = `${catalogId}:${userUuid}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache: ${cached.length} items`);
    return cached;
  }

  let seedId = null;
  let isRecommendations = false;

  // Parsing: similar--tt123456--uuid
  if (catalogId.includes('similar--')) {
    const parts = catalogId.split('--');
    if (parts.length >= 2) {
      seedId = parts[1];
      if (seedId.startsWith('tmdb:')) seedId = seedId.replace('tmdb:', '');
      console.log(`   🎯 Seed: ${seedId}`);
    }
  }
  
  if (catalogId.includes('rec-')) {
    isRecommendations = true;
    console.log(`   ✨ Recommendations`);
  }

  const language = await getUserLanguage(userUuid);
  let items = [];

  if (seedId) {
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    try {
      const [recs, similar] = await Promise.all([
        tmdb.getRecommendations(mediaType, seedId, language),
        tmdb.getSimilar(mediaType, seedId, language)
      ]);
      
      const merged = [...recs, ...similar];
      const unique = new Map();
      for (const item of merged) {
        if (item && item.id && !unique.has(item.id)) unique.set(item.id, item);
      }
      
      items = Array.from(unique.values());
      items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
      items = items.slice(0, 20);
      console.log(`   Found ${items.length} similar`);
    } catch (err) {
      console.error(`   Error:`, err.message);
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
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
    extra: {}
  }));

  console.log(`✅ Generated ${metas.length} items`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidated: ${keys.length}`);
}

module.exports = { getCatalog, invalidateCache };
