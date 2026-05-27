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
    keyword_ids: item.keyword_ids || [],  // IMPORTANTE per matching
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  };
}

// Ottieni dettagli COMPLETI con keywords
async function getFullDetails(type, tmdbId, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';

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

    const director = mediaType === 'movie'
      ? credits?.crew?.find(c => c.job === 'Director')
      : credits?.crew?.find(c => c.job === 'Creator');

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
      recommendations: data.recommendations?.results?.map(i => mapItem(i, mediaType)) || [],
      similar: data.similar?.results?.map(i => mapItem(i, mediaType)) || []
    };
  } catch (e) {
    console.error('getFullDetails error:', e.message);
    return null;
  }
}

// Ottieni dettagli base (per candidati, più leggero)
async function getDetails(type, id, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
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

// Discover con parametri
async function discover(type, params = {}, language = 'en', maxPages = 1) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
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
          include_adult: false,
          page,
          ...params
        }
      });
      if (!res.data.results?.length) break;
      all.push(...res.data.results.map(i => mapItem(i, mediaType)));
      if (page >= res.data.total_pages) break;
    } catch (e) { break; }
  }
  return all;
}

// Popolari - SOLO FALLBACK FINALE
async function getPopular(type, language = 'en', maxPages = 1) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
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

module.exports = {
  discover,
  getPopular,
  getFullDetails,
  getDetails,
  LANGUAGE_MAP
};
