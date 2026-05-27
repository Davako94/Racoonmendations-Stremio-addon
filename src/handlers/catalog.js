const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserLibrary } = require('../services/userStore');

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

async function buildCandidates(mediaType, rawSeedId, language) {
  console.log(`🎯 buildCandidates → ${rawSeedId}`);

  const metadata = await tmdb.getFullDetails(mediaType, rawSeedId, language);
  if (!metadata) {
    console.error(`   ❌ getFullDetails fallito per ID: ${rawSeedId}`);
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

  return final;
}

async function buildPersonalizedRecs(mediaType, userUuid, language) {
  console.log(`🧠 buildPersonalizedRecs → user: ${userUuid}, type: ${mediaType}`);

  const libraryItems = await getUserLibrary(userUuid, mediaType);

  if (!libraryItems.length) {
    console.log('   Libreria vuota → fallback popular');
    return await tmdb.getPopular(mediaType, language, 2);
  }

  console.log(`   Titoli in libreria: ${libraryItems.length}`);

  const detailsList = await Promise.allSettled(
    libraryItems.map(item => tmdb.getFullDetails(mediaType, item.id, language))
  );

  const validSeeds = detailsList
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  console.log(`   Seed risolti: ${validSeeds.length}/${libraryItems.length}`);

  if (!validSeeds.length) {
    console.log('   Nessun seed valido → fallback popular');
    return await tmdb.getPopular(mediaType, language, 2);
  }

  const keywordFreq = {};
  const genreFreq   = {};
  const networkFreq = {};
  const libraryIds  = new Set();

  for (const seed of validSeeds) {
    libraryIds.add(seed.id);
    for (const kwId of seed.keywordIds)    keywordFreq[kwId] = (keywordFreq[kwId] || 0) + 1;
    for (const g of seed.genres)           genreFreq[g.id]   = (genreFreq[g.id]   || 0) + 1;
    for (const nId of seed.networkIds)     networkFreq[nId]  = (networkFreq[nId]  || 0) + 1;
  }

  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => Number(id));
  const topGenres = Object.entries(genreFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => Number(id));
  const topNetworks = Object.entries(networkFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => Number(id));

  console.log(`   Profilo utente:`);
  console.log(`     Keywords: ${topKeywords.join(', ')}`);
  console.log(`     Genres:   ${topGenres.join(', ')}`);
  if (topNetworks.length) console.log(`     Networks: ${topNetworks.join(', ')}`);

  const candidateMap = new Map();

  const addToMap = (items, bonus) => {
    for (const item of items) {
      // 🔧 FIX CRUCIALE: filtra per tipo (movie vs series)
      if (item.media_type !== mediaType) continue;
      if (libraryIds.has(item.id)) continue;
      if (!candidateMap.has(item.id)) {
        candidateMap.set(item.id, { ...item, _scoreBonus: bonus, _source: 'personalized' });
      } else {
        candidateMap.get(item.id)._scoreBonus += Math.round(bonus * 0.4);
      }
    }
  };

  const discoverResults = await Promise.allSettled([
    topKeywords.length
      ? tmdb.discover(mediaType, { with_keywords: topKeywords.join(',') }, language, 2)
      : Promise.resolve([]),
    topGenres.length
      ? tmdb.discover(mediaType, { with_genres: topGenres.join(','), sort_by: 'vote_average.desc' }, language, 2)
      : Promise.resolve([]),
    topNetworks.length && mediaType === 'tv'
      ? tmdb.discover(mediaType, { with_networks: topNetworks.join('|') }, language, 1)
      : Promise.resolve([])
  ]);

  const [byKeyword, byGenre, byNetwork] = discoverResults;
  if (byKeyword.status === 'fulfilled') addToMap(byKeyword.value, 60);
  if (byGenre.status === 'fulfilled')   addToMap(byGenre.value,   30);
  if (byNetwork.status === 'fulfilled') addToMap(byNetwork.value, 40);

  const userSeed = {
    seedKeywordIds: topKeywords,
    seedGenreIds:   topGenres,
    seedCompanyIds: [],
    seedNetworkIds: topNetworks,
    seedCreatorIds: []
  };

  const candidates = [...candidateMap.values()];
  console.log(`   Candidati discover: ${candidates.length}`);

  const pool = candidates.slice(0, 60);
  const detailsForPool = await tmdb.getDetailsBatch(
    mediaType, pool.map(c => c.id), language, 8
  );

  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    if (!detailsForPool[i]) continue;
    const result = scoreCandidate({ ...pool[i], details: detailsForPool[i] }, userSeed);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, 20);

  console.log(`   ✅ Personalized recs: ${final.length} titoli`);
  return final;
}

async function getCatalog(catalogType, catalogId) {
  console.log(`\n📺 getCatalog: type="${catalogType}" id="${catalogId}"`);

  const parts = catalogId.split('-');
  const prefix = parts[0];
  let mediaType = catalogType;
  let seedId = null;
  let userUuid = null;

  if (prefix === 'sim') {
    seedId = parts[1];
    userUuid = parts.slice(2).join('-');
    mediaType = catalogType;
  } else if (prefix === 'rec') {
    userUuid = parts.slice(1).join('-');
    mediaType = catalogType;
  } else if (prefix === 'setup') {
    userUuid = parts.slice(1).join('-');
    return [{
      id: 'setup_placeholder',
      type: catalogType,
      name: '⚠️ Configure Racconmendations',
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
    console.log(`   ✅ Cache hit: ${cached.length} items`);
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
    console.log('   ⚠️ Nessun risultato → fallback popular');
    items = await tmdb.getPopular(mediaType || catalogType, language, 1);
  }

  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: mediaType || catalogType,
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
  console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache };
