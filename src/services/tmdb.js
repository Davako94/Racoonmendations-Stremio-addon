const axios = require('axios');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';

// Mappa delle lingue supportate
const LANGUAGE_MAP = {
  'en': 'en-US',
  'it': 'it-IT',
  'de': 'de-DE',
  'es': 'es-ES',
  'fr': 'fr-FR'
};

async function getRecommendations(type, tmdbId, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}/recommendations`, {
      params: { api_key: TMDB_API_KEY, language: lang }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

async function getSimilar(type, tmdbId, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}/similar`, {
      params: { api_key: TMDB_API_KEY, language: lang }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

async function getPopular(type, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/popular`, {
      params: { api_key: TMDB_API_KEY, language: lang }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
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
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

module.exports = { getRecommendations, getSimilar, getPopular, searchTmdb, LANGUAGE_MAP };
