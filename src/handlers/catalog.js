const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserSeeds, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

async function getCatalog(catalogType, userUuid) {
  console.log(`📺 getCatalog: type=${catalogType}, user=${userUuid}`);
  
  const cacheKey = `${catalogType}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache hit: ${cached.length} items`);
    return cached;
  }

  const seeds = await getUserSeeds(userUuid, catalogType);
  const language = await getUserLanguage(userUuid);
  
  console.log(`   Seeds trovati: ${seeds.length}`);
  
  if (!seeds.length) {
    // Nessun seed configurato
    const setupMetas = [{
      id: "setup_placeholder",
      type: catalogType,
      name: "⚙️ Configure Racconmendations",
      poster: null,
      description: "Open /configure to select your favorite movies and series",
      releaseInfo: "",
      extra: {}
    }];
    cache.set(cacheKey, setupMetas);
    return setupMetas;
  }
  
  // Raccogli raccomandazioni da tutti i seed
  let allRecommendations = [];
  
  for (const seed of seeds.slice(0, 10)) {
    const seedId = seed.tmdb_id || seed.id;
    if (!seedId) continue;
    
    try {
      const recs = await tmdb.getRecommendations(catalogType, seedId, language);
      const similar = await tmdb.getSimilar(catalogType, seedId, language);
      allRecommendations.push(...recs, ...similar);
    } catch (err) {
      console.error(`Error fetching for ${seed.title}:`, err.message);
    }
  }
  
  // Deduplica e ordina per voto
  const unique = new Map();
  for (const rec of allRecommendations) {
    if (!unique.has(rec.id)) {
      unique.set(rec.id, rec);
    }
  }
  
  let items = Array.from(unique.values());
  items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  items = items.slice(0, 30);
  
  if (!items.length) {
    // Fallback: popolari
    const popular = await tmdb.getPopular(catalogType, language, 2);
    items = popular.slice(0, 20);
  }
  
  const metas = items.map(item => ({
    id: `tt_${item.id}`,
    type: catalogType,
    name: item.title,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    description: item.overview || `Recommended based on your ${catalogType}s`,
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
    extra: {}
  }));
  
  console.log(`   ✅ Generati ${metas.length} items`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache, cache };
