'use strict';

const $ = id => document.getElementById(id);

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function showToast(msg) { const t=$('toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),2500); }
function getUsers() { return JSON.parse(localStorage.getItem('st_users')||'{}'); }
function saveUsers(u) { localStorage.setItem('st_users',JSON.stringify(u)); }
function getUser(u) { return getUsers()[u]||null; }
function updateUser(u,p) { const us=getUsers(); us[u]={...us[u],...p}; saveUsers(us); }
function getFavorites() { return getUser(currentUser)?.favorites||[]; }
function saveFavorites(f) { updateUser(currentUser,{favorites:f}); }
function getPlaylists() { return getUser(currentUser)?.playlists||[]; }
function savePlaylists(p) { updateUser(currentUser,{playlists:p}); }
function isFav(id) { return getFavorites().some(f=>f.videoId===id); }

let currentUser = null, ytPlayer = null, currentPage = 'search';
let activePlaylistId = null, pendingSong = null;
const songStore = {};

let authMode = 'login';
function switchTab(mode) {
  authMode = mode;
  $('tab-login').classList.toggle('active', mode==='login');
  $('tab-signup').classList.toggle('active', mode==='signup');
  $('field-name').classList.toggle('hidden', mode==='login');
  $('auth-submit').textContent = mode==='login' ? 'Login' : 'Create Account';
  $('auth-error').textContent = '';
}

$('auth-form').addEventListener('submit', e => {
  e.preventDefault();
  const username = $('auth-username').value.trim().toLowerCase();
  const password = $('auth-password').value;
  const name = $('auth-name').value.trim() || username;
  if (!username || !password) return;
  const users = getUsers();
  if (authMode === 'signup') {
    if (users[username]) { $('auth-error').textContent = 'Username already taken.'; return; }
    users[username] = {password, name, favorites:[], playlists:[]};
    saveUsers(users); doLogin(username);
  } else {
    const u = users[username];
    if (!u || u.password !== password) { $('auth-error').textContent = 'Incorrect username or password.'; return; }
    doLogin(username);
  }
});

function doLogin(username) {
  currentUser = username;
  localStorage.setItem('st_current', username);
  const u = getUser(username);
  $('user-display-name').textContent = u.name || username;
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  navigate('search');
}

function logout() {
  currentUser = null;
  localStorage.removeItem('st_current');
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  $('app').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('auth-username').value = '';
  $('auth-password').value = '';
  $('auth-name').value = '';
  $('auth-error').textContent = '';
  switchTab('login');
}

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('st_current');
  if (saved && getUser(saved)) doLogin(saved);
});

function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('youtube-player', {
    height: '62', width: '320', videoId: '',
    playerVars: {autoplay:0, controls:1, modestbranding:1, rel:0, playsinline:1},
    events: { onReady: ()=>{}, onError: e=>console.warn('YT error:',e.data) }
  });
}

function playSong(videoId) {
  const song = songStore[videoId];
  if (!song) return;
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId);
    $('now-title').textContent = song.title;
    $('now-thumb').src = song.thumbnail;
    $('now-channel').textContent = song.channel || '';
  } else { setTimeout(()=>playSong(videoId), 500); }
}

async function searchYouTube() {
  const query = $('search-input').value.trim();
  if (!query) return;
  const grid = $('search-results');
  grid.innerHTML = '<div class="loading-state">Searching…</div>';
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(query));
    const data = await res.json();
    if (data.error) { grid.innerHTML = '<div class="empty-state"><h3>API Error</h3><p>'+esc(data.error.message||data.error)+'</p></div>'; return; }
    const items = data.items || [];
    if (!items.length) { grid.innerHTML = '<div class="empty-state"><h3>No results</h3><p>Try a different search.</p></div>'; return; }
    const songs = items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
      channel: item.snippet.channelTitle
    }));
    grid.innerHTML = songs.map(s => songCard(s,{fav:true,pl:true})).join('');
  } catch(err) {
    console.error(err);
    grid.innerHTML = '<div class="empty-state"><h3>Network error</h3><p>Could not reach the search API.</p></div>';
  }
}

function storeSong(song) { songStore[song.videoId] = song; }

function songCard(song, opts={}) {
  storeSong(song);
  const {videoId, title, thumbnail} = song;
  const {fav=false, pl=false, removeFav=false, removePl=false, playlistId=null} = opts;
  const favOn = isFav(videoId);
  const vid = videoId;
  let a = '<button class="btn-card btn-card-play" onclick="playSong(&quot;'+vid+'&quot;)">▶ Play</button>';
  if (fav) a += '<button class="btn-card btn-card-fav'+(favOn?' on':'')+'" id="fav-'+vid+'" onclick="toggleFav(&quot;'+vid+'&quot;,this)">❤</button>';
  if (removeFav) a += '<button class="btn-card btn-card-remove" onclick="removeFav(&quot;'+vid+'&quot;)">✕ Remove</button>';
  if (pl) a += '<button class="btn-card btn-card-pl" onclick="openPlaylistModal(&quot;'+vid+'&quot;)">+ List</button>';
  if (removePl && playlistId!==null) a += '<button class="btn-card btn-card-remove" onclick="removeSongFromPlaylist('+playlistId+',&quot;'+vid+'&quot;)">✕</button>';
  return '<div class="song-card"><img src="'+esc(thumbnail)+'" alt="" loading="lazy"/><h4>'+esc(title)+'</h4><div class="card-actions">'+a+'</div></div>';
}

function toggleFav(videoId, btn) {
  const favs = getFavorites();
  const idx = favs.findIndex(f=>f.videoId===videoId);
  if (idx>-1) { favs.splice(idx,1); btn.classList.remove('on'); showToast('Removed from favorites'); }
  else { const s=songStore[videoId]; if(s){ favs.push(s); btn.classList.add('on'); showToast('Added to favorites'); } }
  saveFavorites(favs);
}

function removeFav(videoId) {
  saveFavorites(getFavorites().filter(f=>f.videoId!==videoId));
  renderFavorites();
  showToast('Removed from favorites');
}

function renderFavorites() {
  const favs = getFavorites();
  const grid = $('favorites-grid');
  if (!favs.length) { grid.innerHTML = '<div class="empty-state"><div class="empty-icon">❤</div><h3>No favorites yet</h3><p>Search for songs and tap the heart to save them here.</p></div>'; return; }
  grid.innerHTML = favs.map(s=>songCard(s,{removeFav:true,pl:true})).join('');
}

function toggleCreateForm() {
  $('create-playlist-form').classList.toggle('hidden');
  if (!$('create-playlist-form').classList.contains('hidden')) $('new-playlist-name').focus();
}

function createPlaylist() {
  const name = $('new-playlist-name').value.trim();
  if (!name) return;
  const pls = getPlaylists();
  pls.push({id:Date.now(), name, songs:[]});
  savePlaylists(pls);
  $('new-playlist-name').value = '';
  $('create-playlist-form').classList.add('hidden');
  renderPlaylists();
  showToast('Playlist created');
}

function deletePlaylist(id) {
  savePlaylists(getPlaylists().filter(p=>p.id!==id));
  renderPlaylists();
  showToast('Playlist deleted');
}

function renderPlaylists() {
  const pls = getPlaylists();
  const el = $('playlists-container');
  if (!pls.length) { el.innerHTML = '<div class="empty-state"><h3>No playlists yet</h3><p>Create your first playlist above.</p></div>'; return; }
  el.innerHTML = pls.map(pl => {
    return '<div class="playlist-item" onclick="openPlaylist('+pl.id+')">'
      +'<div class="playlist-item-left"><div class="playlist-icon">♫</div>'
      +'<div><div class="playlist-item-name">'+esc(pl.name)+'</div>'
      +'<div class="playlist-item-count">'+pl.songs.length+' song'+(pl.songs.length!==1?'s':'')+'</div></div></div>'
      +'<div class="playlist-item-actions"><button class="btn-icon" onclick="event.stopPropagation();deletePlaylist('+pl.id+')">Delete</button></div></div>';
  }).join('');
}

function openPlaylist(id) {
  const pl = getPlaylists().find(p=>p.id===id);
  if (!pl) return;
  activePlaylistId = id;
  $('playlists-list-view').classList.add('hidden');
  $('playlist-detail-view').classList.remove('hidden');
  $('detail-playlist-name').textContent = pl.name;
  const grid = $('playlist-songs-grid');
  if (!pl.songs.length) { grid.innerHTML = '<div class="empty-state"><h3>Empty playlist</h3><p>Search for songs and tap "+ List" to add them here.</p></div>'; return; }
  grid.innerHTML = pl.songs.map(s=>songCard(s,{removePl:true,playlistId:id})).join('');
}

function backToPlaylists() {
  activePlaylistId = null;
  $('playlist-detail-view').classList.add('hidden');
  $('playlists-list-view').classList.remove('hidden');
}

function removeSongFromPlaylist(playlistId, videoId) {
  const pls = getPlaylists();
  const pl = pls.find(p=>p.id===playlistId);
  if (!pl) return;
  pl.songs = pl.songs.filter(s=>s.videoId!==videoId);
  savePlaylists(pls);
  openPlaylist(playlistId);
  showToast('Song removed from playlist');
}

function openPlaylistModal(videoId) {
  pendingSong = songStore[videoId];
  if (!pendingSong) return;
  const pls = getPlaylists();
  const list = $('modal-playlist-list');
  if (!pls.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No playlists yet. Create one in the Playlists tab.</p>';
  } else {
    list.innerHTML = pls.map(pl =>
      '<div class="modal-playlist-option" onclick="addSongToPlaylist('+pl.id+')">'
      +'♫ '+esc(pl.name)
      +'<span style="margin-left:auto;font-size:11px">'+pl.songs.length+' songs</span></div>'
    ).join('');
  }
  $('modal-overlay').classList.remove('hidden');
}

function closeModal(e) {
  if (!e || e.target===$('modal-overlay')) { $('modal-overlay').classList.add('hidden'); pendingSong=null; }
}

function addSongToPlaylist(playlistId) {
  if (!pendingSong) return;
  const pls = getPlaylists();
  const pl = pls.find(p=>p.id===playlistId);
  if (!pl) return;
  if (!pl.songs.some(s=>s.videoId===pendingSong.videoId)) {
    pl.songs.push(pendingSong); savePlaylists(pls); showToast('Added to "'+pl.name+'"');
  } else { showToast('Already in that playlist'); }
  $('modal-overlay').classList.add('hidden');
  pendingSong = null;
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
  $('page-'+page).classList.remove('hidden');
  document.querySelector('[data-page="'+page+'"]').classList.add('active');
  if (page==='favorites') renderFavorites();
  if (page==='playlists') { renderPlaylists(); $('playlists-list-view').classList.remove('hidden'); $('playlist-detail-view').classList.add('hidden'); }
                                                                       }
