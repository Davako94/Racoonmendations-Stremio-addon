const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserSeeds, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 3600 });

async function getCatalog(catalogType, catalogId) {
  // Estrai UUID dall'ID del catalogo
  let userUuid = null;
  if (catalogId) {
    const parts = catalogId.split('-');
    if (parts.length >= 2) {
      userUuid = parts.slice(1).join('-');
    }
  }
  
  if (!userUuid) return [];
  
  const cacheKey = `${catalogType}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) return cached;

  const seeds = await getUserSeeds(userUuid, catalogType);
  const language = await getUserLanguage(userUuid);
  
  if (!seeds.length) return [];

  const allMetas = [];
  
  // 1. Per ogni seed, crea una sezione "Similar to X" (max 10 per seed)
  for (let seed of seeds) {
    const similar = await tmdb.getSimilar(seed.type, seed.tmdb_id || seed.id, language);
    const similarMetas = similar.slice(0, 10).map(item => ({
      id: `sim_${item.id}`,
      type: catalogType === 'movie' ? 'movie' : 'series',
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      posterShape: 'poster',
      background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
      description: item.overview || `Similar to ${seed.title}`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      videos: [],
      links: [],
      extra: {
        recommendationSeed: `🎬 Similar to ${seed.title}`
      }
    }));
    allMetas.push(...similarMetas);
  }
  
  // 2. Sezione "Recommended for you" (misto da tutti i seed)
  let allRecommendations = [];
  for (let seed of seeds) {
    const recs = await tmdb.getRecommendations(seed.type, seed.tmdb_id || seed.id, language);
    allRecommendations.push(...recs);
  }
  
  // Deduplica
  const uniqueRecs = new Map();
  for (let rec of allRecommendations) {
    if (!uniqueRecs.has(rec.id)) {
      uniqueRecs.set(rec.id, rec);
    }
  }
  
  const recommendedMetas = Array.from(uniqueRecs.values()).slice(0, 20).map(item => ({
    id: `rec_${item.id}`,
    type: catalogType === 'movie' ? 'movie' : 'series',
    name: item.title,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    posterShape: 'poster',
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null,
    description: item.overview || `Recommended based on your favorites`,
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
    extra: {
      recommendationSeed: `✨ Recommended for You`
    }
  }));
  
  allMetas.push(...recommendedMetas);
  
  // 3. Sezione "Random from your watchlist" (casuali)
  const randomSeeds = [...seeds];
  for (let i = randomSeeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [randomSeeds[i], randomSeeds[j]] = [randomSeeds[j], randomSeeds[i]];
  }
  
  const randomMetas = randomSeeds.slice(0, 10).map(seed => ({
    id: `rand_${seed.tmdb_id || seed.id}`,
    type: catalogType === 'movie' ? 'movie' : 'series',
    name: seed.title,
    poster: seed.poster_path ? `https://image.tmdb.org/t/p/w342${seed.poster_path}` : null,
    posterShape: 'poster',
    description: `🍿 From your library: ${seed.title}`,
    releaseInfo: '',
    extra: {
      recommendationSeed: `📌 From your collection`
    }
  }));
  
  allMetas.push(...randomMetas);
  
  // Limite totale a 100 items
  const finalMetas = allMetas.slice(0, 100);
  
  cache.set(cacheKey, finalMetas);
  return finalMetas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
}

module.exports = { getCatalog, invalidateCache };
