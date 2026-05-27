const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserConfig } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

function overlap(a = [], b = []) {
  const setB = new Set(b);
  return a.filter(x => setB.has(x)).length;
}

function scoreCandidate(candidate, seed) {
  const {
    seedKeywordIds, seedGenreIds, seedCompanyIds,
    seedNetworkIds, seedCreatorIds
  } = seed;
  const d = candidate.details;

  const keywordOverlap = overlap(seedKeywordIds, d.keywordIds);
  const genreOverlap   = overlap(seedGenreIds, d.genres.map(g => g.id));
  const companyOverlap = overlap(seedCompanyIds, d.companyIds);
  const networkOverlap = overlap(seedNetworkIds, d.networkIds);
  const creatorOverlap = overlap(seedCreatorIds, d.creatorIds);

  const isFromPrimary = candidate._source === 'recommendation' || candidate._source === 'similar';
  const hasKeywordMatch = keywordOverlap >= 1;

  if (!isFromPrimary && !hasKeywordMatch) return null;

  let score = candidate._scoreBonus || 0;
  score += keywordOverlap * 45;
  score += genreOverlap   * 15;
  score += companyOverlap * 40;
  score += networkOverlap * 30;
  score += creatorOverlap * 50;

  if (genreOverlap === 0 && keywordOverlap === 0 && !isFromPrimary) score -= 80;
  else if (genreOverlap === 0 && isFromPrimary) score -= 20;

  if (d.vote_average >= 8.0)      score += 20;
  else if (d.vote_average >= 7.5) score += 12;
  else if (d.vote_average >= 7.0) score += 6;
  else if (d.vote_average < 5.5)  score -= 20;

  return { ...candidate, score, keywordOverlap, genreOverlap };
}

async function buildCandidates(mediaType, seedId, language, seedTitle) {
  console.log(`🎯 buildCandidates → ${seedId} (${seedTitle})`);

  const metadata = await tmdb.getFullDetails(mediaType, seedId, language);
  if (!metadata) {
    console.error(`   ❌ getFullDetails fallito per ID: ${seedId}`);
    return [];
  }

  console.log(`   ✅ Seed: "${metadata.title}" (TMDB: ${metadata.id})`);
  console.log(`   Keywords: ${metadata.keywords.slice(0, 5).map(k => k.name).join(', ')}`);
  console.log(`   Genres:   ${metadata.genres.map(g => g.name).join(', ')}`);

  const seed = {
    seedKeywordIds: metadata.keywordIds,
    seedGenreIds:   metadata.genres.map(g => g.id),
    seedCompanyIds: metadata.companyIds,
    seedNetworkIds: metadata.networkIds,
    seedCreatorIds: metadata.creatorIds
  };

  const candidates = [];
  const seenIds = new Set([metadata.id]);

  const add = (items, source, bonus) => {
    for (const item of items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        candidates.push({ ...item, _source: source, _scoreBonus: bonus });
      }
    }
  };

  add(metadata.recommendations, 'recommendation', 80);
  add(metadata.similar,         'similar',        70);

  if (seed.seedKeywordIds.length) {
    const kw = await tmdb.discover(
      mediaType, { with_keywords: seed.seedKeywordIds.slice(0, 5).join(',') }, language, 2
    );
    add(kw, 'keyword', 40);
  }

  if (seed.seedGenreIds.length) {
    const byGenre = await tmdb.discover(
      mediaType, { with_genres: seed.seedGenreIds.join(','), sort_by: 'vote_average.desc' }, language, 1
    );
    add(byGenre, 'genre', 25);
  }

  if (seed.seedCompanyIds.length) {
    const byCompany = await tmdb.discover(
      mediaType, { with_companies: seed.seedCompanyIds.join('|') }, language, 1
    );
    add(byCompany, 'company', 50);
  }

  if (mediaType === 'tv') {
    if (seed.seedNetworkIds.length) {
      const byNet = await tmdb.discover(
        mediaType, { with_networks: seed.seedNetworkIds.join('|') }, language, 1
      );
      add(byNet, 'network', 35);
    }
    if (seed.seedCreatorIds.length) {
      const byCreator = await tmdb.discover(
        mediaType, { with_people: seed.seedCreatorIds.join('|') }, language, 1
      );
      add(byCreator, 'creator', 45);
    }
  }

  console.log(`   Candidati grezzi: ${candidates.length}`);

  const pool = candidates.slice(0, 80);
  const detailsList = await tmdb.getDetailsBatch(mediaType, pool.map(c => c.id), language, 8);

  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    if (!detailsList[i]) continue;
    const result = scoreCandidate({ ...pool[i], details: detailsList[i] }, seed);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, 18);

  console.log(`   Finali: ${final.length}`);
  final.forEach(c =>
    console.log(`     "${c.title}" score:${Math.round(c.score)} kw:${c.keywordOverlap} src:${c._source}`)
  );

  return final.map(c => ({ ...c, seedTitle }));
}

async function getCatalog(catalogType, catalogId) {
  console.log(`\n📺 getCatalog: type="${catalogType}" id="${catalogId}"`);

  // Se è un catalogo di raccomandazioni (rec-movies o rec-series)
  if (catalogId === 'rec-movies' || catalogId === 'rec-series') {
    const cacheKey = `${catalogId}`;
    let cached = cache.get(cacheKey);
    if (cached) {
      console.log(`   ✅ Cache hit: ${cached.length} items`);
      return cached;
    }

    const language = 'en';
    const mediaType = catalogId === 'rec-movies' ? 'movie' : 'series';
    
    // Ottieni popolari come fallback
    let items = await tmdb.getPopular(mediaType, language, 2);
    
    const metas = items.slice(0, 20).map(item => ({
      id: `rec_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: `✨ Recommended for you`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
    
    console.log(`✅ Generati ${metas.length} items per raccomandazioni`);
    cache.set(cacheKey, metas);
    return metas;
  }

  // Parser per "simili a X" - formato: sim-{seedId}-{userUuid}
  // Oppure: movie-{seedId}-{userUuid}
  let seedId = null;
  let userUuid = null;
  let mediaType = catalogType;
  
  if (catalogId.startsWith('sim-')) {
    const parts = catalogId.split('-');
    seedId = parts[1];
    userUuid = parts.slice(2).join('-');
    mediaType = catalogType;
  } else if (catalogId.startsWith('movie-')) {
    const parts = catalogId.split('-');
    seedId = parts[1];
    userUuid = parts.slice(2).join('-');
    mediaType = 'movie';
  } else if (catalogId.startsWith('series-')) {
    const parts = catalogId.split('-');
    seedId = parts[1];
    userUuid = parts.slice(2).join('-');
    mediaType = 'series';
  }
  
  if (!seedId) {
    console.log('   ⚠️ Formato catalogId non riconosciuto, uso popolari');
    const popular = await tmdb.getPopular(catalogType, 'en', 1);
    return popular.slice(0, 20).map(item => ({
      id: `pop_${item.id}`,
      type: catalogType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: `Popular ${catalogType}`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
  }

  const cacheKey = `${catalogId}`;
  let cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache hit: ${cached.length} items`);
    return cached;
  }

  const language = await getUserLanguage(userUuid || 'default');
  
  // Ottieni il titolo del seed per mostrarlo nell'etichetta
  let seedTitle = seedId;
  if (userUuid) {
    const config = await getUserConfig(userUuid);
    if (config) {
      if (mediaType === 'movie') {
        const found = (config.selected_movies || []).find(m => m.id === seedId);
        if (found) seedTitle = found.title;
      } else {
        const found = (config.selected_series || []).find(s => s.id === seedId);
        if (found) seedTitle = found.title;
      }
    }
  }

  console.log(`🔍 Cercando simili per: ${seedTitle} (${mediaType})`);
  
  const items = await buildCandidates(mediaType, seedId, language, seedTitle);
  
  if (!items.length) {
    console.log('   ⚠️ Nessun risultato, uso popolari');
    const popular = await tmdb.getPopular(mediaType, language, 1);
    const fallbackItems = popular.slice(0, 18).map(item => ({
      ...item,
      seedTitle
    }));
    
    const metas = fallbackItems.map(item => ({
      id: `sim_${seedId}_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: `🎬 Simili a ${seedTitle}`,
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
    
    console.log(`✅ Generati ${metas.length} items (fallback)`);
    cache.set(cacheKey, metas);
    return metas;
  }

  const metas = items.map(item => ({
    id: `sim_${seedId}_${item.id}`,
    type: mediaType,
    name: item.title,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    description: `🎬 Simili a ${item.seedTitle || seedTitle}`,
    releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
    extra: {}
  }));

  console.log(`✅ Generati ${metas.length} items per "${seedTitle}"`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache };
