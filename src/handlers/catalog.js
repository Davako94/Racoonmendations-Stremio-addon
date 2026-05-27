const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

function overlap(a = [], b = []) {
  const setB = new Set(b);
  return a.filter(x => setB.has(x)).length;
}

async function buildCandidates(mediaType, seedId, language) {
  console.log(`🎯 Building candidates for: ${seedId}`);
  
  // STEP 1: Ottieni metadata del seed
  const metadata = await tmdb.getFullDetails(mediaType, seedId, language);
  if (!metadata) return [];
  
  console.log(`   Seed: ${metadata.title}`);
  console.log(`   Keywords: ${metadata.keywords.slice(0,5).map(k => k.name).join(', ')}`);
  console.log(`   Companies: ${metadata.companies.slice(0,3).map(c => c.name).join(', ')}`);
  
  const seedKeywordIds = metadata.keywordIds;
  const seedCompanyIds = metadata.companyIds;
  const seedNetworkIds = metadata.networkIds;
  const seedCreatorIds = metadata.creatorIds;
  const seedGenreIds = metadata.genres.map(g => g.id);
  
  // STEP 2: Raccogli candidati da fonti primarie
  let candidates = [];
  const seenIds = new Set();
  
  // Fonte 1: Recommendations (massima priorità)
  for (const rec of metadata.recommendations) {
    if (!seenIds.has(rec.id) && rec.id !== seedId) {
      seenIds.add(rec.id);
      candidates.push({ ...rec, _source: 'recommendation', _scoreBonus: 80 });
    }
  }
  
  // Fonte 2: Similar (priorità alta)
  for (const sim of metadata.similar) {
    if (!seenIds.has(sim.id) && sim.id !== seedId) {
      seenIds.add(sim.id);
      candidates.push({ ...sim, _source: 'similar', _scoreBonus: 70 });
    }
  }
  
  // Fonte 3: Discover per keyword (priorità media)
  if (seedKeywordIds.length) {
    const keywordIds = seedKeywordIds.slice(0, 5).join(',');
    const byKeyword = await tmdb.discover(mediaType, { with_keywords: keywordIds, vote_average_gte: 6 }, language, 2);
    for (const item of byKeyword) {
      if (!seenIds.has(item.id) && item.id !== seedId) {
        seenIds.add(item.id);
        candidates.push({ ...item, _source: 'keyword', _scoreBonus: 40 });
      }
    }
  }
  
  // Fonte 4: Discover per studio (priorità alta)
  if (seedCompanyIds.length) {
    const byCompany = await tmdb.discover(mediaType, { with_companies: seedCompanyIds.join('|') }, language, 1);
    for (const item of byCompany) {
      if (!seenIds.has(item.id) && item.id !== seedId) {
        seenIds.add(item.id);
        candidates.push({ ...item, _source: 'company', _scoreBonus: 50 });
      }
    }
  }
  
  // Fonte 5: Discover per network/creator (per serie)
  if (mediaType === 'tv') {
    if (seedNetworkIds.length) {
      const byNetwork = await tmdb.discover(mediaType, { with_networks: seedNetworkIds.join('|') }, language, 1);
      for (const item of byNetwork) {
        if (!seenIds.has(item.id) && item.id !== seedId) {
          seenIds.add(item.id);
          candidates.push({ ...item, _source: 'network', _scoreBonus: 35 });
        }
      }
    }
    if (seedCreatorIds.length) {
      const byCreator = await tmdb.discover(mediaType, { with_people: seedCreatorIds.join('|') }, language, 1);
      for (const item of byCreator) {
        if (!seenIds.has(item.id) && item.id !== seedId) {
          seenIds.add(item.id);
          candidates.push({ ...item, _source: 'creator', _scoreBonus: 45 });
        }
      }
    }
  }
  
  console.log(`   Candidati raccolti: ${candidates.length} (unique)`);
  
  // STEP 3: HARD FILTER - solo candidati con keyword overlap OPPURE da recommendation/similar
  const candidatesWithDetails = [];
  
  for (const candidate of candidates.slice(0, 60)) { // Max 60 per performance
    // Ottieni dettagli del candidato (keywords, companies, etc)
    const details = await tmdb.getDetails(mediaType, candidate.id, language);
    if (!details) continue;
    
    const keywordOverlap = overlap(seedKeywordIds, details.keywordIds);
    const genreOverlap = overlap(seedGenreIds, details.genres.map(g => g.id));
    const companyOverlap = overlap(seedCompanyIds, details.companyIds);
    const networkOverlap = overlap(seedNetworkIds, details.networkIds);
    const creatorOverlap = overlap(seedCreatorIds, details.creatorIds);
    
    // HARD FILTER: deve avere almeno 1 keyword match OPPURE essere recommendation/similar
    const isFromPrimary = candidate._source === 'recommendation' || candidate._source === 'similar';
    const hasKeywordMatch = keywordOverlap >= 1;
    
    if (!isFromPrimary && !hasKeywordMatch) {
      continue; // SCARTA candidati senza nessuna relazione semantica
    }
    
    // STEP 4: SCORING
    let score = 0;
    
    score += candidate._scoreBonus || 0;
    score += keywordOverlap * 45;        // PESO MASSIMO
    score += genreOverlap * 10;         // PESO BASSO (solo supporto)
    score += companyOverlap * 40;
    score += networkOverlap * 30;
    score += creatorOverlap * 50;
    
    // Penalità se genre overlap = 0
    if (genreOverlap === 0) score -= 100;
    
    // Penalità se keyword overlap = 0 (ma è recommendation/similar, quindi ok)
    if (keywordOverlap === 0 && !isFromPrimary) score -= 40;
    
    // Bonus voto (piccolo)
    if (details.vote_average >= 8) score += 15;
    else if (details.vote_average >= 7) score += 8;
    
    // NESSUNA POPULARITY NEL CALCOLO
    
    candidatesWithDetails.push({
      ...candidate,
      details,
      score,
      keywordOverlap,
      genreOverlap
    });
  }
  
  // Ordina per score
  candidatesWithDetails.sort((a, b) => b.score - a.score);
  
  // LIMITE MASSIMO 18 RISULTATI
  const finalCandidates = candidatesWithDetails.slice(0, 18);
  
  console.log(`   Finali dopo scoring: ${finalCandidates.length}`);
  finalCandidates.forEach(c => {
    console.log(`     ${c.title} (score: ${Math.round(c.score)}, kw:${c.keywordOverlap}, src:${c._source})`);
  });
  
  return finalCandidates.map(c => c);
}

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
      id: "setup_placeholder",
      type: catalogType,
      name: "⚠️ Configure your addon",
      poster: null,
      description: "Go to /configure to select your favorite movies and series",
      releaseInfo: "",
      extra: {}
    }];
  }
  
  if (!userUuid) return [];
  
  const cacheKey = `${catalogId}:${userUuid}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  
  const language = await getUserLanguage(userUuid);
  let metas = [];
  
  if (prefix === 'sim' && seedId) {
    const items = await buildCandidates(mediaType, seedId, language);
    
    metas = items.map(item => ({
      id: `sim_${seedId}_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || '',
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
  } else if (prefix === 'rec') {
    // Raccomandazioni - versione semplificata per ora
    const popular = await tmdb.getPopular(mediaType, language, 2);
    metas = popular.slice(0, 20).map(item => ({
      id: `rec_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || 'Recommended for you',
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
  }
  
  // Fallback finale
  if (!metas.length) {
    const popular = await tmdb.getPopular(mediaType || catalogType, language, 1);
    metas = popular.slice(0, 18).map(item => ({
      id: `pop_${item.id}`,
      type: mediaType || catalogType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: item.overview || '',
      releaseInfo: item.release_date ? item.release_date.split('-')[0] : '',
      extra: {}
    }));
  }
  
  console.log(`✅ Generati ${metas.length} items`);
  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per ${userUuid}`);
}

module.exports = { getCatalog, invalidateCache };
