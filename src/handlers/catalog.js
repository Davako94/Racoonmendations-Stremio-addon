const NodeCache = require('node-cache');

const tmdb = require('../services/tmdb');

const {
  getUserConfig,
  getUserLanguage
} = require('../services/userStore');

const cache = new NodeCache({
  stdTTL: 172800,
  checkperiod: 3600
});

function overlap(a = [], b = []) {
  const setB = new Set(b);
  return a.filter(x => setB.has(x)).length;
}

function scoreItem(seed, item, metadata) {
  let score = 0;

  const itemGenres = item.genre_ids || [];

  const seedGenres = metadata.genres.map(g => g.id);

  const genreOverlap = overlap(seedGenres, itemGenres);

  score += genreOverlap * 15;

  if (metadata.recommendationIds.has(item.id)) {
    score += 60;
  }

  if (metadata.similarIds.has(item.id)) {
    score += 50;
  }

  if (metadata.companyIds.length) {
    const companyOverlap = overlap(
      metadata.companyIds,
      item.production_company_ids || []
    );

    score += companyOverlap * 40;
  }

  if (item.vote_average >= 7) {
    score += 10;
  }

  score += Math.min(item.popularity || 0, 30);

  return score;
}

async function buildCandidates(mediaType, seed, language) {
  const metadata = await tmdb.getFullDetails(
    mediaType,
    seed,
    language
  );

  if (!metadata) return [];

  const keywordIds = metadata.keywords
    .slice(0, 5)
    .map(k => k.id);

  const genreIds = metadata.genres.map(g => g.id);

  const companyIds = metadata.companies.map(c => c.id);

  let candidates = [];

  candidates.push(...metadata.recommendations);

  candidates.push(...metadata.similar);

  if (genreIds.length) {
    const genreDiscover = await tmdb.discover(
      mediaType,
      {
        with_genres: genreIds.join(','),
        vote_average_gte: 6.5
      },
      language,
      2
    );

    candidates.push(...genreDiscover);
  }

  if (keywordIds.length) {
    const keywordDiscover = await tmdb.discover(
      mediaType,
      {
        with_keywords: keywordIds.join(','),
        vote_average_gte: 6.5
      },
      language,
      2
    );

    candidates.push(...keywordDiscover);
  }

  if (companyIds.length) {
    const companyDiscover = await tmdb.discover(
      mediaType,
      {
        with_companies: companyIds.join('|')
      },
      language,
      1
    );

    candidates.push(...companyDiscover);
  }

  const unique = new Map();

  for (const item of candidates) {
    if (!item.id || item.id === seed) continue;

    if (!unique.has(item.id)) {
      unique.set(item.id, item);
    }
  }

  const recommendationIds = new Set(
    metadata.recommendations.map(r => r.id)
  );

  const similarIds = new Set(
    metadata.similar.map(r => r.id)
  );

  const scored = Array.from(unique.values())
    .map(item => ({
      item,
      score: scoreItem(seed, item, {
        genres: metadata.genres,
        companyIds,
        recommendationIds,
        similarIds
      })
    }))
    .sort((a, b) => b.score - a.score);

  return scored.map(s => s.item);
}

async function getCatalog(catalogType, catalogId) {
  console.log(
    `📺 getCatalog: ${catalogType} / ${catalogId}`
  );

  const parts = catalogId.split('-');

  const prefix = parts[0];

  const mediaType = parts[1];

  let seedId = null;
  let userUuid = null;

  if (prefix === 'sim') {
    seedId = parts[2];
    userUuid = parts.slice(3).join('-');
  }

  if (!userUuid) return [];

  const cacheKey = `${catalogId}:${userUuid}`;

  const cached = cache.get(cacheKey);

  if (cached) return cached;

  const language = await getUserLanguage(userUuid);

  let metas = [];

  if (prefix === 'sim' && seedId) {
    const items = await buildCandidates(
      mediaType,
      seedId,
      language
    );

    metas = items.slice(0, 50).map(item => ({
      id: `sim_${seedId}_${item.id}`,

      type: mediaType,

      name: item.title,

      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,

      description: item.overview || '',

      releaseInfo: item.release_date
        ? item.release_date.split('-')[0]
        : '',

      extra: {}
    }));
  }

  if (!metas.length) {
    const popular = await tmdb.getPopular(
      mediaType,
      language,
      1
    );

    metas = popular.slice(0, 30).map(item => ({
      id: `pop_${item.id}`,
      type: mediaType,
      name: item.title,
      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
        : null,
      description: item.overview || '',
      releaseInfo: item.release_date
        ? item.release_date.split('-')[0]
        : '',
      extra: {}
    }));
  }

  cache.set(cacheKey, metas);

  return metas;
}

function invalidateCache(userUuid) {
  const keys = cache
    .keys()
    .filter(k => k.includes(userUuid));

  cache.del(keys);
}

module.exports = {
  getCatalog,
  invalidateCache
};
