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

  // HARD FILTER: deve avere relazione semantica
  if (!isFromPrimary && !hasKeywordMatch) return null;

  let score = candidate._scoreBonus || 0;

  score += keywordOverlap * 45;
  score += genreOverlap   * 15;
  score += companyOverlap * 40;
  score += networkOverlap * 30;
  score += creatorOverlap * 50;

  // BUGFIX: penalità genre ridotta e applicata solo se NESSUN'altra relazione
  // Prima era -100 e buttava via molti buoni candidati
  if (genreOverlap === 0 && keywordOverlap === 0 && !isFromPrimary) {
    score -= 80; // penalizza solo se davvero nessuna relazione
  } else if (genreOverlap === 0 && isFromPrimary) {
    score -= 20; // penalità leggera per primary senza genre match
  }

  // Bonus qualità voto
  if (d.vote_average >= 8.0) score += 20;
  else if (d.vote_average >= 7.5) score += 12;
  else if (d.vote_average >= 7.0) score += 6;
  else if (d.vote_average < 5.5) score -= 20;

  return {
    ...candidate,
    score,
    keywordOverlap,
    genreOverlap
  };
}

// ─── buildCandidates: trova i migliori simili a seedId ───────────────────────
async function buildCandidates(mediaType, rawSeedId, language) {
  console.log(`🎯 Building candidates for: ${rawSeedId}`);

  const metadata = await tmdb.getFullDetails(mediaType, rawSeedId, language);
  if (!metadata) {
    console.error(`   ❌ getFullDetails fallito per ID: ${rawSeedId}`);
    return [];
  }

  console.log(`   ✅ Seed: "${metadata.title}" (TMDB: ${metadata.id})`);
  console.log(`   Keywords: ${metadata.keywords.slice(0, 5).map(k => k.name).join(', ')}`);
  console.log(`   Genres:   ${metadata.genres.map(g => g.name).join(', ')}`);
  console.log(`   Companies: ${metadata.companies.slice(0, 3).map(c => c.name).join(', ')}`);

  const seed = {
    seedKeywordIds: metadata.keywordIds,
    seedGenreIds:   metadata.genres.map(g => g.id),
    seedCompanyIds: metadata.companyIds,
    seedNetworkIds: metadata.networkIds,
    seedCreatorIds: metadata.creatorIds
  };

  // ── Raccolta candidati da fonti multiple ──────────────────────────────────
  const candidates = [];
  const seenIds = new Set([metadata.id]); // escludi il seed stesso

  const addCandidates = (items, source, scoreBonus) => {
    for (const item of items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        candidates.push({ ...item, _source: source, _scoreBonus: scoreBonus });
      }
    }
  };

  // Fonte 1: Recommendations TMDB (massima priorità)
  addCandidates(metadata.recommendations, 'recommendation', 80);

  // Fonte 2: Similar TMDB (priorità alta)
  addCandidates(metadata.similar, 'similar', 70);

  // Fonte 3: Discover per keyword (prime 5 keywords più rilevanti)
  if (seed.seedKeywordIds.length) {
    const keywordIds = seed.seedKeywordIds.slice(0, 5).join(',');
    const byKeyword = await tmdb.discover(mediaType, { with_keywords: keywordIds }, language, 2);
    addCandidates(byKeyword, 'keyword', 40);
  }

  // Fonte 4: Discover per genre (supporto quando pochi keyword)
  if (seed.seedGenreIds.length) {
    const genreIds = seed.seedGenreIds.join(',');
    const byGenre = await tmdb.discover(
      mediaType,
      { with_genres: genreIds, sort_by: 'vote_average.desc' },
      language, 1
    );
    addCandidates(byGenre, 'genre', 25);
  }

  // Fonte 5: Discover per studio
  if (seed.seedCompanyIds.length) {
    const byCompany = await tmdb.discover(
      mediaType,
      { with_companies: seed.seedCompanyIds.join('|') },
      language, 1
    );
    addCandidates(byCompany, 'company', 50);
  }

  // Fonte 6 (TV): Network e Creator
  if (mediaType === 'tv') {
    if (seed.seedNetworkIds.length) {
      const byNetwork = await tmdb.discover(
        mediaType,
        { with_networks: seed.seedNetworkIds.join('|') },
        language, 1
      );
      addCandidates(byNetwork, 'network', 35);
    }
    if (seed.seedCreatorIds.length) {
      const byCreator = await tmdb.discover(
        mediaType,
        { with_people: seed.seedCreatorIds.join('|') },
        language, 1
      );
      addCandidates(byCreator, 'creator', 45);
    }
  }

  console.log(`   Candidati grezzi: ${candidates.length}`);

  // ── Fetch details in PARALLELO (BUGFIX: era sequenziale = lento + timeout) ──
  const pool = candidates.slice(0, 80); // top 80 candidati
  const detailsList = await tmdb.getDetailsBatch(mediaType, pool.map(c => c.id), language, 8);

  // ── Scoring ───────────────────────────────────────────────────────────────
  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    const details = detailsList[i];
    if (!details) continue;

    const result = scoreCandidate({ ...pool[i], details }, seed);
    if (result) scored.push(result);
  }

  // Ordina e limita
  scored.sort((a, b) => b.score - a.score);
  const final = scored.slice(0, 18);

  console.log(`   Finali dopo scoring: ${final.length}`);
  final.forEach(c => {
    console.log(
      `     "${c.title}" score:${Math.round(c.score)} kw:${c.keywordOverlap} genre:${c.genreOverlap} src:${c._source}`
    );
  });

  return final;
}

// ─── buildPersonalizedRecs: raccomandazioni basate sulla libreria utente ──────
// Usato dal catalog "rec" — questo è il cuore del sistema Netflix-like
async function buildPersonalizedRecs(mediaType, userUuid, language) {
  console.log(`🧠 Building personalized recs for user: ${userUuid}`);

  // Recupera libreria utente (adatta getUserLibrary alla tua implementazione)
  let libraryItems = [];
  try {
    libraryItems = await getUserLibrary(userUuid, mediaType);
  } catch (e) {
    console.warn('   ⚠️ getUserLibrary non disponibile, uso fallback popular');
  }

  if (!libraryItems || libraryItems.length === 0) {
    console.log('   Libreria vuota → fallback popular');
    return await tmdb.getPopular(mediaType, language, 2);
  }

  // Prendi un campione dalla libreria (max 5 titoli recenti/preferiti)
  const sample = libraryItems.slice(0, 5);
  console.log(`   Sample libreria: ${sample.map(i => i.title || i.id).join(', ')}`);

  // Ottieni full details per ogni seed della libreria (in parallelo)
  const seedDetails = await Promise.allSettled(
    sample.map(item => tmdb.getFullDetails(mediaType, item.tmdbId || item.id, language))
  );

  const validSeeds = seedDetails
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  if (!validSeeds.length) {
    return await tmdb.getPopular(mediaType, language, 2);
  }

  // ── Costruisci profilo utente aggregato ───────────────────────────────────
  const keywordFreq = {};
  const genreFreq   = {};
  const companyFreq = {};
  const networkFreq = {};

  for (const seed of validSeeds) {
    for (const kwId of seed.keywordIds) {
      keywordFreq[kwId] = (keywordFreq[kwId] || 0) + 1;
    }
    for (const g of seed.genres) {
      genreFreq[g.id] = (genreFreq[g.id] || 0) + 1;
    }
    for (const cId of seed.companyIds) {
      companyFreq[cId] = (companyFreq[cId] || 0) + 1;
    }
    for (const nId of seed.networkIds) {
      networkFreq[nId] = (networkFreq[nId] || 0) + 1;
    }
  }

  // Prendi i top elementi per ciascuna categoria
  const topKeywords = Object.entries(keywordFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const topGenres = Object.entries(genreFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const topNetworks = Object.entries(networkFreq)
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);

  console.log(`   Profilo → keywords: ${topKeywords.join(',')}, genres: ${topGenres.join(',')}`);

  // IDs già in libreria da escludere
  const libraryIds = new Set(validSeeds.map(s => s.id));

  // ── Discover basato sul profilo ───────────────────────────────────────────
  const candidateMap = new Map();

  const addResult = (items, bonus) => {
    for (const item of items) {
      if (libraryIds.has(item.id)) continue;
      if (!candidateMap.has(item.id)) {
        candidateMap.set(item.id, { ...item, _scoreBonus: bonus });
      } else {
        // Accumula bonus se appare in più sorgenti
        candidateMap.get(item.id)._scoreBonus += bonus * 0.5;
      }
    }
  };

  const [byKeyword, byGenre, byNetwork] = await Promise.allSettled([
    topKeywords.length
      ? tmdb.discover(mediaType, { with_keywords: topKeywords.join(',') }, language, 2)
      : Promise.resolve([]),
    topGenres.length
      ? tmdb.discover(mediaType, { with_genres: topGenres.join(',') }, language, 2)
      : Promise.resolve([]),
    topNetworks.length && mediaType === 'tv'
      ? tmdb.discover(mediaType, { with_networks: topNetworks.join('|') }, language, 1)
      : Promise.resolve([])
  ]);

  if (byKeyword.status === 'fulfilled') addResult(byKeyword.value, 60);
  if (byGenre.status === 'fulfilled')   addResult(byGenre.value, 30);
  if (byNetwork.status === 'fulfilled') addResult(byNetwork.value, 40);

  // ── Scoring finale ────────────────────────────────────────────────────────
  const userSeed = {
    seedKeywordIds: topKeywords.map(Number),
    seedGenreIds:   topGenres.map(Number),
    seedCompanyIds: [],
    seedNetworkIds: topNetworks.map(Number),
    seedCreatorIds: []
  };

  const candidates = [...candidateMap.values()];
  const detailsList = await tmdb.getDetailsBatch(
    mediaType, candidates.slice(0, 60).map(c => c.id), language, 8
  );

  const scored = [];
  for (let i = 0; i < Math.min(candidates.length, 60); i++) {
    const details = detailsList[i];
    if (!details) continue;
    const result = scoreCandidate({ ...candidates[i], details }, userSeed);
    if (result) scored.push(result);
  }

  scored.sort((a, b) => b.score - a.score);
  console.log(`   ✅ Personalized recs: ${scored.length} titoli`);

  return scored.slice(0, 20);
}

// ─── getCatalog: entry point principale ──────────────────────────────────────
async function getCatalog(catalogType, catalogId) {
  console.log(`📺 getCatalog: ${catalogType} / ${catalogId}`);

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
    userUuid = parts.slice(1).join('-');
    return [{
      id: 'setup_placeholder',
      type: catalogType,
      name: '⚠️ Configura il tuo addon',
      poster: null,
      description: 'Vai su /configure per selezionare i tuoi film e serie preferiti',
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
  let metas = [];

  // ── Catalog "sim": simili a un titolo specifico ────────────────────────────
  if (prefix === 'sim' && seedId) {
    const items = await buildCandidates(mediaType, seedId, language);

    metas = items.map(item => ({
      id: `tmdb:${item.id}`,   // formato standard Stremio per TMDB
      type: mediaType,
      name: item.title,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,
      description: item.overview || '',
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      imdbRating: item.details?.vote_average?.toFixed(1),
      extra: {}
    }));

  // ── Catalog "rec": raccomandazioni personalizzate dalla libreria ───────────
  } else if (prefix === 'rec') {
    const items = await buildPersonalizedRecs(mediaType, userUuid, language);

    metas = items.map(item => ({
      id: `tmdb:${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,
      description: item.overview || 'Consigliato per te',
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
  }

  // ── Fallback finale se ancora vuoto ───────────────────────────────────────
  if (!metas.length) {
    console.log('   ⚠️ Fallback → popular');
    const popular = await tmdb.getPopular(mediaType || catalogType, language, 1);
    metas = popular.slice(0, 18).map(item => ({
      id: `tmdb:${item.id}`,
      type: mediaType || catalogType,
      name: item.title,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,
      description: item.overview || '',
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
  }

  console.log(`✅ Generati ${metas.length} items per catalog "${catalogId}"`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} entries`);
}

module.exports = { getCatalog, invalidateCache };
