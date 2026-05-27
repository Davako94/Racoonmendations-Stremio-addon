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

// Ottieni più pagine di recommendations (fino a 3 pagine = 60 risultati)
async function getRecommendations(type, tmdbId, language = 'en', maxPages = 3) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let allResults = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}/recommendations`, {
        params: { api_key: TMDB_API_KEY, language: lang, page }
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
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  }));
}

// Ottieni più pagine di similar
async function getSimilar(type, tmdbId, language = 'en', maxPages = 3) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let allResults = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}/similar`, {
        params: { api_key: TMDB_API_KEY, language: lang, page }
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
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  }));
}

// DISCOVER: per trovare contenuti VARI e NON RIPETITIVI
async function discover(type, params = {}, language = 'en', maxPages = 3) {
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
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  }));
}

// Ottieni dettagli di un film/serie (per avere i generi)
async function getDetails(type, tmdbId, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}`, {
      params: { api_key: TMDB_API_KEY, language: lang }
    });
    return {
      id: res.data.id,
      title: res.data.title || res.data.name,
      genres: res.data.genres || [],
      release_date: res.data.release_date || res.data.first_air_date,
      vote_average: res.data.vote_average
    };
  } catch(e) { return null; }
}

// Ottieni popolari con paginazione
async function getPopular(type, language = 'en', maxPages = 2) {
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
      } else {
        break;
      }
    } catch(e) { break; }
  }
  
  return allResults.map(item => ({
    id: item.id,
    title: item.title || item.name,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    overview: item.overview,
    vote_average: item.vote_average,
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  }));
}

// Cerca per parola chiave (keyword)
async function searchByKeyword(type, keyword, language = 'en', maxPages = 2) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  let allResults = [];
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/search/${mediaType}`, {
        params: { api_key: TMDB_API_KEY, query: keyword, language: lang, page }
      });
      if (res.data.results && res.data.results.length) {
        allResults.push(...res.data.results);
      } else {
        break;
      }
    } catch(e) { break; }
  }
  
  return allResults.map(item => ({
    id: item.id,
    title: item.title || item.name,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    overview: item.overview,
    vote_average: item.vote_average,
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  }));
}

// Lista generi TMDB
async function getGenres(type, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/genre/${mediaType}/list`, {
      params: { api_key: TMDB_API_KEY, language: lang }
    });
    return res.data.genres || [];
  } catch(e) { return []; }
}

async function searchTmdb(query, type, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/search/${mediaType}`, {
      params: { api_key: TMDB_API_KEY, query, language: lang }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

async function searchAnime(query, language = 'en') {
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/search/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        query,
        with_genres: 16,
        language: lang
      }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.name,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      release_date: item.first_air_date,
      media_type: 'tv'
    }));
  } catch(e) { return []; }
}

module.exports = { 
  getRecommendations,
  getSimilar,
  discover,
  getDetails,
  getPopular,
  searchByKeyword,
  getGenres,
  searchTmdb,
  searchAnime,
  LANGUAGE_MAP
};
