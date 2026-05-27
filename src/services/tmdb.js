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
      overview: item.overview,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

// NUOVA: Ottieni contenuti per genere
async function getByGenre(type, genreId, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';
  try {
    const res = await axios.get(`${BASE}/discover/${mediaType}`, {
      params: {
        api_key: TMDB_API_KEY,
        with_genres: genreId,
        language: lang,
        sort_by: 'popularity.desc',
        page: 1
      }
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
      overview: item.overview,
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
  getByGenre,  // NUOVA
  getPopular, 
  searchTmdb, 
  searchAnime, 
  LANGUAGE_MAP 
};
