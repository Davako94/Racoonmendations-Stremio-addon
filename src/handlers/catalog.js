const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserConfig, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

// Parole chiave per espandere la ricerca in base al genere/titolo
function extractKeywords(title) {
  const keywords = [];
  const lower = title.toLowerCase();
  
  if (lower.includes('marvel') || lower.includes('avenger') || lower.includes('iron man') || lower.includes('captain america')) {
    keywords.push('superhero', 'marvel', 'action');
  }
  if (lower.includes('cars') || lower.includes('auto') || lower.includes('race')) {
    keywords.push('cars', 'racing', 'animation', 'family');
  }
  if (lower.includes('disney') || lower.includes('pixar')) {
    keywords.push('animation', 'family', 'disney');
  }
  if (lower.includes('star wars')) {
    keywords.push('space', 'scifi', 'adventure');
  }
  if (lower.includes('jurassic')) {
    keywords.push('dinosaurs', 'adventure', 'action');
  }
  if (lower.includes('harry potter')) {
    keywords.push('fantasy', 'magic', 'wizard');
  }
  if (lower.includes('fast') || lower.includes('furious')) {
    keywords.push('cars', 'action', 'heist');
  }
  
  // Aggiungi sempre qualche keyword generica per varietà
  keywords.push('popular', 'trending');
  
  return keywords;
}

async function getCatalog(catalogType, catalogId) {
  console.log(`📺 getCatalog: type=${catalogType}, catalogId=${catalogId}`);
  
  const parts = catalogId.split('-');
  const prefix = parts[0];
  const mediaType = parts[1];
  let seedId = null;
  let userUuid = null;
  
  if (prefix === 'sim') {
    seedId = parts[2];
    userUuid = parts.slice(3).join('-');
  } else if (prefix === 'rec') {
    userUuid = parts.slice(2).join('-');
  } else if (prefix === 'setup') {
    userUuid = parts.slice(2).join('-');
    return [{
      id: "setup_placeholder",
      type: catalogType,
      name: "⚠️ Configure your addon",
      poster: null,
      description: "Go to /configure to select your favorite movies and series",
      releaseInfo: "",
      extra: {}
    }];
  }
  
  if (!userUuid) {
    console.error('❌ No UUID found');
    return [];
  }
  
  const cacheKey = `${catalogId}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`📦 Cache hit: ${cached.length} items`);
    return cached;
  }
  
  const language = await getUserLanguage(userUuid);
  let metas = [];
  
  if (prefix === 'sim' && seedId) {
    console.log(`🎯 Simili a: seedId=${seedId}, type=${mediaType}`);
    
    const config = await getUserConfig(userUuid);
    let seedTitle = '';
    let seedGenres = [];
    
    if (mediaType === 'movie') {
      const found = (config.selected_movies || []).find(m => m.id === seedId);
      seedTitle = found?.title || seedId;
      seedGenres = found?.genres || [];
    } else {
      const found = (config.selected_series || []).find(s => s.id === seedId);
      seedTitle = found?.title || seedId;
      seedGenres = found?.genres || [];
    }
    
    // Se non abbiamo generi, recuperali da TMDB
    if (!seedGenres || seedGenres.length === 0) {
      const details = await tmdb.getDetails(mediaType, seedId, language);
      if (details && details.genres) {
        seedGenres = details.genres;
      }
    }
    
    const genreIds = seedGenres.map(g => g.id).filter(Boolean);
    const keywords = extractKeywords(seedTitle);
    
    let allItems = [];
    
    // STRATEGIA 1: Recommendations (più pagine)
    const recs = await tmdb.getRecommendations(mediaType, seedId, language, 3);
    allItems.push(...recs);
    console.log(`   📌 Recommendations: ${recs.length}`);
    
    // STRATEGIA 2: Similar (più pagine)
    const similar = await tmdb.getSimilar(mediaType, seedId, language, 3);
    allItems.push(...similar);
    console.log(`   📌 Similar: ${similar.length}`);
    
    // STRATEGIA 3: Discover per genere (se abbiamo generi)
    if (genreIds.length > 0) {
      for (const genreId of genreIds.slice(0, 2)) {
        const byGenre = await tmdb.discover(mediaType, { with_genres: genreId }, language, 2);
        allItems.push(...byGenre);
        console.log(`   📌 Genre ${genreId}: ${byGenre.length}`);
      }
    }
    
    // STRATEGIA 4: Discover combinato (genere + anno, per varietà)
    const currentYear = new Date().getFullYear();
    const discoverVariants = [
      { with_genres: genreIds.join('|'), 'vote_average.gte': 6 },
      { with_genres: genreIds.join('|'), 'vote_average.gte': 7, 'vote_count.gte': 500 },
      { with_genres: genreIds.join('|'), 'primary_release_date.gte': `${currentYear - 5}-01-01` },
      { sort_by: 'vote_average.desc', 'vote_count.gte': 1000, with_genres: genreIds.join('|') }
    ];
    
    for (const params of discoverVariants.slice(0, 3)) {
      const discovered = await tmdb.discover(mediaType, params, language, 1);
      allItems.push(...discovered);
      console.log(`   📌 Discover variant: ${discovered.length}`);
    }
    
    // STRATEGIA 5: Cerca per keyword
    for (const keyword of keywords.slice(0, 3)) {
      const byKeyword = await tmdb.searchByKeyword(mediaType, keyword, language, 1);
      allItems.push(...byKeyword);
      console.log(`   📌 Keyword "${keyword}": ${byKeyword.length}`);
    }
    
    // STRATEGIA 6: Popolari come fallback
    const popular = await tmdb.getPopular(mediaType, language, 2);
    allItems.push(...popular);
    console.log(`   📌 Popular: ${popular.length}`);
    
    // Deduplica e mescola
    const unique = new Map();
    for (const item of allItems) {
      if (item.id && item.id !== seedId && !unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }
    
    let items = Array.from(unique.values());
    // Mescola casualmente
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    
    // Prendi i primi 50
    items = items.slice(0, 50);
    
    metas = items.map(item => ({
      id: `sim_${seedId}_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || `Similar to ${seedTitle}`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
    
    console.log(`   ✅ Totale ${metas.length} simili unici per ${seedTitle} (da ${allItems.length} raw)`);
    
  } else if (prefix === 'rec') {
    console.log(`✨ Raccomandazioni per ${mediaType}`);
    
    const config = await getUserConfig(userUuid);
    const seeds = mediaType === 'movie' 
      ? (config.selected_movies || [])
      : (config.selected_series || []);
    
    let allRecs = [];
    
    for (const seed of seeds.slice(0, 10)) {
      const seedId = seed.tmdb_id || seed.id;
      if (seedId) {
        const recs = await tmdb.getRecommendations(mediaType, seedId, language, 2);
        const similar = await tmdb.getSimilar(mediaType, seedId, language, 2);
        allRecs.push(...recs, ...similar);
      }
    }
    
    // Aggiungi popolari
    const popular = await tmdb.getPopular(mediaType, language, 3);
    allRecs.push(...popular);
    
    // Deduplica e mescola
    const unique = new Map();
    for (const rec of allRecs) {
      if (!unique.has(rec.id)) {
        unique.set(rec.id, rec);
      }
    }
    
    let items = Array.from(unique.values());
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    
    items = items.slice(0, 50);
    
    metas = items.map(item => ({
      id: `rec_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || `Potrebbe piacerti`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
    
    console.log(`   ✅ Trovate ${metas.length} raccomandazioni`);
  }
  
  if (metas.length === 0) {
    console.log(`⚠️ Fallback a popolari`);
    try {
      const popular = await tmdb.getPopular(mediaType || catalogType, language, 3);
      metas = popular.slice(0, 50).map(item => ({
        id: `pop_${item.id}`,
        type: mediaType || catalogType,
        name: item.title,
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        description: item.overview || `Popolare`,
        releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
        extra: {}
      }));
    } catch (err) {
      console.error('Error fetching popular:', err.message);
    }
  }
  
  console.log(`✅ Generati ${metas.length} items per ${catalogId}`);
  
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  if (keys.length) {
    cache.del(keys);
    console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} keys`);
  }
}

module.exports = { getCatalog, invalidateCache };
