const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserSeeds } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 3600 });

async function getCatalog(catalogType, catalogId) {
  // Estrai l'UUID dall'ID del catalogo (es. "rec-movies-abc-123" -> "abc-123")
  let userUuid = null;
  if (catalogId) {
    const parts = catalogId.split('-');
    // L'ultima parte è l'UUID se abbiamo almeno 3 parti (rec-movies-UUID)
    if (parts.length >= 3) {
      userUuid = parts.slice(2).join('-'); // Prende tutto dopo "rec-movies"
    }
  }
  
  if (!userUuid) {
    console.error('No UUID found in catalogId:', catalogId);
    return [];
  }
  
  const cacheKey = `${catalogType}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) return cached;

  const seeds = await getUserSeeds(userUuid, catalogType);
  if (!seeds.length) return [];

  let allRecs = [];
  for (let seed of seeds) {
    const recommendations = await tmdb.getRecommendations(seed.type, seed.tmdb_id || seed.id);
    const similar = await tmdb.getSimilar(seed.type, seed.tmdb_id || seed.id);
    const combined = [...recommendations, ...similar];
    for (let item of combined) {
      item._seedTitle = seed.title;
    }
    allRecs.push(...combined);
  }

  // Deduplica per ID
  const unique = new Map();
  for (let rec of allRecs) {
    if (!unique.has(rec.id)) {
      unique.set(rec.id, { ...rec, _seedTitles: [rec._seedTitle] });
    } else {
      const existing = unique.get(rec.id);
      if (!existing._seedTitles.includes(rec._seedTitle)) {
        existing._seedTitles.push(rec._seedTitle);
      }
    }
  }

  // Scoring: voto medio
  let results = Array.from(unique.values());
  results.sort((a,b) => (b.vote_average || 0) - (a.vote_average || 0));
  results = results.slice(0, 50);

  // Formato Stremio meta
  const metas = results.map(item => {
    let label = '';
    if (item._seedTitles.length === 1) {
      label = `Simili a ${item._seedTitles[0]}`;
    } else {
      label = `Simili a ${item._seedTitles.slice(0,3).join(', ')}${item._seedTitles.length > 3 ? '...' : ''}`;
    }
    return {
      id: `rec_${item.id}`,
      type: catalogType === 'movie' ? 'movie' : (catalogType === 'series' ? 'series' : 'anime'),
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || label,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {
        recommendationSeed: label
      }
    };
  });

  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
}

module.exports = { getCatalog, invalidateCache };
