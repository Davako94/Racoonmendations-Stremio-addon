const axios = require('axios');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';

const LANGUAGE_MAP = {
  en: 'en-US',
  it: 'it-IT',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR'
};

// Utility interna per normalizzare i tipi Stremio/DB nei tipi TMDB (movie/tv)
function normalizeMediaType(type) {
  if (!type) return 'movie';
  const t = type.toLowerCase();
  if (t === 'movie') return 'movie';
  if (t === 'series' || t === 'tv' || t === 'show' || t === 'anime') return 'tv';
  return 'movie';
}

function mapItem(item, mediaType) {
  return {
    id: item.id,
    title: item.title || item.name,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    overview: item.overview,
    vote_average: item.vote_average,
    popularity: item.popularity,
    genre_ids: item.genre_ids || [],
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  };
}

// ─── Converti IMDB ID (tt1234567) → TMDB ID numerico ───────────────────
async function imdbToTmdb(imdbId, type) {
  const mediaType = normalizeMediaType(type);
  try {
    const res = await axios.get(`${BASE}/find/${imdbId}`, {
      params: {
        api_key: TMDB_API_KEY,
        external_source: 'imdb_id'
      }
    });
    const results = mediaType === 'movie'
      ? res.data.movie_results
      : res.data.tv_results;
    return results?.[0]?.id || null;
  } catch (e) {
    console.error('❌ imdbToTmdb error:', e.message);
    return null;
  }
}

// ─── Risolvi ID — accetta sia TMDB numerico che IMDB (tt...) ───────────
async function resolveId(rawId, type) {
  if (!rawId) return null;
  const str = String(rawId);
  const mediaType = normalizeMediaType(type);
  
  if (str.startsWith('tt')) {
    console.log(`    🔄 Conversione IMDB→TMDB: ${str}`);
    return await imdbToTmdb(str, mediaType);
  }
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
}

// ─── Ottieni dettagli COMPLETI con keywords ───────────────────────────────────
async function getFullDetails(type, rawId, language = 'en') {
  const mediaType = normalizeMediaType(type);
  const lang = LANGUAGE_MAP[language] || 'en-US';

  const tmdbId = await resolveId(rawId, mediaType);
  if (!tmdbId) {
    console.error(`❌ getFullDetails: impossibile risolvere ID ${rawId}`);
    return null;
  }

  try {
    const append = mediaType === 'movie'
      ? 'keywords,credits,recommendations,similar'
      : 'keywords,aggregate_credits,recommendations,similar';

    const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}`, {
      params: {
        api_key: TMDB_API_KEY,
        language: lang,
        append_to_response: append
      }
    });

    const data = res.data;

    const keywords = mediaType === 'movie'
      ? (data.keywords?.keywords || [])
      : (data.keywords?.results || []);

    const credits = mediaType === 'movie'
      ? data.credits
      : data.aggregate_credits;

    // FIX: Nelle serie TV (aggregate_credits) i ruoli sono nidificati dentro l'array 'jobs'
    let director = null;
    if (mediaType === 'movie') {
      director = credits?.crew?.find(c => c.job === 'Director');
    } else {
      director = credits?.crew?.find(c => c.jobs && c.jobs.some(j => j.job === 'Director' || j.job === 'Creator'));
    }

    return {
      id: data.id,
      title: data.title || data.name,
      genres: data.genres || [],
      keywords: keywords.map(k => ({ id: k.id, name: k.name.toLowerCase() })),
      keywordIds: keywords.map(k => k.id),
      companies: data.production_companies || [],
      companyIds: (data.production_companies || []).map(c => c.id),
      networks: data.networks || [],
      networkIds: (data.networks || []).map(n => n.id),
      creators: data.created_by || [],
      creatorIds: (data.created_by || []).map(c => c.id),
      cast: (credits?.cast || []).slice(0, 10),
      director,
      vote_average: data.vote_average,
      recommendations: data.recommendations?.results?.map(i => mapItem(i, mediaType)) || [],
      similar: data.similar?.results?.map(i => mapItem(i, mediaType)) || []
    };
  } catch (e) {
    console.error('❌ getFullDetails error:', e.message);
    return null;
  }
}

// ─── Ottieni dettagli base (per candidati, più leggero) ───────────────────────
async function getDetails(type, id, language = 'en') {
  const mediaType = normalizeMediaType(type);
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${id}`, {
      params: {
        api_key: TMDB_API_KEY,
        language: lang,
        append_to_response: 'keywords'
      }
    });
    const data = res.data;
    const keywords = mediaType === 'movie'
      ? (data.keywords?.keywords || [])
      : (data.keywords?.results || []);

    return {
      id: data.id,
      title: data.title || data.name,
      genres: data.genres || [],
      keywordIds: keywords.map(k => k.id),
      companyIds: (data.production_companies || []).map(c => c.id),
      networkIds: (data.networks || []).map(n => n.id),
      creatorIds: (data.created_by || []).map(c => c.id),
      vote_average: data.vote_average
    };
  } catch (e) {
    return null;
  }
}

// ─── Batch getDetails in parallelo (max `concurrency` alla volta) ──────
async function getDetailsBatch(type, ids, language = 'en', concurrency = 8) {
  const mediaType = normalizeMediaType(type);
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(id => getDetails(mediaType, id, language))
    );
    for (const r of settled) {
      results.push(r.status === 'fulfilled' ? r.value : null);
    }
  }
  return results;
}

// ─── Discover con parametri ───────────────────────────────────────────────────
async function discover(type, params = {}, language = 'en', maxPages = 1) {
  const mediaType = normalizeMediaType(type);
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let all = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/discover/${mediaType}`, {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          sort_by: 'vote_average.desc',
          'vote_count.gte': 200,
          'vote_average.gte': 6.0,
          include_adult: false,
          page,
          ...params
        }
      });
      if (!res.data.results?.length) break;
      all.push(...res.data.results.map(i => mapItem(i, mediaType)));
      if (page >= res.data.total_pages) break;
    } catch (e) {
      console.error('❌ discover error:', e.message);
      break;
    }
  }
  return all;
}

// ─── Popolari — SOLO FALLBACK FINALE ──────────────────────────────────────────
async function getPopular(type, language = 'en', maxPages = 1) {
  const mediaType = normalizeMediaType(type);
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let all = [];
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/${mediaType}/popular`, {
        params: { api_key: TMDB_API_KEY, language: lang, page }
      });
      all.push(...res.data.results.map(i => mapItem(i, mediaType)));
    } catch (e) { break; }
  }
  return all;
}

// ─── IMPLEMENTATO: Cerca su TMDB (Standard) ───────────────────────────────────
async function searchTmdb(query, type, language = 'en') {
  const mediaType = normalizeMediaType(type);
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/search/${mediaType}`, {
      params: {
        api_key: TMDB_API_KEY,
        query: query,
        language: lang,
        include_adult: false
      }
    });
    return (res.data.results || []).map(i => mapItem(i, mediaType));
  } catch (e) {
    console.error('❌ searchTmdb error:', e.message);
    return [];
  }
}

// ─── IMPLEMENTATO: Cerca Anime (Filtro mirato per Animazione Giapponese) ──────
async function searchAnime(query, language = 'en') {
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    // Cerchiamo l'anime come serie TV
    const res = await axios.get(`${BASE}/search/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        query: query,
        language: lang,
        include_adult: false
      }
    });
    
    // Filtriamo i risultati: deve avere genere Animation (16) ed essere prodotto in Giappone (JP)
    const animeResults = (res.data.results || []).filter(item => {
      const isAnimation = item.genre_ids && item.genre_ids.includes(16);
      const isJapanese = item.origin_country && item.origin_country.includes('JP');
      return isAnimation && isJapanese;
    });

    return animeResults.map(i => mapItem(i, 'tv'));
  } catch (e) {
    console.error('❌ searchAnime error:', e.message);
    return [];
  }
}

module.exports = {
  discover,
  getPopular,
  getFullDetails,
  getDetails,
  getDetailsBatch,
  resolveId,
  searchTmdb,
  searchAnime,
  LANGUAGE_MAP
};
