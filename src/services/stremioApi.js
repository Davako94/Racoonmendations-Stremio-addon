const axios = require('axios');

const STREMIO_API = 'https://api.strem.io';

/**
 * Effettua il login a Stremio e restituisce authKey + userId
 */
async function stremioLogin(email, password) {
  try {
    const response = await axios.post(`${STREMIO_API}/api/login`, {
      email,
      password
    });
    if (response.data && response.data.result && response.data.result.authKey) {
      return {
        authKey: response.data.result.authKey,
        userId: response.data.result.user.id
      };
    } else {
      throw new Error('Login failed: invalid response');
    }
  } catch (error) {
    console.error('Stremio login error:', error.response?.data || error.message);
    throw new Error('Stremio authentication failed');
  }
}

/**
 * Recupera la libreria completa di un utente (tutti i libraryItem)
 */
async function getStremioLibrary(authKey, userId) {
  try {
    const response = await axios.post(`${STREMIO_API}/api/datastoreGet`, {
      authKey,
      collection: 'libraryItem',
      userId
    });
    if (response.data && response.data.result) {
      return response.data.result; // array di oggetti
    }
    return [];
  } catch (error) {
    console.error('Error fetching library:', error);
    return [];
  }
}

/**
 * Calcola il continue watching a partire dalla libreria.
 * Stessa logica dell'importer: timeOffset tra 3% e 92% e non completato.
 */
function getContinueWatchingFromLibrary(libraryItems) {
  const continueWatching = [];
  for (const item of libraryItems) {
    if (!item.state || !item.state.timeOffset) continue;
    const timeOffset = item.state.timeOffset;
    const duration = item.meta?.runtime || 0;
    if (duration > 0) {
      const percent = (timeOffset / duration) * 100;
      if (percent >= 3 && percent <= 92) {
        continueWatching.push({
          id: item.meta?.id,
          type: item.meta?.type,
          title: item.meta?.name,
          timeOffset,
          duration
        });
      }
    }
  }
  return continueWatching;
}

/**
 * Estrae dalla libreria i seed: tutti i film e serie, più quelli in continue watching.
 * Restituisce un array unico di oggetti con { id, title, type, isContinueWatching }
 */
function extractSeedsFromLibrary(library, continueWatching = []) {
  const seedsMap = new Map();
  // Aggiungi tutti i film/serie dalla libreria
  for (const item of library) {
    if (!item.meta) continue;
    const type = item.meta.type; // 'movie' o 'series'
    if (type !== 'movie' && type !== 'series') continue;
    const id = item.meta.id;
    const title = item.meta.name;
    if (id && title) {
      seedsMap.set(id, { id, title, type, isContinueWatching: false });
    }
  }
  // Aggiungi/sovrascrivi con quelli in continue watching (marcati)
  for (const cw of continueWatching) {
    if (cw.id) {
      seedsMap.set(cw.id, { 
        id: cw.id, 
        title: cw.title, 
        type: cw.type, 
        isContinueWatching: true 
      });
    }
  }
  return Array.from(seedsMap.values());
}

module.exports = {
  stremioLogin,
  getStremioLibrary,
  getContinueWatchingFromLibrary,
  extractSeedsFromLibrary
};
