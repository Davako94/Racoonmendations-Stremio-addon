const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserSeeds } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

// Verifica se un titolo è un anime (basato su genere e origine)
function isAnime(item) {
  if (!item) return false;
  // Genere 16 = Animation
  const hasAnimationGenre = item.genre_ids?.includes(16) || item.genres?.some(g => g.id === 16);
  // Verifica origine Giappone (se disponibile)
  const isJapanese = item.origin_country?.includes('JP') || item.original_language === 'ja';
  return hasAnimationGenre && isJapanese;
}

// Filtra solo anime (per cataloghi anime)
function filterAnime(items) {
  return items.filter(item => isAnime(item));
}

// Filtra escludendo anime (per cataloghi normali)
function filterNonAnime(items) {
  return items.filter(item => !isAnime(item));
}

async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`\n📺 getCatalog: ${catalogType}/${catalogId} (uuid: ${userUuid})`);
  
  // Verifica se è un catalogo anime (dal tipo o dal nome)
  const isAnimeCatalog = catalogType === 'anime' || catalogId.includes('anime');
  
  // Estrai seedId dal catalogId
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
  } else if (catalogId.includes('sim-anime-')) {
    const parts = catalogId.split('-');
    seedId = parts[2];
    recType = 'anime';
  } else if (catalogId.includes('rec-movie-')) {
    recType = 'rec-movie';
  } else if (catalogId.includes('rec-series-')) {
    recType = 'rec-series';
  } else if (catalogId.includes('rec-anime-')) {
    recType = 'rec-anime';
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
    console.log('   ❌ No user UUID');
    return [];
  }
  
  const cacheKey = `${catalogId}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache: ${cached.length} items`);
    return cached;
  }
  
  const language = await getUserLanguage(userUuid);
  let items = [];
  
  if (seedId && recType) {
    // Similar to X
    console.log(`   🔍 Similar to: ${seedId} (${recType})`);
    
    let recs = [];
    let similar = [];
    
    if (recType === 'anime') {
      // Per anime: usa ricerca con genre=16 e origin_country=JP
      recs = await tmdb.discover('tv', {
        with_genres: 16,
        with_origin_country: 'JP',
        sort_by: 'popularity.desc'
      }, language, 2);
      similar = recs; // Per anime, usa discover come fonte principale
    } else {
      recs = await tmdb.getRecommendations(recType, seedId, language);
      similar = await tmdb.getSimilar(recType, seedId, language);
    }
    
    const allItems = [...recs, ...similar];
    const unique = new Map();
    for (const item of allItems) {
      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }
    
    items = Array.from(unique.values());
    
    // Filtra in base al tipo di catalogo
    if (isAnimeCatalog || recType === 'anime') {
      items = filterAnime(items);
      console.log(`   🍥 Filtrati ${items.length} anime`);
    } else {
      items = filterNonAnime(items);
    }
    
    items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    items = items.slice(0, 20);
    
    console.log(`   Trovati ${items.length} simili`);
    
  } else if (recType === 'rec-movie') {
    // You might also like - Movies
    console.log(`   ✨ Recommendations for movies`);
    items = await tmdb.getPopular('movie', language, 2);
    items = filterNonAnime(items);
    items = items.slice(0, 20);
    
  } else if (recType === 'rec-series') {
    // You might also like - Series
    console.log(`   ✨ Recommendations for series`);
    items = await tmdb.getPopular('tv', language, 2);
    items = filterNonAnime(items);
    items = items.slice(0, 20);
    
  } else if (recType === 'rec-anime') {
    // You might also like - Anime
    console.log(`   ✨ Recommendations for anime`);
    items = await tmdb.discover('tv', {
      with_genres: 16,
      with_origin_country: 'JP',
      sort_by: 'popularity.desc'
    }, language, 2);
    items = items.slice(0, 20);
  }
  
  if (!items.length) {
    console.log('   ⚠️ No results, using fallback');
    if (isAnimeCatalog) {
      items = await tmdb.discover('tv', {
        with_genres: 16,
        with_origin_country: 'JP',
        sort_by: 'popularity.desc'
      }, language, 1);
    } else {
      const popular = await tmdb.getPopular(catalogType === 'movie' ? 'movie' : 'tv', language, 1);
      items = popular;
    }
    items = items.slice(0, 15);
  }
  
  const displayType = isAnimeCatalog ? 'series' : (catalogType === 'movie' ? 'movie' : 'series');
  
  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: displayType,
    name: item.title,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    description: item.overview || '',
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
    extra: {}
  }));
  
  console.log(`✅ Generati ${metas.length} items`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache, cache };
