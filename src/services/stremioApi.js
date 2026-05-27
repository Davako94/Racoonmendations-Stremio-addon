const axios = require('axios');

const STREMIO_API = 'https://api.strem.io';
const STREMIO_UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Stremio/4.4.159';

/**
 * Effettua il login a Stremio e restituisce authKey
 */
async function stremioLogin(email, password) {
  const response = await axios.post(`${STREMIO_API}/api/login`, {
    email,
    password,
    facebook: false,
    type: 'login'
  }, {
    headers: { 'User-Agent': STREMIO_UA }
  });
  
  const authKey = response.data?.result?.authKey;
  if (!authKey) {
    throw new Error('authKey non trovato nella risposta');
  }
  return { token: authKey };
}

/**
 * Recupera la libreria completa di Stremio
 */
async function getStremioLibraryRaw(authKey) {
  const response = await axios.post(`${STREMIO_API}/api/datastoreGet`, {
    authKey,
    collection: 'libraryItem',
    all: true
  }, {
    headers: { 'User-Agent': STREMIO_UA }
  });
  
  let items = [];
  const data = response.data;
  
  if (Array.isArray(data)) {
    items = data;
  } else if (data.result) {
    if (Array.isArray(data.result)) {
      items = data.result;
    } else if (Array.isArray(data.result.rows)) {
      items = data.result.rows.map(r => r.value).filter(Boolean);
    } else if (data.result.value) {
      items = [data.result.value];
    }
  } else if (Array.isArray(data.items)) {
    items = data.items;
  }
  
  // Filtra solo movie e series validi
  return items.filter(i => 
    i && (i._id || i.id) && 
    ['movie', 'series', 'show'].includes(i.type || '')
  );
}

/**
 * Normalizza un item della libreria
 */
function normalizeItem(raw) {
  const id = String(raw._id || raw.id || '').trim();
  const state = raw.state || {};
  
  return {
    id,
    type: String(raw.type || '').toLowerCase(),
    name: String(raw.name || '').trim(),
    poster: raw.poster || null,
    posterShape: String(raw.posterShape || 'POSTER').toUpperCase(),
    background: raw.background || null,
    year: raw.year || null,
    removed: Boolean(raw.removed),
    temp: Boolean(raw.temp),
    state: {
      timeOffset: Number(state.timeOffset ?? state.time_offset ?? 0),
      duration: Number(state.duration ?? 0),
      lastWatched: state.lastWatched ?? state.last_watched ?? null,
      videoId: state.video_id ?? state.videoId ?? null,
      timesWatched: Number(state.timesWatched ?? state.times_watched ?? 0),
      flaggedWatched: Number(state.flaggedWatched ?? state.flagged_watched ?? 0),
      watchedBool: state.watched === true || state.watched === 1,
      watchedField: (typeof state.watched === 'string' && state.watched.includes(':')) ? state.watched : null,
    }
  };
}

/**
 * Estrae l'ID content (es. tt1234567)
 */
function extractContentId(value) {
  const t = String(value ?? '').trim();
  if (!t) return '';
  
  // Match IMDb ID
  const m = t.match(/tt\d+/i);
  if (m) return m[0].toLowerCase();
  
  // Match TMDB
  const m2 = t.match(/(?:^|:)tmdb:(\d+)(?::|$)/i);
  if (m2 && m2[1]) return `tmdb:${m2[1]}`;
  
  return '';
}

/**
 * Calcola il continue watching dalla libreria
 * Stessa logica: timeOffset tra 3% e 92% e non completato
 */
function getContinueWatchingFromLibrary(rawItems) {
  const normalized = rawItems.map(normalizeItem).filter(i => !i.removed && !i.temp);
  const continueWatching = [];
  
  for (const item of normalized) {
    const { timeOffset, duration, videoId } = item.state;
    if (timeOffset <= 0 || duration <= 0) continue;
    
    const percent = (timeOffset / duration) * 100;
    if (percent >= 3 && percent <= 92) {
      continueWatching.push({
        id: item.id,
        content_id: extractContentId(item.id),
        type: item.type === 'series' || item.type === 'show' ? 'series' : 'movie',
        title: item.name,
        timeOffset,
        duration,
        percent: Math.round(percent),
        videoId
      });
    }
  }
  
  return continueWatching;
}

/**
 * Estrae i seed dalla libreria: tutti i film e serie, più quelli in continue watching
 */
function extractSeedsFromLibrary(rawItems, continueWatching = []) {
  const normalized = rawItems.map(normalizeItem).filter(i => !i.removed && !i.temp);
  const seedsMap = new Map();
  
  // Aggiungi tutti i film/serie dalla libreria
  for (const item of normalized) {
    const type = item.type === 'series' || item.type === 'show' ? 'series' : 'movie';
    if (type !== 'movie' && type !== 'series') continue;
    
    const contentId = extractContentId(item.id);
    if (!contentId) continue;
    
    seedsMap.set(contentId, {
      id: contentId,
      title: item.name,
      type: type,
      poster: item.poster,
      isContinueWatching: false
    });
  }
  
  // Aggiungi/sovrascrivi con quelli in continue watching
  for (const cw of continueWatching) {
    if (cw.content_id) {
      seedsMap.set(cw.content_id, {
        id: cw.content_id,
        title: cw.title,
        type: cw.type,
        poster: cw.poster,
        isContinueWatching: true,
        progressPercent: cw.percent
      });
    }
  }
  
  return Array.from(seedsMap.values());
}

/**
 * Ottiene la libreria completa + continue watching in un unico step
 */
async function getFullLibrary(email, password) {
  const auth = await stremioLogin(email, password);
  const rawLibrary = await getStremioLibraryRaw(auth.token);
  const continueWatching = getContinueWatchingFromLibrary(rawLibrary);
  const seeds = extractSeedsFromLibrary(rawLibrary, continueWatching);
  
  return {
    success: true,
    library: rawLibrary.filter(i => !i.removed && !i.temp),
    continueWatching,
    seeds,
    stats: {
      total: rawLibrary.filter(i => !i.removed && !i.temp).length,
      movies: rawLibrary.filter(i => !i.removed && !i.temp && i.type === 'movie').length,
      series: rawLibrary.filter(i => !i.removed && !i.temp && (i.type === 'series' || i.type === 'show')).length,
      continueWatching: continueWatching.length
    }
  };
}

module.exports = {
  stremioLogin,
  getStremioLibraryRaw,
  normalizeItem,
  extractContentId,
  getContinueWatchingFromLibrary,
  extractSeedsFromLibrary,
  getFullLibrary
};
