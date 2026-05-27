const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Salva configurazione - UPSERT basato su email (se esiste, aggiorna)
async function saveUserConfig(uuid, data) {
  // Prima verifica se esiste già un utente con questa email
  const { data: existing } = await supabase
    .from('user_configs')
    .select('uuid')
    .eq('stremio_email', data.stremioEmail)
    .maybeSingle();
  
  // Se esiste già, usa quell'UUID (mantieni consistenza)
  const finalUuid = existing?.uuid || uuid;
  
  // UPSERT: se stremio_email esiste, aggiorna; altrimenti inserisci
  const { error } = await supabase
    .from('user_configs')
    .upsert({
      uuid: finalUuid,
      stremio_email: data.stremioEmail,
      selected_movies: data.selectedMovies,
      selected_series: data.selectedSeries,
      selected_anime: data.selectedAnime,
      language: data.language || 'en',
      preferences: data.prefs,
      updated_at: new Date()
    }, { 
      onConflict: 'stremio_email',  // <-- CHIAVE: usa email per il conflitto
      ignoreDuplicates: false        // <-- false = aggiorna invece di ignorare
    });
  
  if (error) throw error;
  return finalUuid;
}

async function getUserConfig(uuid) {
  const { data, error } = await supabase
    .from('user_configs')
    .select('*')
    .eq('uuid', uuid)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function getUserConfigByEmail(email) {
  const { data, error } = await supabase
    .from('user_configs')
    .select('*')
    .eq('stremio_email', email)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function getUserSeeds(uuid, catalogType) {
  const config = await getUserConfig(uuid);
  if (!config) return [];
  
  let seeds = [];
  if (catalogType === 'movie') seeds = config.selected_movies || [];
  else if (catalogType === 'series') seeds = config.selected_series || [];
  else if (catalogType === 'anime') seeds = config.selected_anime || [];
  
  return seeds.map(s => ({ ...s, type: catalogType }));
}

async function getUserLanguage(uuid) {
  const config = await getUserConfig(uuid);
  return config?.language || 'en';
}

async function updateUserSeeds(uuid, catalogType, seeds) {
  const config = await getUserConfig(uuid);
  if (!config) return;
  const update = {};
  if (catalogType === 'movie') update.selected_movies = seeds;
  else if (catalogType === 'series') update.selected_series = seeds;
  else if (catalogType === 'anime') update.selected_anime = seeds;
  await supabase.from('user_configs').update(update).eq('uuid', uuid);
}

async function getUserLibrary(uuid, catalogType) {
  const seeds = await getUserSeeds(uuid, catalogType);
  return seeds.map(s => ({
    id: s.tmdbId || s.id || s.imdbId || null,
    title: s.title || s.name || null,
    type: catalogType
  })).filter(s => s.id !== null);
}

module.exports = {
  saveUserConfig,
  getUserConfig,
  getUserConfigByEmail,
  getUserSeeds,
  getUserLanguage,
  updateUserSeeds,
  getUserLibrary
};
