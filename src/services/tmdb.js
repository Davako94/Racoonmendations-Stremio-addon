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

// ============================================================
// HELPERS
// ============================================================

function mapItem(item, mediaType) {
  return {
    id: String(item.id),

    title:
      item.title ||
      item.name,

    poster_path:
      item.poster_path || null,

    backdrop_path:
      item.backdrop_path || null,

    overview:
      item.overview || '',

    vote_average:
      item.vote_average || 0,

    popularity:
      item.popularity || 0,

    genre_ids:
      item.genre_ids || [],

    release_date:
      item.release_date ||
      item.first_air_date ||
      '',

    media_type: mediaType
  };
}

// ============================================================
// IMDB -> TMDB
// ============================================================

async function imdbToTmdb(imdbId, mediaType) {

  try {

    const res = await axios.get(
      `${BASE}/find/${imdbId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
          external_source: 'imdb_id'
        }
      }
    );

    const results =
      mediaType === 'movie'
        ? res.data.movie_results
        : res.data.tv_results;

    return results?.[0]?.id || null;

  } catch (e) {

    console.error(
      'imdbToTmdb error:',
      e.message
    );

    return null;
  }
}

// ============================================================
// RESOLVE ID
// ============================================================

async function resolveId(rawId, mediaType) {

  if (!rawId) {
    return null;
  }

  const str = String(rawId);

  // IMDB
  if (str.startsWith('tt')) {

    console.log(`🔄 IMDB→TMDB: ${str}`);

    return await imdbToTmdb(
      str,
      mediaType
    );
  }

  // TMDB
  const num = parseInt(str, 10);

  return isNaN(num)
    ? null
    : num;
}

// ============================================================
// FULL DETAILS
// ============================================================

async function getFullDetails(
  type,
  rawId,
  language = 'en'
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  const tmdbId =
    await resolveId(
      rawId,
      mediaType
    );

  if (!tmdbId) {

    console.error(
      `getFullDetails: cannot resolve ID ${rawId}`
    );

    return null;
  }

  try {

    const append =
      mediaType === 'movie'
        ? 'keywords,credits,recommendations,similar'
        : 'keywords,aggregate_credits,recommendations,similar';

    const res = await axios.get(
      `${BASE}/${mediaType}/${tmdbId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          append_to_response: append
        }
      }
    );

    const data = res.data;

    const keywords =
      mediaType === 'movie'
        ? (data.keywords?.keywords || [])
        : (data.keywords?.results || []);

    const credits =
      mediaType === 'movie'
        ? data.credits
        : data.aggregate_credits;

    const director =
      mediaType === 'movie'
        ? credits?.crew?.find(
            c => c.job === 'Director'
          )
        : credits?.crew?.find(
            c => c.job === 'Creator'
          );

    return {

      id: String(data.id),

      title:
        data.title ||
        data.name,

      overview:
        data.overview || '',

      poster_path:
        data.poster_path || null,

      backdrop_path:
        data.backdrop_path || null,

      genres:
        data.genres || [],

      keywords:
        keywords.map(k => ({
          id: k.id,
          name: k.name.toLowerCase()
        })),

      keywordIds:
        keywords.map(k => k.id),

      companies:
        data.production_companies || [],

      companyIds:
        (data.production_companies || [])
          .map(c => c.id),

      networks:
        data.networks || [],

      networkIds:
        (data.networks || [])
          .map(n => n.id),

      creators:
        data.created_by || [],

      creatorIds:
        (data.created_by || [])
          .map(c => c.id),

      cast:
        (credits?.cast || [])
          .slice(0, 10),

      director,

      vote_average:
        data.vote_average || 0,

      recommendations:
        data.recommendations?.results
          ?.map(i => mapItem(i, mediaType))
          || [],

      similar:
        data.similar?.results
          ?.map(i => mapItem(i, mediaType))
          || []
    };

  } catch (e) {

    console.error(
      'getFullDetails error:',
      e.message
    );

    return null;
  }
}

// ============================================================
// BASIC DETAILS
// ============================================================

async function getDetails(
  type,
  id,
  language = 'en'
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  try {

    const resolvedId =
      await resolveId(
        id,
        mediaType
      );

    if (!resolvedId) {
      return null;
    }

    const res = await axios.get(
      `${BASE}/${mediaType}/${resolvedId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          append_to_response: 'keywords'
        }
      }
    );

    const data = res.data;

    const keywords =
      mediaType === 'movie'
        ? (data.keywords?.keywords || [])
        : (data.keywords?.results || []);

    return {

      id: String(data.id),

      title:
        data.title ||
        data.name,

      overview:
        data.overview || '',

      poster_path:
        data.poster_path || null,

      backdrop_path:
        data.backdrop_path || null,

      genres:
        data.genres || [],

      keywordIds:
        keywords.map(k => k.id),

      companyIds:
        (data.production_companies || [])
          .map(c => c.id),

      networkIds:
        (data.networks || [])
          .map(n => n.id),

      creatorIds:
        (data.created_by || [])
          .map(c => c.id),

      vote_average:
        data.vote_average || 0
    };

  } catch (e) {

    console.error(
      'getDetails error:',
      e.message
    );

    return null;
  }
}

// ============================================================
// META FOR STREMIO
// ============================================================

async function getMeta(
  type,
  id,
  language = 'en'
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  try {

    const resolvedId =
      await resolveId(
        id,
        mediaType
      );

    if (!resolvedId) {
      return null;
    }

    const res = await axios.get(
      `${BASE}/${mediaType}/${resolvedId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
          language: lang
        }
      }
    );

    const data = res.data;

    return {

      id: String(data.id),

      type:
        mediaType === 'movie'
          ? 'movie'
          : 'series',

      name:
        data.title ||
        data.name,

      poster:
        data.poster_path
          ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
          : null,

      background:
        data.backdrop_path
          ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
          : null,

      description:
        data.overview || '',

      releaseInfo:
        data.release_date ||
        data.first_air_date ||
        '',

      imdbRating:
        data.vote_average
          ? String(
              data.vote_average.toFixed(1)
            )
          : '0'
    };

  } catch (e) {

    console.error(
      'getMeta error:',
      e.message
    );

    return null;
  }
}

// ============================================================
// BATCH DETAILS
// ============================================================

async function getDetailsBatch(
  type,
  ids,
  language = 'en',
  concurrency = 8
) {

  const results = [];

  for (
    let i = 0;
    i < ids.length;
    i += concurrency
  ) {

    const chunk =
      ids.slice(
        i,
        i + concurrency
      );

    const settled =
      await Promise.allSettled(
        chunk.map(id =>
          getDetails(
            type,
            id,
            language
          )
        )
      );

    for (const r of settled) {

      results.push(
        r.status === 'fulfilled'
          ? r.value
          : null
      );
    }
  }

  return results;
}

// ============================================================
// DISCOVER
// ============================================================

async function discover(
  type,
  params = {},
  language = 'en',
  maxPages = 1
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  let all = [];

  for (
    let page = 1;
    page <= maxPages;
    page++
  ) {

    try {

      const res = await axios.get(
        `${BASE}/discover/${mediaType}`,
        {
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
        }
      );

      if (!res.data.results?.length) {
        break;
      }

      all.push(
        ...res.data.results.map(i =>
          mapItem(i, mediaType)
        )
      );

      if (page >= res.data.total_pages) {
        break;
      }

    } catch (e) {

      console.error(
        'discover error:',
        e.message
      );

      break;
    }
  }

  return all;
}

// ============================================================
// POPULAR
// ============================================================

async function getPopular(
  type,
  language = 'en',
  maxPages = 1
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  let all = [];

  for (
    let page = 1;
    page <= maxPages;
    page++
  ) {

    try {

      const res = await axios.get(
        `${BASE}/${mediaType}/popular`,
        {
          params: {
            api_key: TMDB_API_KEY,
            language: lang,
            page
          }
        }
      );

      all.push(
        ...res.data.results.map(i =>
          mapItem(i, mediaType)
        )
      );

    } catch (e) {

      console.error(
        'getPopular error:',
        e.message
      );

      break;
    }
  }

  return all;
}

// ============================================================
// RECOMMENDATIONS
// ============================================================

async function getRecommendations(
  type,
  rawId,
  language = 'en'
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  try {

    const resolvedId =
      await resolveId(
        rawId,
        mediaType
      );

    if (!resolvedId) {
      return [];
    }

    const res = await axios.get(
      `${BASE}/${mediaType}/${resolvedId}/recommendations`,
      {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          page: 1
        }
      }
    );

    return (
      res.data.results?.map(i =>
        mapItem(i, mediaType)
      ) || []
    );

  } catch (e) {

    console.error(
      'getRecommendations error:',
      e.message
    );

    return [];
  }
}

// ============================================================
// SIMILAR
// ============================================================

async function getSimilar(
  type,
  rawId,
  language = 'en'
) {

  const mediaType =
    type === 'movie'
      ? 'movie'
      : 'tv';

  const lang =
    LANGUAGE_MAP[language] ||
    'en-US';

  try {

    const resolvedId =
      await resolveId(
        rawId,
        mediaType
      );

    if (!resolvedId) {
      return [];
    }

    const res = await axios.get(
      `${BASE}/${mediaType}/${resolvedId}/similar`,
      {
        params: {
          api_key: TMDB_API_KEY,
          language: lang,
          page: 1
        }
      }
    );

    return (
      res.data.results?.map(i =>
        mapItem(i, mediaType)
      ) || []
    );

  } catch (e) {

    console.error(
      'getSimilar error:',
      e.message
    );

    return [];
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  discover,

  getPopular,

  getRecommendations,

  getSimilar,

  getFullDetails,

  getDetails,

  getDetailsBatch,

  resolveId,

  LANGUAGE_MAP,

  getMeta
};
