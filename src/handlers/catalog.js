const NodeCache = require('node-cache');
const tmdb = require('../services/tmdb');
const { getUserConfig, getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({ stdTTL: 172800, checkperiod: 3600 });

// Calcola similarità tra due set di generi
function genreOverlap(seedGenres, itemGenres) {
  const seedIds = new Set(seedGenres.map(g => g.id));
  const overlap = itemGenres.filter(g => seedIds.has(g.id)).length;
  return overlap;
}

// Calcola similarità keyword (più pesante)
function keywordOverlap(seedKeywords, itemKeywords) {
  const seedKeywordNames = new Set(seedKeywords.map(k => k.name.toLowerCase()));
  const overlap = itemKeywords.filter(k => seedKeywordNames.has(k.name.toLowerCase())).length;
  return overlap;
}

// Calcola overlap cast
function castOverlap(seedCast, itemCast) {
  const seedCastIds = new Set(seedCast.map(c => c.id));
  const overlap = itemCast.filter(c => seedCastIds.has(c.id)).length;
  return overlap;
}

// Calcola overlap production companies
function companyOverlap(seedCompanies, itemCompanies) {
  const seedCompanyIds = new Set(seedCompanies.map(c => c.id));
  const overlap = itemCompanies.filter(c => seedCompanyIds.has(c.id)).length;
  return overlap;
}

// Calcola overlap directors
function directorOverlap(seedDirectors, itemDirectors) {
  const seedDirectorIds = new Set(seedDirectors.map(d => d.id));
  const overlap = itemDirectors.filter(d => seedDirectorIds.has(d.id)).length;
  return overlap;
}

// Calcola overlap networks/creators (per serie TV)
function networkOverlap(seedNetworks, itemNetworks) {
  const seedNetworkIds = new Set(seedNetworks.map(n => n.id));
  const overlap = itemNetworks.filter(n => seedNetworkIds.has(n.id)).length;
  return overlap;
}

function creatorOverlap(seedCreators, itemCreators) {
  const seedCreatorIds = new Set(seedCreators.map(c => c.id));
  const overlap = itemCreators.filter(c => seedCreatorIds.has(c.id)).length;
  return overlap;
}

// Scoring engine principale
function calculateScore(seedDetails, itemDetails) {
  let score = 0;
  
  // KEYWORD overlap - PESO 30 (più importante)
  const kwOverlap = keywordOverlap(seedDetails.keywords || [], itemDetails.keywords || []);
  score += kwOverlap * 30;
  
  // GENRE overlap - PESO 15
  const genreOverlapCount = genreOverlap(seedDetails.genres || [], itemDetails.genres || []);
  score += genreOverlapCount * 15;
  
  // STUDIO (production companies) - PESO 35 (molto importante per franchise)
  const companyOverlapCount = companyOverlap(seedDetails.production_companies || [], itemDetails.production_companies || []);
  score += companyOverlapCount * 35;
  
  // DIRECTOR - PESO 50 (altissimo per film)
  const directorOverlapCount = directorOverlap(seedDetails.director || [], itemDetails.director || []);
  score += directorOverlapCount * 50;
  
  // NETWORK (per serie TV) - PESO 25
  const networkOverlapCount = networkOverlap(seedDetails.networks || [], itemDetails.networks || []);
  score += networkOverlapCount * 25;
  
  // CREATOR (per serie TV) - PESO 45
  const creatorOverlapCount = creatorOverlap(seedDetails.creators || [], itemDetails.creators || []);
  score += creatorOverlapCount * 45;
  
  // CAST overlap - PESO 10
  const castOverlapCount = castOverlap(seedDetails.cast || [], itemDetails.cast || []);
  score += castOverlapCount * 10;
  
  // Voto bonus: +5 se voto > 7, +10 se voto > 8
  if (itemDetails.vote_average >= 8) score += 10;
  else if (itemDetails.vote_average >= 7) score += 5;
  
  // Tiny random noise per evitare pareggi perfetti (max 5 punti)
  score += Math.random() * 5;
  
  return score;
}

async function getCatalog(catalogType, catalogId) {
  console.log(`📺 getCatalog: ${catalogId}`);
  
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
  
  if (!userUuid) return [];
  
  const cacheKey = `${catalogId}:${userUuid}`;
  let cached = cache.get(cacheKey);
  if (cached) return cached;
  
  const language = await getUserLanguage(userUuid);
  let metas = [];
  
  if (prefix === 'sim' && seedId) {
    console.log(`🎯 Scoring similar for: ${seedId}`);
    
    // STEP 1: Ottieni dettagli COMPLETI del seed
    const seedDetails = await tmdb.getFullDetails(mediaType, seedId, language);
    if (!seedDetails) return [];
    
    console.log(`   Seed: ${seedDetails.title}`);
    console.log(`   Genres: ${seedDetails.genres.map(g => g.name).join(', ')}`);
    console.log(`   Keywords: ${seedDetails.keywords.slice(0,5).map(k => k.name).join(', ')}`);
    console.log(`   Director: ${seedDetails.director.map(d => d.name).join(', ')}`);
    console.log(`   Studio: ${seedDetails.production_companies.slice(0,3).map(c => c.name).join(', ')}`);
    
    // STEP 2: Raccogli candidati da multiple fonti
    const candidateIds = new Set();
    const candidates = [];
    
    // Fonte 1: Recommendations diretti
    for (const rec of seedDetails.recommendations) {
      if (!candidateIds.has(rec.id)) {
        candidateIds.add(rec.id);
        candidates.push({ id: rec.id, title: rec.title || rec.name, source: 'recommendations' });
      }
    }
    
    // Fonte 2: Similar
    for (const sim of seedDetails.similar) {
      if (!candidateIds.has(sim.id)) {
        candidateIds.add(sim.id);
        candidates.push({ id: sim.id, title: sim.title || sim.name, source: 'similar' });
      }
    }
    
    // Fonte 3: Discover per genere (se abbiamo generi)
    if (seedDetails.genres.length > 0) {
      const genreIds = seedDetails.genres.map(g => g.id).join(',');
      const byGenre = await tmdb.discover(mediaType, { with_genres: genreIds, 'vote_average.gte': 6 }, language, 2);
      for (const item of byGenre) {
        if (!candidateIds.has(item.id) && item.id !== seedId) {
          candidateIds.add(item.id);
          candidates.push({ id: item.id, title: item.title, source: 'discover_genre' });
        }
      }
    }
    
    // Fonte 4: Discover per keyword (se abbiamo keyword TMDB)
    if (seedDetails.keywords.length > 0) {
      const keywordIds = seedDetails.keywords.slice(0, 5).map(k => k.id).join(',');
      const byKeyword = await tmdb.discover(mediaType, { with_keywords: keywordIds }, language, 1);
      for (const item of byKeyword) {
        if (!candidateIds.has(item.id) && item.id !== seedId) {
          candidateIds.add(item.id);
          candidates.push({ id: item.id, title: item.title, source: 'discover_keyword' });
        }
      }
    }
    
    // Fonte 5: Discover per studio (se abbiamo production companies)
    if (seedDetails.production_companies.length > 0) {
      const companyIds = seedDetails.production_companies.slice(0, 3).map(c => c.id).join(',');
      const byCompany = await tmdb.discover(mediaType, { with_companies: companyIds }, language, 1);
      for (const item of byCompany) {
        if (!candidateIds.has(item.id) && item.id !== seedId) {
          candidateIds.add(item.id);
          candidates.push({ id: item.id, title: item.title, source: 'discover_company' });
        }
      }
    }
    
    // Fonte 6: Discover per regista (se abbiamo director)
    if (seedDetails.director.length > 0) {
      const directorIds = seedDetails.director.map(d => d.id).join(',');
      const byDirector = await tmdb.discover(mediaType, { with_people: directorIds }, language, 1);
      for (const item of byDirector) {
        if (!candidateIds.has(item.id) && item.id !== seedId) {
          candidateIds.add(item.id);
          candidates.push({ id: item.id, title: item.title, source: 'discover_director' });
        }
      }
    }
    
    console.log(`   Candidati raccolti: ${candidates.length}`);
    
    // STEP 3: Scoring per ogni candidato
    const scoredItems = [];
    for (const candidate of candidates.slice(0, 150)) { // Max 150 per performance
      const itemDetails = await tmdb.getFullDetails(mediaType, candidate.id, language);
      if (itemDetails) {
        const score = calculateScore(seedDetails, itemDetails);
        scoredItems.push({
          ...candidate,
          details: itemDetails,
          score: score
        });
      }
    }
    
    // STEP 4: Ordina per score (decrescente)
    scoredItems.sort((a, b) => b.score - a.score);
    
    // STEP 5: Diversificazione intelligente
    const finalItems = [];
    const studioCount = new Map();
    const franchiseCount = new Map();
    
    for (const item of scoredItems) {
      // Limite per studio (max 3 per studio)
      const studioName = item.details.production_companies[0]?.name;
      if (studioName) {
        if (studioCount.get(studioName) >= 3) continue;
        studioCount.set(studioName, (studioCount.get(studioName) || 0) + 1);
      }
      
      // Limite per franchise (basato su keyword comuni - max 2)
      const franchiseKeyword = item.details.keywords.find(k => 
        seedDetails.keywords.some(sk => sk.name === k.name && sk.name.includes('franchise'))
      );
      if (franchiseKeyword) {
        if (franchiseCount.get(franchiseKeyword.name) >= 2) continue;
        franchiseCount.set(franchiseKeyword.name, (franchiseCount.get(franchiseKeyword.name) || 0) + 1);
      }
      
      finalItems.push(item);
      if (finalItems.length >= 50) break;
    }
    
    console.log(`   Finali dopo diversificazione: ${finalItems.length}`);
    
    // STEP 6: Costruisci metas
    metas = finalItems.map(item => ({
      id: `sim_${seedId}_${item.id}`,
      type: mediaType,
      name: item.details.title,
      poster: item.details.poster_path ? `https://image.tmdb.org/t/p/w342${item.details.poster_path}` : null,
      description: item.details.overview || `Similar to ${seedDetails.title} (score: ${Math.round(item.score)})`,
      releaseInfo: item.details.release_date ? item.details.release_date.split('-')[0] : '',
      extra: {}
    }));
    
  } else if (prefix === 'rec') {
    console.log(`✨ Recommendations for ${mediaType}`);
    
    const config = await getUserConfig(userUuid);
    const seeds = mediaType === 'movie' 
      ? (config.selected_movies || [])
      : (config.selected_series || []);
    
    let allCandidates = [];
    const seenIds = new Set();
    
    for (const seed of seeds.slice(0, 10)) {
      const seedId = seed.tmdb_id || seed.id;
      if (seedId) {
        const seedDetails = await tmdb.getFullDetails(mediaType, seedId, language);
        if (seedDetails) {
          // Prendi recommendations e similar
          for (const rec of seedDetails.recommendations) {
            if (!seenIds.has(rec.id)) {
              seenIds.add(rec.id);
              allCandidates.push({ id: rec.id, title: rec.title || rec.name, seedScore: 1 });
            }
          }
          for (const sim of seedDetails.similar) {
            if (!seenIds.has(sim.id)) {
              seenIds.add(sim.id);
              allCandidates.push({ id: sim.id, title: sim.title || sim.name, seedScore: 0.8 });
            }
          }
        }
      }
    }
    
    // Scoring per raccomandazioni
    const scoredRecs = [];
    for (const candidate of allCandidates.slice(0, 100)) {
      const itemDetails = await tmdb.getFullDetails(mediaType, candidate.id, language);
      if (itemDetails && itemDetails.vote_average > 5) {
        let score = itemDetails.vote_average * 10 + candidate.seedScore * 20;
        score += Math.random() * 5;
        scoredRecs.push({ details: itemDetails, score });
      }
    }
    
    scoredRecs.sort((a, b) => b.score - a.score);
    
    metas = scoredRecs.slice(0, 50).map(item => ({
      id: `rec_${item.details.id}`,
      type: mediaType,
      name: item.details.title,
      poster: item.details.poster_path ? `https://image.tmdb.org/t/p/w342${item.details.poster_path}` : null,
      description: item.details.overview || `Recommended for you`,
      releaseInfo: item.details.release_date ? item.details.release_date.split('-')[0] : '',
      extra: {}
    }));
  }
  
  // Fallback finale
  if (metas.length === 0) {
    console.log(`⚠️ Fallback a popolari`);
    const popular = await tmdb.getPopular(mediaType || catalogType, language, 2);
    metas = popular.slice(0, 50).map(item => ({
      id: `pop_${item.id}`,
      type: mediaType || catalogType,
      name: item.title,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
      description: `Popular ${mediaType || catalogType}`,
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
  if (keys.length) {
    cache.del(keys);
    console.log(`🗑️ Cache invalidata per ${userUuid}`);
  }
}

module.exports = { getCatalog, invalidateCache };
