const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserSeeds } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`📺 getCatalog: ${catalogType}/${catalogId} (uuid: ${userUuid})`);
  
  // Estrai seedId dal catalogId (formato: sim-movie-tt1234567-UUID)
  let seedId = null;
  let recType = null;
  
  if (catalogId.includes('sim-movie-')) {
    const parts = catalogId.split('-');
    seedId = parts[2];
    recType = 'movie';
  } else if (catalogId.includes('sim-series-')) {
    const parts = catalogId.split('-');
    seedId = parts[2];
    recType = 'series';
  } else if (catalogId.includes('rec-movies-')) {
    recType = 'rec-movies';
  } else if (catalogId.includes('rec-series-')) {
    recType = 'rec-series';
  } else if (catalogId.includes('setup')) {
    return [{
      id: 'setup_placeholder',
      type: catalogType,
      name: '⚙️ Configure Raccoonmendations',
      poster: null,
      description: 'Open /configure to select your favorites',
      releaseInfo: '',
      extra: {}
    }];
  }
  
  if (!userUuid) {
    console.log('   No user UUID');
    return [];
  }
  
  const cacheKey = `${catalogId}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   Cache hit: ${cached.length} items`);
    return cached;
  }
  
  const language = await getUserLanguage(userUuid);
  let items = [];
  
  if (seedId && recType) {
    // Similar to X
    console.log(`   Similar to: ${seedId} (${recType})`);
    
    const recs = await tmdb.getRecommendations(recType, seedId, language);
    const similar = await tmdb.getSimilar(recType, seedId, language);
    
    const allItems = [...recs, ...similar];
    const unique = new Map();
    for (const item of allItems) {
      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }
    
    items = Array.from(unique.values());
    items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    items = items.slice(0, 20);
    
    console.log(`   Found ${items.length} similar items`);
    
  } else if (recType === 'rec-movies') {
    // You might also like - Movies
    console.log(`   Recommendations for movies`);
    items = await tmdb.getPopular('movie', language, 2);
    items = items.slice(0, 20);
    
  } else if (recType === 'rec-series') {
    // You might also like - Series
    console.log(`   Recommendations for series`);
    items = await tmdb.getPopular('tv', language, 2);
    items = items.slice(0, 20);
  }
  
  if (!items.length) {
    console.log('   No results, using popular fallback');
    const popular = await tmdb.getPopular(catalogType === 'movie' ? 'movie' : 'tv', language, 1);
    items = popular.slice(0, 15);
  }
  
  const displayType = catalogType === 'movie' ? 'movie' : 'series';
  
  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: displayType,
    name: item.title,
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
  console.log(`🗑️ Cache invalidated: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache };
