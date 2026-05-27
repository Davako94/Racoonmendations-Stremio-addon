const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`📺 getCatalog: ${catalogType}/${catalogId} (uuid: ${userUuid})`);

  if (!userUuid) {
    console.log('   ❌ No user UUID');
    return [];
  }

  const cacheKey = `${catalogId}:${userUuid}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache hit: ${cached.length} items`);
    return cached;
  }

  let seedId = null;
  let recType = null;

  // ============================================================
  // PARSING CORRETTO - gestisce UUID con trattini
  // ============================================================
  
  // Formato: sim-movie-{seedId}-{uuid}
  // dove uuid è l'ultima parte (dopo l'ultimo trattino? No, uuid ha 5 parti con trattini)
  // Esempio: sim-movie-tt0120889-349aac78-bd5c-41f2-9c9e-9b2320f8ded9
  // Il seedId è "tt0120889", il resto è l'UUID
  
  if (catalogId.startsWith('sim-movie-')) {
    // Rimuovi il prefisso "sim-movie-"
    const withoutPrefix = catalogId.replace('sim-movie-', '');
    // Trova la fine del seedId: è tutto fino al primo trattino che inizia un UUID valido
    // UUID ha formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12)
    const uuidMatch = withoutPrefix.match(/(-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    if (uuidMatch) {
      seedId = withoutPrefix.substring(0, uuidMatch.index);
      recType = 'movie';
      console.log(`   🎬 Parsed movie seed: ${seedId}`);
    }
  }
  
  if (catalogId.startsWith('sim-series-')) {
    const withoutPrefix = catalogId.replace('sim-series-', '');
    const uuidMatch = withoutPrefix.match(/(-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    if (uuidMatch) {
      seedId = withoutPrefix.substring(0, uuidMatch.index);
      recType = 'series';
      console.log(`   📺 Parsed series seed: ${seedId}`);
    }
  }
  
  if (catalogId.startsWith('rec-movies-')) {
    recType = 'rec-movies';
    console.log(`   ✨ Recommendations for movies`);
  }
  
  if (catalogId.startsWith('rec-series-')) {
    recType = 'rec-series';
    console.log(`   ✨ Recommendations for series`);
  }
  
  if (catalogId.includes('setup')) {
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

  const language = await getUserLanguage(userUuid);
  let items = [];

  // ============================================================
  // SIMILAR (per seed specifico)
  // ============================================================
  if (seedId && recType) {
    console.log(`   🔍 Fetching similar to: ${seedId} (${recType})`);
    
    // Pulisci l'ID (rimuovi eventuale prefisso tmdb:)
    let cleanSeedId = seedId;
    if (seedId.startsWith('tmdb:')) {
      cleanSeedId = seedId.replace('tmdb:', '');
      console.log(`   Cleaned TMDB ID: ${cleanSeedId}`);
    }
    
    try {
      const mediaType = recType === 'movie' ? 'movie' : 'tv';
      const recommendations = await tmdb.getRecommendations(mediaType, cleanSeedId, language);
      const similar = await tmdb.getSimilar(mediaType, cleanSeedId, language);
      
      const merged = [...recommendations, ...similar];
      const unique = new Map();
      
      for (const item of merged) {
        if (item && item.id && !unique.has(item.id)) {
          unique.set(item.id, item);
        }
      }
      
      items = Array.from(unique.values());
      items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
      items = items.slice(0, 20);
      
      console.log(`   Found ${items.length} similar items for ${seedId}`);
    } catch (err) {
      console.error(`   Error fetching similar for ${seedId}:`, err.message);
      items = [];
    }
  }

  // ============================================================
  // POPULAR (per "You might also like")
  // ============================================================
  if (recType === 'rec-movies') {
    console.log(`   ✨ Fetching popular movies`);
    items = await tmdb.getPopular('movie', language, 2);
    items = items.slice(0, 20);
  }

  if (recType === 'rec-series') {
    console.log(`   ✨ Fetching popular series`);
    items = await tmdb.getPopular('tv', language, 2);
    items = items.slice(0, 20);
  }

  // ============================================================
  // FALLBACK (se vuoto)
  // ============================================================
  if (!items.length) {
    console.log(`   ⚠️ No results, using popular fallback`);
    const fallbackType = catalogType === 'movie' ? 'movie' : 'tv';
    items = await tmdb.getPopular(fallbackType, language, 1);
    items = items.slice(0, 20);
  }

  // ============================================================
  // STREMIO METAS
  // ============================================================
  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: catalogType === 'movie' ? 'movie' : 'series',
    name: item.title || item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    description: item.overview || '',
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
    extra: {}
  }));

  console.log(`✅ Generated ${metas.length} items for ${catalogId}`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidated: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache };
