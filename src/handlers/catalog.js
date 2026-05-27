// src/handlers/catalog.js

const NodeCache = require('node-cache');

const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({
  stdTTL: 86400,
  checkperiod: 3600
});

async function getCatalog(catalogType, catalogId, userUuid) {

  console.log(`📺 ${catalogType}/${catalogId}`);

  if (!userUuid) {
    return [];
  }

  const cacheKey = `${catalogId}:${userUuid}`;

  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  let seedId = null;
  let recType = null;

  // ============================================================
  // PARSING SICURO
  // ============================================================

  const movieMatch =
    catalogId.match(/^sim-movie-(.+)-([a-f0-9-]+)$/);

  const seriesMatch =
    catalogId.match(/^sim-series-(.+)-([a-f0-9-]+)$/);

  if (movieMatch) {
    seedId = movieMatch[1];
    recType = 'movie';
  }

  if (seriesMatch) {
    seedId = seriesMatch[1];
    recType = 'series';
  }

  if (catalogId.startsWith('rec-movies-')) {
    recType = 'rec-movies';
  }

  if (catalogId.startsWith('rec-series-')) {
    recType = 'rec-series';
  }

  const language = await getUserLanguage(userUuid);

  let items = [];

  // ============================================================
  // SIMILAR
  // ============================================================

  if (seedId && recType) {

    const recommendations =
      await tmdb.getRecommendations(
        recType,
        seedId,
        language
      );

    const similar =
      await tmdb.getSimilar(
        recType,
        seedId,
        language
      );

    const merged = [...recommendations, ...similar];

    const unique = new Map();

    for (const item of merged) {

      if (!item.id) continue;

      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }

    items = Array.from(unique.values());

    items.sort((a, b) =>
      (b.vote_average || 0) -
      (a.vote_average || 0)
    );

    items = items.slice(0, 20);
  }

  // ============================================================
  // POPULAR FALLBACK
  // ============================================================

  if (recType === 'rec-movies') {

    items = await tmdb.getPopular(
      'movie',
      language,
      2
    );

    items = items.slice(0, 20);
  }

  if (recType === 'rec-series') {

    items = await tmdb.getPopular(
      'tv',
      language,
      2
    );

    items = items.slice(0, 20);
  }

  // ============================================================
  // EMPTY FALLBACK
  // ============================================================

  if (!items.length) {

    items = await tmdb.getPopular(
      catalogType === 'movie'
        ? 'movie'
        : 'tv',
      language,
      1
    );

    items = items.slice(0, 20);
  }

  // ============================================================
  // STREMIO METAS
  // ============================================================

  const metas = items.map(item => ({

    id: String(item.id),

    type:
      catalogType === 'movie'
        ? 'movie'
        : 'series',

    name:
      item.title ||
      item.name,

    poster:
      item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null,

    background:
      item.backdrop_path
        ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
        : null,

    description:
      item.overview || '',

    releaseInfo:
      item.release_date
        ? item.release_date.split('-')[0]
        : '',

    imdbRating:
      item.vote_average
        ? String(item.vote_average.toFixed(1))
        : '0'

  }));

  cache.set(cacheKey, metas);

  return metas;
}

function invalidateCache(userUuid) {

  const keys =
    cache
      .keys()
      .filter(k => k.includes(userUuid));

  cache.del(keys);
}

module.exports = {
  getCatalog,
  invalidateCache
};
