const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserLibrary } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

function overlap(a = [], b = []) {
  const setB = new Set(b);
  return a.filter(x => setB.has(x)).length;
}

function scoreCandidate(candidate, seed) {
  const { seedKeywordIds, seedGenreIds, seedCompanyIds, seedNetworkIds, seedCreatorIds } = seed;
  const d = candidate.details;
  
  const keywordOverlap = overlap(seedKeywordIds, d.keywordIds);
  const genreOverlap   = overlap(seedGenreIds, d.genres.map(g => g.id));
  const companyOverlap = overlap(seedCompanyIds, d.companyIds);
  const networkOverlap = overlap(seedNetworkIds, d.networkIds);
  const creatorOverlap = overlap(seedCreatorIds, d.creatorIds);
  
  const isFromPrimary = candidate._source === 'recommendation' || candidate._source === 'similar';
  
  // HARD FILTER: senza keyword o genre, solo recommendation/similar passano
  if (!isFromPrimary && keywordOverlap === 0 && genreOverlap === 0) return null;
  
  let score = candidate._scoreBonus || 0;
  
  // Pesi principali
  score += keywordOverlap * 50;      // Keyword sono il segnale più forte
  score += creatorOverlap * 45;      // Stesso creatore/showrunner
  score += companyOverlap * 40;      // Stessa casa di produzione (es. Pixar)
  score += networkOverlap * 35;      // Stessa rete (es. HBO, Netflix)
  score += genreOverlap   * 15;      // Generi (peso minore)
  
  // Penalità
  if (genreOverlap === 0 && keywordOverlap === 0 && !isFromPrimary) score -= 100;
  else if (genreOverlap === 0 && isFromPrimary) score -= 25;
  
  // Bonus qualità voto + popularity
  if (d.vote_average >= 8.5)      score += 25;
  else if (d.vote_average >= 8.0) score += 20;
  else if (d.vote_average >= 7.5) score += 15;
  else if (d.vote_average >= 7.0) score += 10;
  else if (d.vote_average >= 6.5) score += 5;
  else if (d.vote_average < 5.0)  score -= 30;
  else if (d.vote_average < 6.0)  score -= 15;
  
  // Bonus popularity (piccolo, per evitare roba oscura)
  if (d.popularity >= 100) score += 15;
  else if (d.popularity >= 50) score += 10;
  else if (d.popularity >= 20) score += 5;
  
  return { ...candidate, score, keywordOverlap, genreOverlap };
}

// Fallback intelligente per genere
async function smartFallback(mediaType, seedGenreIds, language) {
  if (seedGenreIds && seedGenreIds.length > 0) {
    try {
      const byGenre = await tmdb.discover(mediaType, {
        with_genres: seedGenreIds.slice(0, 3).join(','),
        sort_by: 'popularity.desc',
        'vote_average.gte': 6.5
      }, language, 1);
      if (byGenre.length >= 12) return byGenre.slice(0, 18);
    } catch(e) {}
  }
  return await tmdb.getPopular(mediaType, language, 1);
}

async function buildCandidates(mediaType, rawSeedId, language) {
  console.log(`\n🎯 buildCandidates: ${mediaType}/${rawSeedId}`);

  const metadata = await tmdb.getFullDetails(mediaType, rawSeedId, language);
  if (!metadata) {
    console.error(`   ❌ Failed for: ${rawSeedId}`);
    return [];
  }

  console.log(`   ✅ Seed: "${metadata.title}"`);
  console.log(`      Keywords: ${metadata.keywordIds.slice(0,5).join(',') || 'none'}`);
  console.log(`      Genres: ${metadata.genres.map(g=>g.name).join(', ') || 'none'}`);
  console.log(`      Companies: ${metadata.companyIds.slice(0,3).join(',') || 'none'}`);

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
  add(metadata.similar, 'similar', 70);

  // Discover in parallelo per performance
  const [kw, genre, company, network, creator] = await Promise.allSettled([
    seed.seedKeywordIds.length
      ? tmdb.discover(mediaType, { with_keywords: seed.seedKeywordIds.slice(0,5).join(',') }, language, 2)
      : Promise.resolve([]),
    seed.seedGenreIds.length
      ? tmdb.discover(mediaType, { with_genres: seed.seedGenreIds.join(','), sort_by: 'vote_average.desc' }, language, 2)
      : Promise.resolve([]),
    seed.seedCompanyIds.length
      ? tmdb.discover(mediaType, { with_companies: seed.seedCompanyIds.join('|') }, language, 1)
      : Promise.resolve([]),
    (mediaType === 'tv' && seed.seedNetworkIds.length)
      ? tmdb.discover(mediaType, { with_networks: seed.seedNetworkIds.join('|') }, language, 1)
      : Promise.resolve([]),
    (mediaType === 'tv' && seed.seedCreatorIds.length)
      ? tmdb.discover(mediaType, { with_people: seed.seedCreatorIds.join('|') }, language, 1)
      : Promise.resolve([])
  ]);

  if (kw.status === 'fulfilled') add(kw.value, 'keyword', 45);
  if (genre.status === 'fulfilled') add(genre.value, 'genre', 25);
  if (company.status === 'fulfilled') add(company.value, 'company', 55);
  if (network.status === 'fulfilled') add(network.value, 'network', 40);
  if (creator.status === 'fulfilled') add(creator.value, 'creator', 50);

  console.log(`   Candidati: ${candidates.length}`);

  if (!candidates.length) {
    return await smartFallback(mediaType, seed.seedGenreIds, language);
  }

  const pool = candidates.slice(0, 80);
  const detailsList = await tmdb.getDetailsBatch(mediaType, pool.map(c => c.id), language, 8);

  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    if (!detailsList[i]) continue;
    const result = scoreCandidate({ ...pool[i], details: detailsList[i] }, seed);
    if (result) scored.push(result);
  }

  if (!scored.length) {
    return await smartFallback(mediaType, seed.seedGenreIds, language);
  }

  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, 18);
  
  console.log(`   Finali: ${final.length}`);
  final.forEach(c => console.log(`     "${c.title}" (score:${Math.round(c.score)}, src:${c._source})`));
  
  return final;
}

async function buildPersonalizedRecs(mediaType, userUuid, language) {
  console.log(`\n🧠 Personalized Recs: ${mediaType}/${userUuid}`);
  
  const stremioType = mediaType === 'tv' ? 'series' : 'movie';
  const libraryItems = await getUserLibrary(userUuid, stremioType);

  if (!libraryItems.length) {
    console.log('   Libreria vuota → popular');
    return await tmdb.getPopular(mediaType, language, 2);
  }

  console.log(`   Titoli in libreria: ${libraryItems.length}`);
  
  const detailsList = await Promise.allSettled(
    libraryItems.map(item => tmdb.getFullDetails(mediaType, item.id, language))
  );
  
  const validSeeds = detailsList.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  console.log(`   Seed validi: ${validSeeds.length}/${libraryItems.length}`);
  
  if (!validSeeds.length) return await tmdb.getPopular(mediaType, language, 2);

  // Aggrega frequenze
  const keywordFreq = {}, genreFreq = {}, networkFreq = {}, companyFreq = {};
  const libraryIds = new Set();
  
  for (const seed of validSeeds) {
    libraryIds.add(seed.id);
    for (const kwId of seed.keywordIds) keywordFreq[kwId] = (keywordFreq[kwId]||0)+1;
    for (const g of seed.genres) genreFreq[g.id] = (genreFreq[g.id]||0)+1;
    for (const nId of seed.networkIds) networkFreq[nId] = (networkFreq[nId]||0)+1;
    for (const cId of seed.companyIds) companyFreq[cId] = (companyFreq[cId]||0)+1;
  }
  
  const topKeywords = Object.entries(keywordFreq).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([id])=>Number(id));
  const topGenres   = Object.entries(genreFreq).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([id])=>Number(id));
  const topNetworks = Object.entries(networkFreq).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>Number(id));
  const topCompanies = Object.entries(companyFreq).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>Number(id));
  
  console.log(`   Profilo: kw:${topKeywords.length} genres:${topGenres.length} nets:${topNetworks.length} companies:${topCompanies.length}`);

  const candidateMap = new Map();
  
  const addToMap = (items, bonus) => {
    for (const item of items) {
      if (libraryIds.has(item.id)) continue;
      if (!candidateMap.has(item.id)) {
        candidateMap.set(item.id, { ...item, _scoreBonus: bonus, _source: 'personalized' });
      } else {
        candidateMap.get(item.id)._scoreBonus += Math.round(bonus * 0.3);
      }
    }
  };

  const results = await Promise.allSettled([
    topKeywords.length ? tmdb.discover(mediaType, { with_keywords: topKeywords.join(',') }, language, 2) : Promise.resolve([]),
    topGenres.length   ? tmdb.discover(mediaType, { with_genres: topGenres.join(','), sort_by: 'vote_average.desc' }, language, 2) : Promise.resolve([]),
    topNetworks.length && mediaType === 'tv' ? tmdb.discover(mediaType, { with_networks: topNetworks.join('|') }, language, 1) : Promise.resolve([]),
    topCompanies.length ? tmdb.discover(mediaType, { with_companies: topCompanies.join('|') }, language, 1) : Promise.resolve([])
  ]);

  if (results[0]?.status === 'fulfilled') addToMap(results[0].value, 60);
  if (results[1]?.status === 'fulfilled') addToMap(results[1].value, 35);
  if (results[2]?.status === 'fulfilled') addToMap(results[2].value, 45);
  if (results[3]?.status === 'fulfilled') addToMap(results[3].value, 50);

  const userSeed = {
    seedKeywordIds: topKeywords,
    seedGenreIds: topGenres,
    seedCompanyIds: topCompanies,
    seedNetworkIds: topNetworks,
    seedCreatorIds: []
  };
  
  const candidates = [...candidateMap.values()];
  console.log(`   Candidati: ${candidates.length}`);
  
  if (!candidates.length) {
    return await smartFallback(mediaType, topGenres, language);
  }

  const pool = candidates.slice(0, 60);
  const details = await tmdb.getDetailsBatch(mediaType, pool.map(c=>c.id), language, 8);
  
  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    if (!details[i]) continue;
    const result = scoreCandidate({ ...pool[i], details: details[i] }, userSeed);
    if (result) scored.push(result);
  }
  
  scored.sort((a,b)=>b.score-a.score);
  const final = scored.slice(0, 24);
  
  console.log(`   ✅ Finali: ${final.length}`);
  return final.length ? final : await smartFallback(mediaType, topGenres, language);
}

async function getCatalog(catalogType, catalogId) {
  console.log(`\n📺 getCatalog: "${catalogType}" / "${catalogId}"`);
  
  const parts = catalogId.split('-');
  const prefix = parts[0];
  let mediaType = parts[1];
  let seedId = null, userUuid = null;

  if (prefix === 'sim') {
    seedId = parts[2];
    userUuid = parts.slice(3).join('-');
    mediaType = mediaType === 'movie' ? 'movie' : 'tv';
  } else if (prefix === 'rec') {
    userUuid = parts.slice(2).join('-');
    mediaType = mediaType === 'movie' ? 'movie' : 'tv';
  } else if (prefix === 'setup') {
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

  if (!userUuid) return [];

  const cacheKey = `${catalogId}:${userUuid}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache: ${cached.length} items`);
    return cached;
  }

  const language = await getUserLanguage(userUuid);
  let items = [];

  if (prefix === 'sim' && seedId) {
    items = await buildCandidates(mediaType, seedId, language);
  } else if (prefix === 'rec') {
    items = await buildPersonalizedRecs(mediaType, userUuid, language);
  }

  if (!items.length) {
    items = await tmdb.getPopular(mediaType, language, 1);
  }

  const displayType = catalogType === 'movie' ? 'movie' : 'series';
  
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

module.exports = { getCatalog, invalidateCache };
