const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function saveUserConfig(uuid, data) {
  const { error } = await supabase.from('user_configs').upsert({
    uuid,
    stremio_email: data.stremioEmail,
    selected_movies: data.selectedMovies,
    selected_series: data.selectedSeries,
    selected_anime: data.selectedAnime,
    language: data.language || 'en',
    preferences: data.prefs,
    created_at: new Date(),
    updated_at: new Date()
  });
  if (error) throw error;
}

async function getUserConfig(uuid) {
  const { data, error } = await supabase
    .from('user_configs')
    .select('*')
    .eq('uuid', uuid)
    .single();
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

module.exports = { saveUserConfig, getUserConfig, getUserSeeds, getUserLanguage, updateUserSeeds };
