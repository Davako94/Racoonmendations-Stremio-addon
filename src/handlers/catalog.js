const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserLibrary } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

// ─── Utility ──────────────────────────────────────────────────────────────────
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
  const hasKeywordMatch = keywordOverlap >= 1;

  // Hard filter: deve avere almeno una relazione semantica
  if (!isFromPrimary && !hasKeywordMatch && genreOverlap === 0) return null;

  let score = candidate._scoreBonus || 0;

  // Scoring pesato — keyword e creator sono i segnali più forti
  score += keywordOverlap * 45;
  score += creatorOverlap * 50;
  score += companyOverlap * 40;
  score += networkOverlap * 30;
  score += genreOverlap   * 15;

  // Penalità solo se nessuna relazione semantica ma non da fonte primaria
  if (genreOverlap === 0 && keywordOverlap === 0 && !isFromPrimary) score -= 80;
  else if (genreOverlap === 0 && isFromPrimary) score -= 20;

  // Bonus qualità voto
  if (d.vote_average >= 8.0)      score += 20;
  else if (d.vote_average >= 7.5) score += 12;
  else if (d.vote_average >= 7.0) score += 6;
  else if (d.vote_average < 5.5)  score -= 20;

  return { ...candidate, score, keywordOverlap, genreOverlap };
}

// ─── buildCandidates: simili a UN singolo seedId ─────────────────────────────
async function buildCandidates(mediaType, rawSeedId, language) {
  console.log(`\n🎯 buildCandidates → type=${mediaType} id=${rawSeedId}`);

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

  // Fonti ordinate per rilevanza semantica
  add(metadata.recommendations, 'recommendation', 80);
  add(metadata.similar,         'similar',        70);

  const discovers = await Promise.allSettled([
    // Discover per keyword (top 5 keyword del seed)
    seed.seedKeywordIds.length
      ? tmdb.discover(mediaType, { with_keywords: seed.seedKeywordIds.slice(0, 5).join(',') }, language, 2)
      : Promise.resolve([]),
    // Discover per genre
    seed.seedGenreIds.length
      ? tmdb.discover(mediaType, { with_genres: seed.seedGenreIds.join(','), sort_by: 'vote_average.desc' }, language, 1)
      : Promise.resolve([]),
    // Discover per studio
    seed.seedCompanyIds.length
      ? tmdb.discover(mediaType, { with_companies: seed.seedCompanyIds.join('|') }, language, 1)
      : Promise.resolve([]),
    // TV: network
    (mediaType === 'tv' && seed.seedNetworkIds.length)
      ? tmdb.discover(mediaType, { with_networks: seed.seedNetworkIds.join('|') }, language, 1)
      : Promise.resolve([]),
    // TV: creator
    (mediaType === 'tv' && seed.seedCreatorIds.length)
      ? tmdb.discover(mediaType, { with_people: seed.seedCreatorIds.join('|') }, language, 1)
      : Promise.resolve([])
  ]);

  const [kw, genre, company, network, creator] = discovers;
  if (kw.status      === 'fulfilled') add(kw.value,      'keyword', 40);
  if (genre.status   === 'fulfilled') add(genre.value,   'genre',   25);
  if (company.status === 'fulfilled') add(company.value, 'company', 50);
  if (network.status === 'fulfilled') add(network.value, 'network', 35);
  if (creator.status === 'fulfilled') add(creator.value, 'creator', 45);

  console.log(`   Candidati grezzi: ${candidates.length}`);

  // Fetch details in PARALLELO (bugfix: era sequenziale)
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
    console.log(`     "${c.title}" score:${Math.round(c.score)} kw:${c.keywordOverlap} genre:${c.genreOverlap} src:${c._source}`)
  );

  return final;
}

// ─── buildPersonalizedRecs: cuore del sistema Netflix-like ───────────────────
async function buildPersonalizedRecs(mediaType, userUuid, language) {
  console.log(`\n🧠 buildPersonalizedRecs → type=${mediaType} user=${userUuid}`);

  const libraryItems = await getUserLibrary(userUuid, mediaType);

  if (!libraryItems.length) {
    console.log('   Libreria vuota → fallback popular');
    return await tmdb.getPopular(mediaType, language, 2);
  }

  console.log(`   Titoli in libreria: ${libraryItems.length}`);

  // Full details per tutti i seed in parallelo
  const detailsList = await Promise.allSettled(
    libraryItems.map(item => tmdb.getFullDetails(mediaType, item.id, language))
  );

  const validSeeds = detailsList
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  console.log(`   Seed risolti: ${validSeeds.length}/${libraryItems.length}`);

  if (!validSeeds.length) {
    return await tmdb.getPopular(mediaType, language, 2);
  }

  // ── Profilo utente aggregato ──────────────────────────────────────────────
  const keywordFreq = {};
  const genreFreq   = {};
  const networkFreq = {};
  const libraryIds  = new Set();

  for (const seed of validSeeds) {
    libraryIds.add(seed.id);
    for (const kwId of seed.keywordIds) keywordFreq[kwId] = (keywordFreq[kwId] || 0) + 1;
    for (const g of seed.genres)        genreFreq[g.id]   = (genreFreq[g.id]   || 0) + 1;
    for (const nId of seed.networkIds)  networkFreq[nId]  = (networkFreq[nId]  || 0) + 1;
  }

  const topKeywords = Object.entries(keywordFreq).sort((a,b) => b[1]-a[1]).slice(0,6).map(([id]) => Number(id));
  const topGenres   = Object.entries(genreFreq).sort((a,b)   => b[1]-a[1]).slice(0,3).map(([id]) => Number(id));
  const topNetworks = Object.entries(networkFreq).sort((a,b) => b[1]-a[1]).slice(0,2).map(([id]) => Number(id));

  console.log(`   Profilo → kw:${topKeywords.join(',')} genres:${topGenres.join(',')} networks:${topNetworks.join(',')}`);

  // ── Discover basato sul profilo in parallelo ──────────────────────────────
  const candidateMap = new Map();
  const addToMap = (items, bonus) => {
    for (const item of items) {
      if (libraryIds.has(item.id)) continue;
      if (!candidateMap.has(item.id)) {
        candidateMap.set(item.id, { ...item, _scoreBonus: bonus, _source: 'personalized' });
      } else {
        candidateMap.get(item.id)._scoreBonus += Math.round(bonus * 0.4);
      }
    }
  };

  const [byKeyword, byGenre, byNetwork] = await Promise.allSettled([
    topKeywords.length
      ? tmdb.discover(mediaType, { with_keywords: topKeywords.join(',') }, language, 2)
      : Promise.resolve([]),
    topGenres.length
      ? tmdb.discover(mediaType, { with_genres: topGenres.join(','), sort_by: 'vote_average.desc' }, language, 2)
      : Promise.resolve([]),
    (topNetworks.length && mediaType === 'tv')
      ? tmdb.discover(mediaType, { with_networks: topNetworks.join('|') }, language, 1)
      : Promise.resolve([])
  ]);

  if (byKeyword.status === 'fulfilled') addToMap(byKeyword.value, 60);
  if (byGenre.status   === 'fulfilled') addToMap(byGenre.value,   30);
  if (byNetwork.status === 'fulfilled') addToMap(byNetwork.value, 40);

  // ── Scoring finale ────────────────────────────────────────────────────────
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
  const details = await tmdb.getDetailsBatch(mediaType, pool.map(c => c.id), language, 8);

  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    if (!details[i]) continue;
    const result = scoreCandidate({ ...pool[i], details: details[i] }, userSeed);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, 20);
  console.log(`   ✅ Personalized recs: ${final.length} titoli`);
  return final;
}

// ─── getCatalog: entry point principale ──────────────────────────────────────
async function getCatalog(catalogType, catalogId) {
  console.log(`\n📺 getCatalog type="${catalogType}" id="${catalogId}"`);

  const parts = catalogId.split('-');
  const prefix    = parts[0]; // "sim" | "rec" | "setup"
  const mediaType = parts[1]; // "movie" | "series"
  let seedId   = null;
  let userUuid = null;

  if (prefix === 'sim') {
    // sim-movie-SEEDID-UUID  oppure  sim-series-SEEDID-UUID
    seedId   = parts[2];
    userUuid = parts.slice(3).join('-');
  } else if (prefix === 'rec') {
    // rec-movie-UUID  oppure  rec-series-UUID
    // BUGFIX: era "rec-movies-UUID" → parts[1]="movies" ≠ "movie"
    // Ora con manifest corretto parts[1] è sempre "movie" o "series" ✓
    userUuid = parts.slice(2).join('-');
  } else if (prefix === 'setup') {
    return [{
      id: 'setup_placeholder',
      type: catalogType,
      name: '⚠️ Configure Racoonmendations',
      poster: null,
      description: 'Go to /configure to select your favorite movies and series',
      releaseInfo: '',
      extra: {}
    }];
  }

  if (!userUuid) return [];

  // Normalizza mediaType: Stremio usa "series" ma TMDB usa "tv"
  const tmdbType = mediaType === 'series' ? 'tv' : 'movie';

  const cacheKey = `${catalogId}:${userUuid}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache hit: ${cached.length} items`);
    return cached;
  }

  const language = await getUserLanguage(userUuid);
  let items = [];

  if (prefix === 'sim' && seedId) {
    items = await buildCandidates(tmdbType, seedId, language);
  } else if (prefix === 'rec') {
    items = await buildPersonalizedRecs(tmdbType, userUuid, language);
  }

  // Fallback
  if (!items.length) {
    console.log('   ⚠️ Fallback → popular');
    items = await tmdb.getPopular(tmdbType, language, 1);
  }

  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: mediaType, // Stremio vuole "movie" o "series"
    name: item.title,
    poster: item.poster_path
      ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
      : null,
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
