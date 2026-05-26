const axios = require('axios');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';

async function getRecommendations(type, tmdbId) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}/recommendations`, {
      params: { api_key: TMDB_API_KEY, language: 'it-IT' }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      overview: item.overview,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

async function getSimilar(type, tmdbId) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  try {
    const res = await axios.get(`${BASE}/${mediaType}/${tmdbId}/similar`, {
      params: { api_key: TMDB_API_KEY }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

async function searchTmdb(query, type) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  try {
    const res = await axios.get(`${BASE}/search/${mediaType}`, {
      params: { api_key: TMDB_API_KEY, query, language: 'it-IT' }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.title || item.name,
      poster_path: item.poster_path,
      release_date: item.release_date || item.first_air_date,
      media_type: mediaType
    }));
  } catch(e) { return []; }
}

// Per anime: filtro genere 16 (Animation) + origine Giappone (opzionale)
async function searchAnime(query) {
  try {
    const res = await axios.get(`${BASE}/search/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        query,
        with_genres: 16,
        language: 'it-IT'
      }
    });
    return res.data.results.map(item => ({
      id: item.id,
      title: item.name,
      poster_path: item.poster_path,
      vote_average: item.vote_average,
      release_date: item.first_air_date,
      media_type: 'tv'
    }));
  } catch(e) { return []; }
}

module.exports = { getRecommendations, getSimilar, searchTmdb, searchAnime };
