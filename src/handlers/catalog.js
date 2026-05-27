const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserSeeds, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

async function getCatalog(catalogType, catalogId) {
  console.log(`📺 getCatalog called: type=${catalogType}, catalogId=${catalogId}`);
  
  // Estrai UUID dall'ID del catalogo
  let userUuid = null;
  if (catalogId) {
    // Il catalogId arriva come "racoon-movies-abc-123" o "racoon-movies-abc-123"
    const parts = catalogId.split('-');
    // Prende tutto dopo le prime 2 parti (racoon-movies-UUID)
    if (parts.length >= 3) {
      userUuid = parts.slice(2).join('-');
    } else if (parts.length === 2) {
      userUuid = parts[1];
    }
  }
  
  if (!userUuid) {
    console.error('❌ No UUID found in catalogId:', catalogId);
    return [];
  }
  
  console.log(`🔍 Looking up user: ${userUuid}, type: ${catalogType}`);
  
  const cacheKey = `${catalogType}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`📦 Cache hit for ${cacheKey}, returning ${cached.length} items`);
    return cached;
  }

  // Recupera i seed dell'utente
  const allSeeds = await getUserSeeds(userUuid, catalogType);
  const language = await getUserLanguage(userUuid);
  
  console.log(`🌱 Found ${allSeeds.length} seeds for user ${userUuid} (${catalogType})`);
  
  if (!allSeeds.length) {
    console.log(`⚠️ No seeds found, returning empty catalog`);
    // Restituisci alcuni item di esempio per test
    const sampleMetas = [
      {
        id: "rec_550",
        type: catalogType,
        name: "Fight Club",
        poster: "https://image.tmdb.org/t/p/w342/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        description: "Sample movie - add more seeds to get recommendations",
        releaseInfo: "1999",
        extra: { recommendationSeed: "🎬 Example: Add more movies" }
      },
      {
        id: "rec_13",
        type: catalogType,
        name: "The Shawshank Redemption",
        poster: "https://image.tmdb.org/t/p/w342/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg",
        description: "Sample movie - add more seeds to get recommendations",
        releaseInfo: "1994",
        extra: { recommendationSeed: "🎬 Example: Add more movies" }
      }
    ];
    cache.set(cacheKey, sampleMetas);
    return sampleMetas;
  }

  // Seleziona 5 seed casuali
  const shuffledSeeds = [...allSeeds];
  for (let i = shuffledSeeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledSeeds[i], shuffledSeeds[j]] = [shuffledSeeds[j], shuffledSeeds[i]];
  }
  
  const selectedSeeds = shuffledSeeds.slice(0, 5);
  console.log(`🎲 Selected ${selectedSeeds.length} random seeds: ${selectedSeeds.map(s => s.title).join(', ')}`);
  
  const allMetas = [];
  
  // Per ogni seed, cerca similar
  for (let seed of selectedSeeds) {
    const seedId = seed.tmdb_id || seed.id;
    if (!seedId) {
      console.log(`⚠️ Seed "${seed.title}" has no ID, skipping`);
      continue;
    }
    
    console.log(`🔎 Fetching similar for "${seed.title}" (${seedId})...`);
    
    try {
      // Prova prima recommendations, poi similar
      let items = await tmdb.getRecommendations(seed.type, seedId, language);
      if (!items.length) {
        items = await tmdb.getSimilar(seed.type, seedId, language);
      }
      
      console.log(`   Found ${items.length} similar items`);
      
      const limitedItems = items.slice(0, 8);
      for (const item of limitedItems) {
        allMetas.push({
          id: `sim_${seedId}_${item.id}`,
          type: catalogType,
          name: item.title,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          description: item.overview || `Similar to ${seed.title}`,
          releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
          extra: {
            recommendationSeed: `🎬 Similar to ${seed.title}`
          }
        });
      }
    } catch (err) {
      console.error(`❌ Error fetching for ${seed.title}:`, err.message);
    }
  }
  
  // Se non abbiamo trovato nulla, usa popolari come fallback
  if (allMetas.length === 0) {
    console.log(`⚠️ No recommendations found, fetching popular ${catalogType}s...`);
    try {
      const popular = await tmdb.getPopular(catalogType, language);
      for (const item of popular.slice(0, 20)) {
        allMetas.push({
          id: `pop_${item.id}`,
          type: catalogType,
          name: item.title,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
          description: item.overview || `Popular ${catalogType}`,
          releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
          extra: {
            recommendationSeed: `🔥 Popular ${catalogType}s`
          }
        });
      }
    } catch (err) {
      console.error('Error fetching popular:', err.message);
    }
  }
  
  console.log(`✅ Generated ${allMetas.length} total items for ${catalogType}`);
  
  // Limita a 50 items
  const finalMetas = allMetas.slice(0, 50);
  
  // Salva in cache
  cache.set(cacheKey, finalMetas);
  
  return finalMetas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  if (keys.length) {
    cache.del(keys);
    console.log(`🗑️ Invalidated cache for ${userUuid}: ${keys.length} keys`);
  }
}

module.exports = { getCatalog, invalidateCache };
