const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserSeeds, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

async function getCatalog(catalogType, catalogId) {
  let userUuid = null;
  if (catalogId) {
    const parts = catalogId.split('-');
    if (parts.length >= 2) {
      userUuid = parts.slice(1).join('-');
    }
  }
  
  if (!userUuid) {
    console.error('No UUID found in catalogId:', catalogId);
    return [];
  }
  
  const cacheKey = `${catalogType}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`📦 Cache hit for ${catalogType}:${userUuid}`);
    return cached;
  }

  const allSeeds = await getUserSeeds(userUuid, catalogType);
  const language = await getUserLanguage(userUuid);
  
  if (!allSeeds.length) {
    console.log(`No seeds found for user ${userUuid}`);
    return [];
  }

  const shuffledSeeds = [...allSeeds];
  for (let i = shuffledSeeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledSeeds[i], shuffledSeeds[j]] = [shuffledSeeds[j], shuffledSeeds[i]];
  }
  
  const selectedSeeds = shuffledSeeds.slice(0, 5);
  console.log(`🎲 Selected ${selectedSeeds.length} random seeds for ${catalogType}: ${selectedSeeds.map(s => s.title).join(', ')}`);
  
  const allMetas = [];
  
  for (let seed of selectedSeeds) {
    if (!seed.tmdb_id && seed.id) {
      seed.tmdb_id = seed.id;
    }
    
    if (!seed.tmdb_id) {
      console.log(`⚠️ Seed "${seed.title}" has no TMDB ID, skipping`);
      continue;
    }
    
    try {
      const [recommendations, similar] = await Promise.all([
        tmdb.getRecommendations(seed.type, seed.tmdb_id, language),
        tmdb.getSimilar(seed.type, seed.tmdb_id, language)
      ]);
      
      const combined = [...recommendations, ...similar];
      const uniqueMap = new Map();
      
      for (const item of combined) {
        if (!uniqueMap.has(item.id)) {
          uniqueMap.set(item.id, item);
        }
      }
      
      const items = Array.from(uniqueMap.values()).slice(0, 8);
      
      console.log(`🎬 "${seed.title}" → ${items.length} similar items`);
      
      for (const item of items) {
        allMetas.push({
          id: `sim_${seed.id}_${item.id}`,
          type: catalogType === 'movie' ? 'movie' : 'series',
          name: item.title,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          posterShape: 'poster',
          description: item.overview || `Similar to ${seed.title}`,
          releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
          extra: {
            recommendationSeed: `🎬 Similar to ${seed.title}`
          }
        });
      }
    } catch (err) {
      console.error(`Error fetching recommendations for ${seed.title}:`, err.message);
    }
  }
  
  let allRecommendations = [];
  for (let seed of allSeeds) {
    if (!seed.tmdb_id && seed.id) seed.tmdb_id = seed.id;
    if (!seed.tmdb_id) continue;
    
    try {
      const recs = await tmdb.getRecommendations(seed.type, seed.tmdb_id, language);
      allRecommendations.push(...recs);
    } catch (err) {}
  }
  
  const uniqueRecs = new Map();
  for (const rec of allRecommendations) {
    if (!uniqueRecs.has(rec.id)) {
      uniqueRecs.set(rec.id, rec);
    }
  }
  
  const recommendedItems = Array.from(uniqueRecs.values()).slice(0, 15);
  console.log(`✨ Recommended for you: ${recommendedItems.length} items`);
  
  for (const item of recommendedItems) {
    allMetas.push({
      id: `rec_${item.id}`,
      type: catalogType === 'movie' ? 'movie' : 'series',
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      posterShape: 'poster',
      description: item.overview || `Recommended based on your taste`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {
        recommendationSeed: `✨ Recommended for You`
      }
    });
  }
  
  const shuffledAll = [...allSeeds];
  for (let i = shuffledAll.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAll[i], shuffledAll[j]] = [shuffledAll[j], shuffledAll[i]];
  }
  
  const randomItems = shuffledAll.slice(0, 10);
  for (const seed of randomItems) {
    allMetas.push({
      id: `rand_${seed.tmdb_id || seed.id}`,
      type: catalogType === 'movie' ? 'movie' : 'series',
      name: seed.title,
      poster: seed.poster_path ? `https://image.tmdb.org/t/p/w342${seed.poster_path}` : null,
      posterShape: 'poster',
      description: `From your collection: ${seed.title}`,
      releaseInfo: '',
      extra: {
        recommendationSeed: `📌 From your Library`
      }
    });
  }
  
  const finalMetas = allMetas.slice(0, 100);
  
  console.log(`✅ Catalog generated: ${finalMetas.length} total items for ${catalogType}`);
  
  cache.set(cacheKey, finalMetas);
  
  return finalMetas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  if (keys.length > 0) {
    cache.del(keys);
    console.log(`🗑️ Cache invalidated for user ${userUuid}: ${keys.length} keys`);
  }
}

module.exports = { getCatalog, invalidateCache };
