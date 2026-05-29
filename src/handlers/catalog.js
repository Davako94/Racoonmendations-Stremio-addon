/**
 * src/handlers/catalog.js
 * Gestisce la risoluzione dei cataloghi richiesti da Stremio / AIOMetadata.
 * Integra la logica di rotazione pseudocasuale oraria basata sulla configurazione utente.
 */

const NodeCache = require('node-cache');
const crypto = require('crypto');
const tmdb = require('../services/tmdb');
const { getUserConfig, getUserLanguage } = require('../services/userStore');

// Cache con 1 ora di TTL per ottimizzare le chiamate TMDB ed evitare rate-limit
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// ============================================================
// UTILITY PER LA ROTAZIONE ORARIA SEEDED
// ============================================================
function getHourlySeed(userUuid) {
  const hourIndex = Math.floor(Date.now() / 3600000);
  const hash = crypto.createHash('sha256').update(`${userUuid}:${hourIndex}`).digest();
  return hash.readUInt32LE(0);
}

function sampleRandom(items, count, seed) {
  const result = [...items];
  if (typeof seed === 'number') {
    let state = seed >>> 0;
    const seededRandom = () => {
      state = Math.imul(state ^ (state >>> 15), 2246822519);
      state = (state + Math.imul(state ^ (state >>> 7), 3266489917)) >>> 0;
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
  } else {
    for (let i = result.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
  }
  return result.slice(0, Math.min(count, result.length));
}

// ============================================================
// SCORING ALGORITHM (Weighted Bayesian Rating)
// ============================================================
function scoreItem(item) {
  const R = item.vote_average || 0; 
  const v = item.vote_count || 0; 
  const m = 100; 
  const C = 6.5; 
  
  let baseScore = (v / (v + m)) * R + (m / (v + m)) * C;
  
  if ((item.popularity || 0) > 500 && R > 7.5) {
    baseScore += 0.5;
  }
  if (v >= 100 && R >= 7.0) {
    baseScore += 1.0;
  }
  
  return Math.min(10, Math.max(0, baseScore));
}

function mergeAndScoreItems(recs, similar) {
  const merged = [...recs, ...similar];
  const unique = new Map();
  
  for (const item of merged) {
    if (item && item.id && !unique.has(item.id)) {
      unique.set(item.id, {
        ...item,
        score: scoreItem(item)
      });
    }
  }
  
  const items = Array.from(unique.values());
  items.sort((a, b) => (b.score || 0) - (a.score || 0));
  return items;
}

// ============================================================
// CORE CATALOG HANDLER
// ============================================================
async function getCatalog(catalogType, catalogId, userUuid) {
  console.log(`📺 getCatalog richiesto: ${catalogType}/${catalogId} (query uuid: ${userUuid})`);

  // Estrazione di sicurezza del fallback UUID dalla coda dell'ID catalogo
  let finalUuid = userUuid;
  if ((!finalUuid || finalUuid === 'public') && catalogId.includes('_')) {
    const parts = catalogId.split('_');
    finalUuid = parts[parts.length - 1]; 
  }

  const cacheKey = `${catalogId}:${finalUuid || 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`   ✅ Risposta da Cache: ${cached.length} elementi`);
    return cached;
  }

  let seedIds = [];
  let isRecommendations = false;

  // 1) Elaborazione dei nuovi cataloghi statici compatibili con AIOMetadata
  if (catalogId.startsWith('raccoon_similar_movies_') || catalogId.startsWith('raccoon_similar_series_')) {
    try {
      const config = await getUserConfig(finalUuid);
      if (config) {
        const isMovie = catalogType === 'movie';
        const selected = isMovie 
          ? (config.selectedMovies || config.selected_movies || [])
          : (config.selectedSeries || config.selected_series || []);
        
        if (selected.length > 0) {
          const hourSeed = getHourlySeed(finalUuid);
          // Estraiamo fino a 3 seed stabili orari dell'utente per generare un catalogo ricco
          const randomSeeds = sampleRandom(selected, 3, hourSeed + (isMovie ? 0 : 1));
          
          seedIds = randomSeeds.map(s => {
            let id = String(s.id);
            if (id.startsWith('tmdb:')) id = id.replace('tmdb:', '');
            return id;
          });
          console.log(`   🎯 [Static Catalog] Seed estratti per l'ora corrente:`, seedIds);
        }
      }
    } catch (err) {
      console.error(`   ❌ Errore estrazione seed orari nel catalogo:`, err.message);
    }
  }
  
  // Fallback: Supporto legacy se arrivano vecchi ID accumulati in cache
  if (seedIds.length === 0 && catalogId.startsWith('similar_')) {
    const parts = catalogId.split('_');
    if (parts.length >= 2) {
      let singleSeed = parts[1];
      if (singleSeed.startsWith('tmdb:')) singleSeed = singleSeed.replace('tmdb:', '');
      seedIds.push(singleSeed);
    }
  }

  if (catalogId.startsWith('rec_') || catalogId.startsWith('raccoon_public_')) {
    isRecommendations = true;
  }

  const language = await getUserLanguage(finalUuid);
  let items = [];

  // Risoluzione dei seed ed esecuzione chiamate TMDB parallele
  if (seedIds.length > 0) {
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    try {
      const promises = seedIds.map(async (id) => {
        try {
          const [recs, similar] = await Promise.all([
            tmdb.getRecommendations(mediaType, id, language).catch(() => []),
            tmdb.getSimilar(mediaType, id, language).catch(() => [])
          ]);
          return [...recs, ...similar];
        } catch {
          return [];
        }
      });

      const allResults = await Promise.all(promises);
      const flattened = allResults.flat();
      
      items = mergeAndScoreItems(flattened, []);
      items = items.slice(0, 20);
      console.log(`   Scoring completato. Generati ${items.length} elementi.`);
    } catch (err) {
      console.error(`   Errore nel recupero dati TMDB dalle promesse:`, err.message);
    }
  }

  // Generazione raccomandazioni globali/popolari come riempimento o catalogo dedicato
  if (isRecommendations || items.length === 0) {
    const mediaType = catalogType === 'movie' ? 'movie' : 'tv';
    try {
      items = await tmdb.getPopular(mediaType, language, 2);
      items = items.map(item => ({
        ...item,
        score: scoreItem(item)
      })).sort((a, b) => (b.score || 0) - (a.score || 0));
      items = items.slice(0, 20);
    } catch (err) {
      console.error(`   Errore caricamento popolari TMDB:`, err.message);
    }
  }

  // Costruzione degli oggetti Meta conformi alle specifiche dello schema Stremio Addon
  const metas = items.map(item => ({
    id: `tmdb:${item.id}`,
    type: catalogType === 'movie' ? 'movie' : 'series',
    name: item.title || item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    description: item.overview || '',
    releaseInfo: item.release_date 
      ? item.release_date.split('-')[0] 
      : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
    extra: {}
  }));

  cache.set(cacheKey, metas);
  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache.keys().filter(k => k.includes(userUuid));
  cache.del(keys);
  console.log(`🗑️ Cache invalidata per UUID: ${keys.length}`);
}

module.exports = { getCatalog, invalidateCache };