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
    release_date: item.release_date || item.first_air_date,
    media_type: mediaType
  };
}

async function getFullDetails(type, tmdbId, language = 'en') {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';

  try {
    const append =
      mediaType === 'movie'
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

    const keywords =
      mediaType === 'movie'
        ? data.keywords?.keywords || []
        : data.keywords?.results || [];

    const credits =
      mediaType === 'movie'
        ? data.credits
        : data.aggregate_credits;

    const director =
      mediaType === 'movie'
        ? credits?.crew?.find(c => c.job === 'Director')
        : credits?.crew?.find(c => c.job === 'Creator');

    return {
      id: data.id,
      title: data.title || data.name,

      genres: data.genres || [],

      keywords,

      companies: data.production_companies || [],

      networks: data.networks || [],

      cast: (credits?.cast || []).slice(0, 10),

      director,

      recommendations:
        data.recommendations?.results?.map(i =>
          mapItem(i, mediaType)
        ) || [],

      similar:
        data.similar?.results?.map(i =>
          mapItem(i, mediaType)
        ) || []
    };
  } catch (e) {
    console.error('getFullDetails error:', e.message);
    return null;
  }
}

async function discover(type, params = {}, language = 'en', maxPages = 2) {
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

      all.push(
        ...res.data.results.map(i =>
          mapItem(i, mediaType)
        )
      );

      if (page >= res.data.total_pages) break;
    } catch (e) {
      break;
    }
  }

  return all;
}

async function getPopular(type, language = 'en', maxPages = 1) {
  const mediaType = type === 'movie' ? 'movie' : 'tv';
  const lang = LANGUAGE_MAP[language] || 'en-US';

  let all = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(`${BASE}/${mediaType}/popular`, {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          page
        }
      });

      all.push(
        ...res.data.results.map(i =>
          mapItem(i, mediaType)
        )
      );
    } catch (e) {
      break;
    }
  }

  return all;
}

module.exports = {
  discover,
  getPopular,
  getFullDetails,
  LANGUAGE_MAP
};
