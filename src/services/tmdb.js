const axios = require('axios');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';

const LANGUAGE_MAP = {
  'en': 'en-US',
  'it': 'it-IT',
  'de': 'de-DE',
  'es': 'es-ES',
  'fr': 'fr-FR'
};

// Ottieni dettagli COMPLETI con keywords, credits, recommendations, similar
async function getFullDetails(type, id, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const [details, keywords, credits, recommendations, similar] = await Promise.all([
      axios.get(`${BASE}/${mediaType}/${id}`, { params: { api_key: TMDB_API_KEY, language: lang } }),
      axios.get(`${BASE}/${mediaType}/${id}/keywords`, { params: { api_key: TMDB_API_KEY } }),
      axios.get(`${BASE}/${mediaType}/${id}/credits`, { params: { api_key: TMDB_API_KEY } }),
      axios.get(`${BASE}/${mediaType}/${id}/recommendations`, { params: { api_key: TMDB_API_KEY, language: lang } }),
      axios.get(`${BASE}/${mediaType}/${id}/similar`, { params: { api_key: TMDB_API_KEY, language: lang } })
    ]);
    
    // Estrai keywords correttamente (movie ha 'keywords', tv ha 'results')
    let keywordList = [];
    if (keywords.data.keywords) keywordList = keywords.data.keywords;
    if (keywords.data.results) keywordList = keywords.data.results;
    
    return {
      id: details.data.id,
      title: details.data.title || details.data.name,
      genres: details.data.genres || [],
      keywords: keywordList.map(k => ({ id: k.id, name: k.name.toLowerCase() })),
      cast: (credits.data.cast || []).slice(0, 10).map(c => ({ id: c.id, name: c.name.toLowerCase() })),
      director: (credits.data.crew || []).filter(c => c.job === 'Director').map(c => ({ id: c.id, name: c.name.toLowerCase() })),
      production_companies: (details.data.production_companies || []).map(c => ({ id: c.id, name: c.name.toLowerCase() })),
      networks: (details.data.networks || []).map(n => ({ id: n.id, name: n.name.toLowerCase() })),
      creators: (details.data.created_by || []).map(c => ({ id: c.id, name: c.name.toLowerCase() })),
      vote_average: details.data.vote_average || 0,
      release_date: details.data.release_date || details.data.first_air_date,
      recommendations: recommendations.data.results || [],
      similar: similar.data.results || []
    };
  } catch(e) {
    console.error(`Error fetching details for ${id}:`, e.message);
    return null;
  }
}

// Discover con parametri avanzati
async function discover(type, params = {}, language = 'en', maxPages = 2) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let allResults = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/discover/${mediaType}`, {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          sort_by: 'popularity.desc',
          page,
          ...params
        }
      });
      if (res.data.results && res.data.results.length) {
        allResults.push(...res.data.results);
      } else {
        break;
      }
      if (page >= res.data.total_pages) break;
    } catch(e) { break; }
  }
  
  return allResults.map(item => ({
    id: item.id,
    title: item.title || item.name,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    overview: item.overview,
    vote_average: item.vote_average,
    release_date: item.release_date || item.first_air_date
  }));
}

// Ottieni dettagli base (senza extra)
async function getDetails(type, id, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${id}`, {
      params: { api_key: TMDB_API_KEY, language: lang }
    });
    return {
      id: res.data.id,
      title: res.data.title || res.data.name,
      genres: res.data.genres || [],
      vote_average: res.data.vote_average || 0,
      release_date: res.data.release_date || res.data.first_air_date
    };
  } catch(e) { return null; }
}

// Ottieni popolari (SOLO come fallback finale)
async function getPopular(type, language = 'en', maxPages = 1) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let allResults = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/${mediaType}/popular`, {
        params: { api_key: TMDB_API_KEY, language: lang, page }
      });
      if (res.data.results && res.data.results.length) {
        allResults.push(...res.data.results);
      }
    } catch(e) { break; }
  }
  
  return allResults.map(item => ({
    id: item.id,
    title: item.title || item.name,
    poster_path: item.poster_path,
    vote_average: item.vote_average,
    release_date: item.release_date || item.first_air_date
  }));
}

module.exports = { 
  getFullDetails,
  discover,
  getDetails,
  getPopular,
  LANGUAGE_MAP
};
