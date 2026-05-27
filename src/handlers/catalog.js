const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage, getUserLibrary } = require('../services/userStore');

// Cache estesa per le operazioni pesanti: 48 ore (172800 secondi)
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

  // Hard filter: deve avere almeno una relazione semantica
  if (!isFromPrimary && !hasKeywordMatch) return null;

  let score = candidate._scoreBonus || 0;
  score += keywordOverlap * 45;
  score += genreOverlap   * 15;
  score += companyOverlap * 40;
  score += networkOverlap * 30;
  score += creatorOverlap * 50;

  // Penalità ridotta e condizionale
  if (genreOverlap === 0 && keywordOverlap === 0 && !isFromPrimary) score -= 80;
  else if (genreOverlap === 0 && isFromPrimary) score -= 20;

  // Bonus qualità
  if (d.vote_average >= 8.0)      score += 20;
  else if (d.vote_average >= 7.5) score += 12;
  else if (d.vote_average >= 7.0) score += 6;
  else if (d.vote_average < 5.5)  score -= 20;

  return { ...candidate, score, keywordOverlap, genreOverlap };
}

// ─── buildCandidates: simili a UN singolo seedId (Legacy/Dinamico) ───────────
async function buildCandidates(mediaType, rawSeedId, language) {
  console.log(`🎯 buildCandidates → TMDB ID: ${rawSeedId}`);

  const metadata = await tmdb.getFullDetails(mediaType, rawSeedId, language);
  if (!metadata) {
    console.error(`   ❌ getFullDetails fallito per ID: ${rawSeedId}`);
    return [];
  }

  const displayName = metadata.title || metadata.name || 'Unknown';
  console.log(`   ✅ Seed: "${displayName}" (TMDB: ${metadata.id})`);
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

  // Sorgenti ordinate per rilevanza
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

  // Fetch details in parallelo (max 80)
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
    console.log(`     "${c.title || c.name}" score:${Math.round(c.score)} kw:${c.keywordOverlap} src:${c._source}`)
  );

  return final;
}

// ─── buildPersonalizedRecs: cuore del sistema Netflix-like ───────────────────
async function buildPersonalizedRecs(libraryType, tmdbType, userUuid, language) {
  console.log(`🧠 buildPersonalizedRecs → user: ${userUuid}, libType: ${libraryType}, tmdbType: ${tmdbType}`);

  // Chiediamo al db i salvataggi specifici ('movie', 'series' o 'anime')
  const libraryItems = await getUserLibrary(userUuid, libraryType);

  if (!libraryItems || !libraryItems.length) {
    console.log('   Libreria vuota → fallback popular');
    return await tmdb.getPopular(tmdbType, language, 2);
  }

  console.log(`   Titoli in libreria (${libraryType}): ${libraryItems.length}`);

  // Ottieni full details per TUTTI i seed
  const detailsList = await Promise.allSettled(
    libraryItems.map(item => tmdb.getFullDetails(tmdbType, item.id, language))
  );

  const validSeeds = detailsList
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  console.log(`   Seed risolti: ${validSeeds.length}/${libraryItems.length}`);

  if (!validSeeds.length) {
    console.log('   Nessun seed valido → fallback popular');
    return await tmdb.getPopular(tmdbType, language, 2);
  }

  // ── Costruisci profilo utente aggregato ───────────────────────────────────
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

  // ── Discover in parallelo basato sul profilo ──────────────────────────────
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

  const discoverResults = await Promise.allSettled([
    topKeywords.length
      ? tmdb.discover(tmdbType, { with_keywords: topKeywords.join(',') }, language, 2)
      : Promise.resolve([]),
    topGenres.length
      ? tmdb.discover(tmdbType, { with_genres: topGenres.join(','), sort_by: 'vote_average.desc' }, language, 2)
      : Promise.resolve([]),
    topNetworks.length && tmdbType === 'tv'
      ? tmdb.discover(tmdbType, { with_networks: topNetworks.join('|') }, language, 1)
      : Promise.resolve([])
  ]);

  const [byKeyword, byGenre, byNetwork] = discoverResults;
  if (byKeyword.status === 'fulfilled') addToMap(byKeyword.value, 60);
  if (byGenre.status === 'fulfilled')   addToMap(byGenre.value,   30);
  if (byNetwork.status === 'fulfilled') addToMap(byNetwork.value, 40);

  // ── Scoring finale contro il profilo aggregato ────────────────────────────
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
    tmdbType, pool.map(c => c.id), language, 8
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

// ─── getCatalog: Entry Point Principale (Connesso a index.js) ────────────────
async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`\n📺 getCatalog: type="${catalogType}", id="${catalogId}", uuid="${userUuid}"`);

  // Gestione Utente non configurato
  if (!userUuid) {
    return [{
      id: 'setup_placeholder',
      type: catalogType,
      name: '⚠️ Setup Required',
      poster: null,
      description: 'Open addon configuration to select your favorite titles.',
      releaseInfo: '',
      extra: {}
    }];
  }

  const cacheKey = `${catalogType}:${catalogId}:${userUuid}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Cache hit: ${cached.length} items`);
    return cached;
  }

  // Otteniamo la lingua (default: en)
  let language = 'en';
  try { language = await getUserLanguage(userUuid) || 'en'; } catch(e) {}
  
  let items = [];

  // Routing basato sull'ID del catalogo (Manifest)
  try {
    if (catalogId === 'raccon-movies') {
      items = await buildPersonalizedRecs('movie', 'movie', userUuid, language);
    } else if (catalogId === 'raccon-series') {
      items = await buildPersonalizedRecs('series', 'tv', userUuid, language);
    } else if (catalogId === 'raccon-anime') {
      // Per gli anime cerchiamo i salvataggi 'anime' ma li passiamo a TMDB come 'tv'
      items = await buildPersonalizedRecs('anime', 'tv', userUuid, language);
    } 
    // Fallback Legacy (es. sim-movie-12345)
    else if (catalogId.startsWith('sim-')) {
      const parts = catalogId.split('-');
      const mediaType = parts[1]; // 'movie' o 'tv'
      const seedId = parts[2];
      items = await buildCandidates(mediaType, seedId, language);
    }

    // Fallback assoluto: se il motore non trova nulla, mostra roba popolare
    if (!items || !items.length) {
      console.log('   ⚠️ Nessun risultato dal motore → fallback popular');
      const tmdbType = catalogType === 'series' ? 'tv' : 'movie';
      items = await tmdb.getPopular(tmdbType, language, 1);
    }
  } catch (err) {
    console.error('   ❌ Errore durante la generazione catalogo:', err);
    items = [];
  }

  // Formattazione per Stremio
  const metas = (items || []).map(item => {
    // TMDB usa title per i film, name per serie/anime
    const displayName = item.title || item.name || 'Unknown';
    // Estrazione anno di uscita
    const dateField = item.release_date || item.first_air_date;
    const year = dateField ? dateField.split('-')[0] : '';

    return {
      id: `tmdb:${item.id}`,
      type: catalogType, // Manteniamo la tipologia che Stremio si aspetta (movie/series)
      name: displayName,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,
      description: item.overview || '',
      releaseInfo: year,
      extra: {}
    };
  });

  console.log(`✅ Generati ${metas.length} metas per il catalogo`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per ${userUuid}: ${keys.length} entries rimosse`);
}

module.exports = { getCatalog, invalidateCache };
