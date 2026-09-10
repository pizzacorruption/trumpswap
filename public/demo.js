'use strict';
const byId = id => document.getElementById(id);
let samples = [];
let photos = [];
let client = null;
let activeSample = null;
let selectedScene = null;
let entered = false;

function showError(message) {
  byId('error').textContent = message;
  byId('error').classList.toggle('visible', Boolean(message));
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.');
  return data;
}

function renderAuth(session) {
  const user = session?.user;
  byId('googleSignInBtn').hidden = Boolean(user);
  byId('userProfile').hidden = !user;
  byId('userName').textContent = user?.user_metadata?.full_name || 'SIGNED IN';
  byId('authOverlay').classList.toggle('hidden', Boolean(user) || entered);
}

async function signIn() {
  if (!client) {
    byId('authError').textContent = 'Sign-in is unavailable. You can still continue without an account.';
    byId('authOverlay').classList.remove('hidden');
    return;
  }
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch {
    byId('authError').textContent = 'Sign-in could not start. Please try again, or continue without an account.';
  }
}

byId('googleSignInBtn').addEventListener('click', signIn);
byId('overlayGoogleBtn').addEventListener('click', signIn);
byId('overlayContinueBtn').addEventListener('click', () => {
  entered = true;
  byId('authOverlay').classList.add('hidden');
});
byId('logoutBtn').addEventListener('click', async () => {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    entered = false;
    renderAuth(null);
  } catch { showError('Could not sign out. Please try again.'); }
});

function selectScene(scene, sampleId) {
  selectedScene = scene;
  const choices = samples.filter(sample => sample.scene === scene);
  byId('sampleSelect').replaceChildren(...choices.map(sample => {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.label;
    return option;
  }));
  if (choices.some(sample => sample.id === sampleId)) byId('sampleSelect').value = sampleId;
  byId('sampleSelect').disabled = !choices.length;
  byId('playBtn').disabled = !choices.length;
  for (const button of byId('gallery').children) {
    const selected = button.dataset.scene === scene;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

byId('randomBtn').addEventListener('click', () => {
  const sample = samples[Math.floor(Math.random() * samples.length)];
  selectScene(sample.scene, sample.id);
});

byId('playBtn').addEventListener('click', async () => {
  showError('');
  const sample = samples.find(item => item.id === byId('sampleSelect').value && item.scene === selectedScene);
  if (!sample) return showError('Choose a scene and a saved cameo first.');
  byId('playBtn').disabled = true;
  byId('playBtn').textContent = 'LOADING SAVED RESULT…';
  try {
    // Only the allowlisted sample ID is sent. There are no uploaded faces or model calls.
    const data = await request('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleId: sample.id })
    });
    if (!data.demo || data.imageUrl !== sample.imageUrl) throw new Error('Unexpected demo response.');
    const image = byId('resultImage');
    image.src = data.imageUrl;
    image.alt = `${sample.label} — saved AI-generated parody, not a real photograph`;
    await image.decode();
    activeSample = sample;
    byId('resultCaption').textContent = `${sample.label.toUpperCase()} · RECORDED AI PARODY · NOT A REAL EVENT`;
    byId('mainContent').hidden = true;
    byId('result').classList.add('visible');
    history.replaceState(null, '', `?sample=${encodeURIComponent(sample.id)}`);
    byId('result').scrollIntoView({ block: 'start' });
  } catch (error) {
    showError(error.name === 'TimeoutError' ? 'That took too long. Please try again.' : error.message);
  } finally {
    byId('playBtn').disabled = false;
    byId('playBtn').textContent = '► PLAY EXAMPLE';
  }
});

byId('anotherBtn').addEventListener('click', () => {
  byId('result').classList.remove('visible');
  byId('mainContent').hidden = false;
  activeSample = null;
  history.replaceState(null, '', location.pathname);
  byId('mainContent').scrollIntoView({ block: 'start' });
});
byId('downloadBtn').addEventListener('click', () => {
  if (!activeSample) return;
  const link = document.createElement('a');
  link.href = activeSample.imageUrl;
  link.download = `synthetic-parody-${activeSample.filename}`;
  link.click();
});
byId('shareBtn').addEventListener('click', async () => {
  if (!activeSample) return;
  try {
    await navigator.clipboard.writeText(`${location.origin}/?sample=${encodeURIComponent(activeSample.id)}`);
    byId('toast').classList.add('visible');
    setTimeout(() => byId('toast').classList.remove('visible'), 1800);
  } catch { showError('Could not copy the link. You can copy it from the address bar.'); }
});

async function init() {
  try {
    const [config, gallery] = await Promise.all([request('/api/config'), request('/api/photos')]);
    samples = config.demo.samples;
    if (!samples.length) throw new Error('No saved examples are available.');
    photos = gallery.photos.filter(photo => samples.some(sample => sample.scene === photo.path));
    byId('gallery').replaceChildren(...photos.map(photo => {
      const button = document.createElement('button');
      button.className = 'gallery-item';
      button.dataset.scene = photo.path;
      button.setAttribute('aria-label', `Select ${photo.name}`);
      const image = document.createElement('img');
      image.src = photo.path;
      image.alt = photo.name;
      button.append(image);
      button.addEventListener('click', () => selectScene(photo.path));
      return button;
    }));
    const sharedId = new URLSearchParams(location.search).get('sample');
    const initial = samples.find(sample => sample.id === sharedId) || samples[0];
    selectScene(initial.scene, initial.id);
    byId('randomBtn').disabled = false;
    if (config.supabase?.url && config.supabase.anonKey && window.supabase) {
      client = window.supabase.createClient(config.supabase.url, config.supabase.anonKey);
      client.auth.onAuthStateChange((_event, session) => renderAuth(session));
      // Do not gate the demo behind a session refresh or a profiles/usage request.
      client.auth.getSession().then(({ data, error }) => {
        if (error) byId('authError').textContent = 'Sign-in could not be restored. You can continue without an account.';
        renderAuth(data?.session);
      }).catch(() => renderAuth(null));
    } else {
      byId('authError').textContent = 'Sign-in is unavailable. You can continue without an account.';
    }
  } catch (error) {
    showError(`Could not load the recorded examples. ${error.message}`);
    byId('authError').textContent = 'The examples could not load. Please reload to try again.';
  }
}
init();
