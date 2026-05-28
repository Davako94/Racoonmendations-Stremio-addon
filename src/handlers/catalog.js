const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`📺 getCatalog: ${catalogType}/${catalogId} (uuid: ${userUuid})`);

  // Per i cataloghi di setup, non serve UUID
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
  let isRecommendations = false;

  // ============================================================
  // PARSING - formato: similar--{seedId}--{uuid}
  // ============================================================
  if (catalogId.includes('similar--')) {
    const parts = catalogId.split('--');
    if (parts.length >= 2) {
      seedId = parts[1];
      // Pulisci l'ID (rimuovi eventuale prefisso tmdb:)
      if (seedId.startsWith('tmdb:')) {
        seedId = seedId.replace('tmdb:', '');
      }
      console.log(`   🎯 Parsed seed ID: ${seedId}`);
    }
  }
  
  // ============================================================
  // RACCOMANDAZIONI
  // ============================================================
  if (catalogId.includes('rec-')) {
    isRecommendations = true;
    console.log(`   ✨ Recommendations catalog`);
  }

  const language = await getUserLanguage(userUuid);
  let items = [];

  // ============================================================
  // SIMILAR (per seed specifico)
  // ============================================================
  if (seedId) {
    console.log(`   🔍 Fetching similar to: ${seedId}`);
    
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    
    try {
      const [recommendations, similar] = await Promise.all([
        tmdb.getRecommendations(mediaType, seedId, language),
        tmdb.getSimilar(mediaType, seedId, language)
      ]);
      
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
      console.error(`   Error fetching similar:`, err.message);
      items = [];
    }
  }

  // ============================================================
  // RACCOMANDAZIONI POPOLARI
  // ============================================================
  if (isRecommendations) {
    console.log(`   ✨ Fetching popular ${catalogType}s`);
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    items = await tmdb.getPopular(mediaType, language, 2);
    items = items.slice(0, 20);
  }

  // ============================================================
  // FALLBACK
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
