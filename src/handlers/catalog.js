const NodeCache = require('node-cache');

const tmdb = require('../services/tmdb');
const { getUserLanguage } = require('../services/userStore');

const cache = new NodeCache({
  stdTTL: 86400,
  checkperiod: 3600
});

// ============================================================
// SCORE
// ============================================================

function scoreCandidate(seed, candidate) {

  let score = 0;

  // ========================================================
  // GENRES
  // ========================================================

  const seedGenres =
    new Set(
      (seed.genres || [])
        .map(g => g.id)
    );

  for (const gid of candidate.genre_ids || []) {
    if (seedGenres.has(gid)) {
      score += 10;
    }
  }

  // ========================================================
  // KEYWORDS
  // ========================================================

  const seedKeywords =
    new Set(seed.keywordIds || []);

  for (const kid of candidate.keywordIds || []) {
    if (seedKeywords.has(kid)) {
      score += 25;
    }
  }

  // ========================================================
  // COMPANIES
  // ========================================================

  const seedCompanies =
    new Set(seed.companyIds || []);

  for (const cid of candidate.companyIds || []) {
    if (seedCompanies.has(cid)) {
      score += 8;
    }
  }

  // ========================================================
  // NETWORKS
  // ========================================================

  const seedNetworks =
    new Set(seed.networkIds || []);

  for (const nid of candidate.networkIds || []) {
    if (seedNetworks.has(nid)) {
      score += 8;
    }
  }

  // ========================================================
  // CREATORS
  // ========================================================

  const seedCreators =
    new Set(seed.creatorIds || []);

  for (const cid of candidate.creatorIds || []) {
    if (seedCreators.has(cid)) {
      score += 35;
    }
  }

  // ========================================================
  // RATING
  // ========================================================

  score += (candidate.vote_average || 0);

  // ========================================================
  // POPULARITY
  // ========================================================

  score += Math.min(
    (candidate.popularity || 0) / 100,
    10
  );

  return score;
}

// ============================================================
// CATALOG
// ============================================================

async function getCatalog(
  catalogType,
  catalogId,
  userUuid
) {

  console.log(
    `📺 ${catalogType}/${catalogId}`
  );

  if (!userUuid) {
    return [];
  }

  const cacheKey =
    `${catalogId}:${userUuid}`;

  const cached =
    cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const language =
    await getUserLanguage(userUuid);

  let seedId = null;
  let recType = null;

  // ============================================================
  // PARSE
  // ============================================================

  const movieMatch =
    catalogId.match(
      /^sim-movie-(.+)-([a-f0-9-]+)$/
    );

  const seriesMatch =
    catalogId.match(
      /^sim-series-(.+)-([a-f0-9-]+)$/
    );

  if (movieMatch) {
    seedId = movieMatch[1];
    recType = 'movie';
  }

  if (seriesMatch) {
    seedId = seriesMatch[1];
    recType = 'series';
  }

  // ============================================================
  // PERSONALIZED
  // ============================================================

  let items = [];

  if (seedId && recType) {

    // ========================================================
    // SEED DETAILS
    // ========================================================

    const seed =
      await tmdb.getFullDetails(
        recType,
        seedId,
        language
      );

    if (!seed) {
      return [];
    }

    console.log(
      `🎯 Seed: ${seed.title}`
    );

    // ========================================================
    // DISCOVER CANDIDATES
    // ========================================================

    const discoverParams = {

      with_genres:
        seed.genres
          ?.slice(0, 3)
          .map(g => g.id)
          .join(','),

      with_keywords:
        seed.keywordIds
          ?.slice(0, 5)
          .join('|'),

      sort_by: 'popularity.desc',

      include_adult: false
    };

    let candidates =
      await tmdb.discover(
        recType,
        discoverParams,
        language,
        3
      );

    // ========================================================
    // ADD TMDB RECOMMENDATIONS
    // ========================================================

    const tmdbRecs =
      await tmdb.getRecommendations(
        recType,
        seedId,
        language
      );

    const tmdbSimilar =
      await tmdb.getSimilar(
        recType,
        seedId,
        language
      );

    candidates.push(...tmdbRecs);
    candidates.push(...tmdbSimilar);

    // ========================================================
    // REMOVE DUPLICATES
    // ========================================================

    const unique = new Map();

    for (const item of candidates) {

      if (!item.id) continue;

      if (
        String(item.id) === String(seed.id)
      ) {
        continue;
      }

      if (!unique.has(item.id)) {
        unique.set(item.id, item);
      }
    }

    candidates =
      Array.from(unique.values());

    // ========================================================
    // ENRICH CANDIDATES
    // ========================================================

    const detailed =
      await tmdb.getDetailsBatch(
        recType,
        candidates.map(c => c.id),
        language,
        10
      );

    // ========================================================
    // SCORE
    // ========================================================

    const scored = [];

    for (const candidate of detailed) {

      if (!candidate) continue;

      const score =
        scoreCandidate(
          seed,
          candidate
        );

      scored.push({
        ...candidate,
        score
      });
    }

    // ========================================================
    // SORT
    // ========================================================

    scored.sort(
      (a, b) => b.score - a.score
    );

    items = scored.slice(0, 30);

    console.log(
      `✅ ${items.length} scored recommendations`
    );
  }

  // ============================================================
  // FALLBACK
  // ============================================================

  if (!items.length) {

    items =
      await tmdb.getPopular(
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
        ? String(
            item.vote_average.toFixed(1)
          )
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

  console.log(
    `🗑️ Invalidated ${keys.length} cache entries`
  );
}

module.exports = {
  getCatalog,
  invalidateCache
};
