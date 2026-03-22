// ================================================================
// StreamTube v2.0 — app.js
// ================================================================

// ─── State ──────────────────────────────────────────────────────
var currentUser = null;
var ytPlayer = null;
var ytReady = false;
var currentSong = null;
var queue = [];
var queueIndex = -1;
var shuffleMode = false;
var repeatMode = 'none';
var progressInterval = null;

// ─── Utils ──────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(s) {
  s = Math.floor(s || 0);
  var m = Math.floor(s / 60);
  var sec = s % 60;
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function showToast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2500);
}

// ─── Auth ───────────────────────────────────────────────────────
function getUsers() {
  try { return JSON.parse(localStorage.getItem('st_users') || '{}'); }
  catch(e) { return {}; }
}
function saveUsers(u) { localStorage.setItem('st_users', JSON.stringify(u)); }
function getSession() { return localStorage.getItem('st_session'); }
function setSession(e) { localStorage.setItem('st_session', e); }
function clearSession() { localStorage.removeItem('st_session'); }

function initAuth() {
  var e = getSession();
  if (e) {
    var users = getUsers();
    if (users[e]) { currentUser = e; showApp(); return; }
  }
  showAuth();
}

function signup() {
  var e = $('signup-email').value.trim();
  var p = $('signup-pass').value.trim();
  var err = $('signup-error');
  if (!e || !p) { err.textContent = 'Fill in all fields.'; return; }
  var users = getUsers();
  if (users[e]) { err.textContent = 'Account already exists.'; return; }
  users[e] = { password: p, favorites: [], playlists: [] };
  saveUsers(users);
  setSession(e);
  currentUser = e;
  err.textContent = '';
  showApp();
}

function login() {
  var e = $('login-email').value.trim();
  var p = $('login-pass').value.trim();
  var err = $('login-error');
  if (!e || !p) { err.textContent = 'Fill in all fields.'; return; }
  var users = getUsers();
  if (!users[e] || users[e].password !== p) { err.textContent = 'Invalid credentials.'; return; }
  setSession(e);
  currentUser = e;
  err.textContent = '';
  showApp();
}

function logout() {
  clearSession();
  currentUser = null;
  queue = [];
  queueIndex = -1;
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  $('player-bar').style.display = 'none';
  showAuth();
}

function getUserData() {
  var users = getUsers();
  return users[currentUser] || { favorites: [], playlists: [] };
}

function saveUserData(data) {
  var users = getUsers();
  users[currentUser] = Object.assign({}, users[currentUser], data);
  saveUsers(users);
}

// ─── View Switching ─────────────────────────────────────────────
function showAuth() {
  $('auth-screen').style.display = 'flex';
  $('app-screen').style.display = 'none';
}

function showApp() {
  $('auth-screen').style.display = 'none';
  $('app-screen').style.display = 'flex';
  $('user-email').textContent = currentUser;
  switchTab('home');
}

function switchTab(tab) {
  var tabs = ['home', 'search', 'favorites', 'playlists'];
  tabs.forEach(function(t) {
    var el = $(t + '-tab');
    if (el) el.classList.remove('active');
  });
  var activeTab = $(tab + '-tab');
  if (activeTab) activeTab.classList.add('active');
  var views = ['home-view', 'search-view', 'favorites-view', 'playlists-view', 'playlist-detail-view'];
  views.forEach(function(v) {
    var el = $(v);
    if (el) el.style.display = 'none';
  });
  var view = $(tab + '-view');
  if (view) view.style.display = '';
  if (tab === 'home') loadHome();
  if (tab === 'favorites') renderFavorites();
  if (tab === 'playlists') renderPlaylists();
}

function switchAuthTab(tab) {
  $('login-tab').classList.toggle('active', tab === 'login');
  $('signup-tab').classList.toggle('active', tab === 'signup');
  $('login-form').style.display = tab === 'login' ? 'flex' : 'none';
  $('signup-form').style.display = tab === 'signup' ? 'flex' : 'none';
}

// ─── YouTube Player ─────────────────────────────────────────────
function onYouTubeIframeAPIReady() {
  ytReady = true;
  ytPlayer = new YT.Player('yt-player', {
    height: '72',
    width: '128',
    videoId: '',
    playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0 },
    events: {
      onStateChange: onPlayerStateChange,
      onReady: function() {}
    }
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    startProgressTracking();
    $('play-pause-btn').textContent = '\u23F8';
  } else if (event.data === YT.PlayerState.PAUSED) {
    $('play-pause-btn').textContent = '\u25B6';
  } else if (event.data === YT.PlayerState.ENDED) {
    handleSongEnd();
  }
}

function handleSongEnd() {
  if (repeatMode === 'one') {
    ytPlayer.seekTo(0);
    ytPlayer.playVideo();
    return;
  }
  advanceQueue(1);
}

function startProgressTracking() {
  clearInterval(progressInterval);
  progressInterval = setInterval(function() {
    if (!ytPlayer || !ytPlayer.getCurrentTime) return;
    var cur = ytPlayer.getCurrentTime() || 0;
    var dur = ytPlayer.getDuration() || 0;
    if (dur > 0) {
      $('progress-fill').style.width = (cur / dur * 100) + '%';
      $('time-current').textContent = formatTime(cur);
      $('time-total').textContent = formatTime(dur);
    }
  }, 500);
}

function seekTo(e) {
  var bar = $('progress-bar');
  var rect = bar.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (ytPlayer && ytPlayer.getDuration) {
    ytPlayer.seekTo(pct * ytPlayer.getDuration(), true);
  }
}

function togglePlayPause() {
  if (!ytPlayer) return;
  var state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
}

function toggleShuffle() {
  shuffleMode = !shuffleMode;
  $('shuffle-btn').classList.toggle('active', shuffleMode);
  showToast(shuffleMode ? 'Shuffle on' : 'Shuffle off');
}

function toggleRepeat() {
  var modes = ['none', 'one', 'all'];
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % 3];
  var btn = $('repeat-btn');
  btn.classList.toggle('active', repeatMode !== 'none');
  if (repeatMode === 'none') { btn.textContent = '\uD83D\uDD01'; btn.title = 'Repeat: Off'; showToast('Repeat off'); }
  if (repeatMode === 'one')  { btn.textContent = '\uD83D\uDD02'; btn.title = 'Repeat: One'; showToast('Repeat one song'); }
  if (repeatMode === 'all')  { btn.textContent = '\uD83D\uDD01'; btn.title = 'Repeat: All'; showToast('Repeat all songs'); }
}

function advanceQueue(dir) {
  if (!queue.length) return;
  var next = queueIndex + dir;
  if (next >= queue.length) {
    if (repeatMode === 'all') next = 0;
    else { showToast('End of queue'); return; }
  }
  if (next < 0) next = 0;
  queueIndex = next;
  playSong(queue[queueIndex]);
}

function playQueue(songs, startIndex) {
  if (!songs || !songs.length) return;
  queue = shuffleMode ? shuffleArray(songs) : songs.slice();
  queueIndex = startIndex !== undefined ? startIndex : 0;
  playSong(queue[queueIndex]);
}

function playSong(meta) {
  if (!meta) return;
  if (typeof meta === 'string') meta = { videoId: meta, title: 'Unknown', thumbnail: '', channel: '' };
  currentSong = meta;
  var idx = queue.findIndex(function(s) { return s.videoId === meta.videoId; });
  if (idx !== -1) queueIndex = idx;
  $('player-title').textContent = meta.title || 'Unknown';
  $('player-channel').textContent = meta.channel || '';
  $('player-thumb').src = meta.thumbnail || '';
  $('player-bar').style.display = 'flex';
  $('play-pause-btn').textContent = '\u23F8';
  renderQueueList();
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(meta.videoId);
  } else {
    var check = setInterval(function() {
      if (ytPlayer && ytPlayer.loadVideoById) { clearInterval(check); ytPlayer.loadVideoById(meta.videoId); }
    }, 200);
  }
  addToRecentlyPlayed(meta);
}

function addToRecentlyPlayed(meta) {
  var key = 'st_recent_' + currentUser;
  var recent = [];
  try { recent = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  recent = recent.filter(function(s) { return s.videoId !== meta.videoId; });
  recent.unshift(meta);
  recent = recent.slice(0, 20);
  localStorage.setItem(key, JSON.stringify(recent));
}

function favCurrentSong() {
  if (currentSong) { addFavorite(currentSong); $('player-fav-btn').textContent = '\u2665'; }
}

// ─── Queue Panel ────────────────────────────────────────────────
function renderQueueList() {
  var list = $('queue-list');
  if (!list) return;
  if (!queue.length) { list.innerHTML = '<div class="queue-empty">Queue is empty</div>'; return; }
  list.innerHTML = queue.map(function(s, i) {
    var active = i === queueIndex ? ' queue-item-active' : '';
    return '<div class="queue-item' + active + '" onclick="queueJump(' + i + ')">' +
      '<img src="' + esc(s.thumbnail) + '" alt="">' +
      '<div class="queue-item-info">' +
      '<div class="queue-item-title">' + esc(s.title) + '</div>' +
      '<div class="queue-item-ch">' + esc(s.channel) + '</div>' +
      '</div>' +
      (i === queueIndex ? '<span class="now-badge">NOW</span>' : '') +
      '</div>';
  }).join('');
}

function queueJump(i) { queueIndex = i; playSong(queue[i]); }
function toggleQueuePanel() { $('queue-panel').classList.toggle('open'); }

// ─── Home / Featured ────────────────────────────────────────────
var FEATURED_CATEGORIES = [
  { label: 'Top Hits 2024', query: 'top hits 2024' },
  { label: 'Chill Vibes', query: 'chill vibes music' },
  { label: 'Hip Hop Essentials', query: 'hip hop essentials' },
  { label: 'Pop Anthems', query: 'pop anthems best songs' },
  { label: 'R&B & Soul', query: 'rnb soul music' },
  { label: 'Classic Rock', query: 'classic rock hits' }
];

function loadHome() {
  renderRecentlyPlayed();
  renderRecommendations();
  loadFeaturedCollections();
}

function loadFeaturedCollections() {
  var container = $('featured-container');
  if (!container) return;
  container.innerHTML = FEATURED_CATEGORIES.map(function(c) {
    var cardId = 'feat-' + c.query.replace(/\W+/g, '_');
    return '<div class="featured-card" id="' + cardId + '">' +
      '<div class="featured-card-header">' +
      '<span class="featured-label">' + esc(c.label) + '</span>' +
      '<div class="featured-actions">' +
      '<button class="btn btn-sm-green" onclick="playFeaturedCard(\'' + cardId + '\')">&#9654; Play All</button>' +
      '<button class="btn btn-sm-ghost" onclick="shuffleFeaturedCard(\'' + cardId + '\')">&#128256; Shuffle</button>' +
      '</div></div>' +
      '<div class="featured-songs-list"><div class="loading-mini">Loading\u2026</div></div>' +
      '</div>';
  }).join('');
  FEATURED_CATEGORIES.forEach(function(c) {
    fetchFeaturedCategory(c, 'feat-' + c.query.replace(/\W+/g, '_'));
  });
}

function fetchFeaturedCategory(c, cardId) {
  fetch('/api/search?q=' + encodeURIComponent(c.query + ' official'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var card = $(cardId);
      if (!card) return;
      var songs = (data.items || []).slice(0, 5).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.default ? item.snippet.thumbnails.default.url : '',
          channel: item.snippet.channelTitle
        };
      });
      card.dataset.songs = JSON.stringify(songs);
      var listEl = card.querySelector('.featured-songs-list');
      listEl.innerHTML = songs.map(function(s, i) {
        return '<div class="feat-row" onclick="playSong(' + safeJson(s) + ')">' +
          '<span class="feat-num">' + (i + 1) + '</span>' +
          '<img src="' + esc(s.thumbnail) + '" alt="">' +
          '<div class="feat-info">' +
          '<div class="feat-title">' + esc(s.title) + '</div>' +
          '<div class="feat-ch">' + esc(s.channel) + '</div>' +
          '</div>' +
          '<button class="feat-add-fav" onclick="event.stopPropagation();addFavorite(' + safeJson(s) + ')" title="Add to favorites">&#9825;</button>' +
          '</div>';
      }).join('');
    })
    .catch(function() {
      var card = $(cardId);
      if (card) card.querySelector('.featured-songs-list').textContent = 'Could not load';
    });
}

function playFeaturedCard(cardId) {
  var card = $(cardId);
  if (!card || !card.dataset.songs) return;
  var songs = JSON.parse(card.dataset.songs);
  if (songs.length) playQueue(songs, 0);
}

function shuffleFeaturedCard(cardId) {
  var card = $(cardId);
  if (!card || !card.dataset.songs) return;
  var songs = JSON.parse(card.dataset.songs);
  if (!songs.length) return;
  var saved = shuffleMode; shuffleMode = true;
  playQueue(songs, 0);
  shuffleMode = saved;
}

function renderRecentlyPlayed() {
  var section = $('recently-played-section');
  var container = $('recently-played-container');
  if (!section || !container) return;
  var recent = [];
  try { recent = JSON.parse(localStorage.getItem('st_recent_' + currentUser) || '[]'); } catch(e) {}
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  container.innerHTML = recent.slice(0, 10).map(function(s) {
    return '<div class="recent-card" onclick="playSong(' + safeJson(s) + ')">' +
      '<img src="' + esc(s.thumbnail) + '" alt="">' +
      '<div class="recent-title">' + esc(s.title) + '</div></div>';
  }).join('');
}

function renderRecommendations() {
  var section = $('recommendations-section');
  var container = $('recommendations-container');
  if (!section || !container) return;
  var ud = getUserData();
  var recent = [];
  try { recent = JSON.parse(localStorage.getItem('st_recent_' + currentUser) || '[]'); } catch(e) {}
  var pool = ud.favorites.concat(recent).slice(0, 8);
  if (!pool.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  var allWords = pool.map(function(s) { return s.title || ''; }).join(' ');
  var words = allWords.split(/\W+/).filter(function(w) { return w.length > 3; });
  var unique = [];
  words.forEach(function(w) { if (unique.indexOf(w) === -1) unique.push(w); });
  var query = unique.slice(0, 4).join(' ') || 'popular music';
  container.innerHTML = '<div class="loading-mini">Loading recommendations\u2026</div>';
  fetch('/api/search?q=' + encodeURIComponent(query))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var songs = (data.items || []).slice(0, 6).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      container.innerHTML = songs.map(function(s) { return songCard(s); }).join('');
    })
    .catch(function() { section.style.display = 'none'; });
}

// ─── Search ─────────────────────────────────────────────────────
var _currentResults = [];

function searchYouTube() {
  var query = $('search-input').value.trim();
  if (!query) return;
  var grid = $('search-results');
  var sugg = $('search-suggestions');
  grid.innerHTML = '<div class="loading-state">Searching\u2026</div>';
  sugg.innerHTML = '';
  fetch('/api/search?q=' + encodeURIComponent(query))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        grid.innerHTML = '<div class="empty-state"><h3>API Error</h3><p>' + esc(data.error.message || data.error) + '</p></div>';
        return;
      }
      var items = data.items || [];
      if (!items.length) { grid.innerHTML = '<div class="empty-state"><h3>No results</h3><p>Try a different search.</p></div>'; return; }
      var songs = items.map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      _currentResults = songs;
      grid.innerHTML = '<div class="results-header">' +
        '<span>' + songs.length + ' results for <em>' + esc(query) + '</em></span>' +
        '<div class="results-actions">' +
        '<button class="btn btn-sm-green" onclick="playAllResults()">&#9654; Play All</button>' +
        '<button class="btn btn-sm-ghost" onclick="shuffleAllResults()">&#128256; Shuffle All</button>' +
        '</div></div>' +
        '<div class="songs-grid">' + songs.map(function(s) { return songCard(s); }).join('') + '</div>';
      loadSearchSuggestions(query);
    })
    .catch(function(err) {
      console.error(err);
      grid.innerHTML = '<div class="empty-state"><h3>Network error</h3><p>Could not reach the search API.</p></div>';
    });
}

function playAllResults() { if (_currentResults.length) playQueue(_currentResults, 0); }
function shuffleAllResults() {
  if (!_currentResults.length) return;
  var saved = shuffleMode; shuffleMode = true;
  playQueue(_currentResults, 0);
  shuffleMode = saved;
}

function loadSearchSuggestions(query) {
  var container = $('search-suggestions');
  if (!container) return;
  fetch('/api/search?q=' + encodeURIComponent(query + ' similar songs'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var songs = (data.items || []).slice(0, 4).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      if (!songs.length) return;
      container.innerHTML = '<h2 class="section-title suggestions-title">You might also like</h2>' +
        '<div class="songs-grid">' + songs.map(function(s) { return songCard(s); }).join('') + '</div>';
    })
    .catch(function() {});
}

// ─── Song Card ──────────────────────────────────────────────────
function songCard(s) {
  var safe = safeJson(s);
  return '<div class="song-card">' +
    '<img class="song-card-thumb" src="' + esc(s.thumbnail) + '" alt="">' +
    '<div class="card-info">' +
    '<div class="card-title" title="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
    '<div class="card-channel">' + esc(s.channel) + '</div>' +
    '</div>' +
    '<div class="card-actions">' +
    '<button class="btn-card btn-card-play" onclick="playSong(' + safe + ')">&#9654; Play</button>' +
    '<button class="btn-card btn-fav-card" onclick="addFavorite(' + safe + ')" title="Favorite">&#9825;</button>' +
    '<button class="btn-card" onclick="showAddToPlaylist(' + safe + ')">+ List</button>' +
    '</div></div>';
}

// ─── Favorites ──────────────────────────────────────────────────
function addFavorite(song) {
  var ud = getUserData();
  var exists = ud.favorites.some(function(s) { return s.videoId === song.videoId; });
  if (!exists) { ud.favorites.unshift(song); saveUserData(ud); showToast('Added to favorites \u2665'); }
  else showToast('Already in favorites');
}

function removeFavorite(videoId) {
  var ud = getUserData();
  ud.favorites = ud.favorites.filter(function(s) { return s.videoId !== videoId; });
  saveUserData(ud);
  renderFavorites();
}

function renderFavorites() {
  var container = $('favorites-container');
  var ud = getUserData();
  if (!ud.favorites.length) {
    container.innerHTML = '<div class="empty-state"><h3>\u2665 No favorites yet</h3><p>Search for songs and hit the heart icon.</p></div>';
    return;
  }
  container.innerHTML = '<div class="results-header">' +
    '<span>' + ud.favorites.length + ' songs</span>' +
    '<div class="results-actions">' +
    '<button class="btn btn-sm-green" onclick="playFavorites()">&#9654; Play All</button>' +
    '<button class="btn btn-sm-ghost" onclick="shuffleFavorites()">&#128256; Shuffle</button>' +
    '</div></div>' +
    '<div class="songs-grid">' + ud.favorites.map(function(s) { return favCard(s); }).join('') + '</div>';
}

function favCard(s) {
  var safe = safeJson(s);
  return '<div class="song-card">' +
    '<img class="song-card-thumb" src="' + esc(s.thumbnail) + '" alt="">' +
    '<div class="card-info">' +
    '<div class="card-title" title="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
    '<div class="card-channel">' + esc(s.channel) + '</div>' +
    '</div>' +
    '<div class="card-actions">' +
    '<button class="btn-card btn-card-play" onclick="playSong(' + safe + ')">&#9654; Play</button>' +
    '<button class="btn-card" onclick="showAddToPlaylist(' + safe + ')">+ List</button>' +
    '<button class="btn-card btn-danger" onclick="removeFavorite(\'' + esc(s.videoId) + \')">&#10005; Remove</button>' +
    '</div></div>';
}

function playFavorites() { var ud = getUserData(); if (ud.favorites.length) playQueue(ud.favorites, 0); }
function shuffleFavorites() {
  var ud = getUserData();
  if (!ud.favorites.length) return;
  var saved = shuffleMode; shuffleMode = true;
  playQueue(ud.favorites, 0);
  shuffleMode = saved;
}

// ─── Playlists ──────────────────────────────────────────────────
function renderPlaylists() {
  var container = $('playlists-container');
  var ud = getUserData();
  var cardsHtml = ud.playlists.length
    ? ud.playlists.map(function(pl, i) { return playlistCard(pl, i); }).join('')
    : '<div class="empty-state"><h3>No playlists yet</h3><p>Create your first playlist above.</p></div>';
  container.innerHTML =
    '<div class="create-playlist-bar">' +
    '<input id="new-pl-name" class="pl-name-input" placeholder="Playlist name\u2026" onkeydown="if(event.key===\'Enter\')createPlaylist()" />' +
    '<button class="btn btn-green" onclick="createPlaylist()">+ Create</button>' +
    '</div><div class="playlists-grid">' + cardsHtml + '</div>';
}

function playlistCard(pl, i) {
  var thumb = pl.songs && pl.songs[0]
    ? '<img src="' + esc(pl.songs[0].thumbnail) + '" alt="">'
    : '<span class="pl-placeholder">&#9835;</span>';
  return '<div class="playlist-card" onclick="viewPlaylist(' + i + ')">' +
    '<div class="pl-thumb">' + thumb + '</div>' +
    '<div class="pl-info"><div class="pl-name">' + esc(pl.name) + '</div>' +
    '<div class="pl-count">' + (pl.songs ? pl.songs.length : 0) + ' songs</div></div>' +
    '<div class="pl-actions">' +
    '<button class="btn-card btn-card-play" onclick="event.stopPropagation();playPlaylist(' + i + ')">&#9654; Play</button>' +
    '<button class="btn-card" onclick="event.stopPropagation();shufflePlaylist(' + i + ')">&#128256;</button>' +
    '<button class="btn-card btn-danger" onclick="event.stopPropagation();deletePlaylist(' + i + ')">&#10005;</button>' +
    '</div></div>';
}

function createPlaylist() {
  var name = $('new-pl-name').value.trim();
  if (!name) return;
  var ud = getUserData();
  ud.playlists.push({ name: name, songs: [] });
  saveUserData(ud);
  $('new-pl-name').value = '';
  renderPlaylists();
  showToast('Playlist "' + name + '" created');
}

function deletePlaylist(i) {
  var ud = getUserData();
  var name = ud.playlists[i].name;
  ud.playlists.splice(i, 1);
  saveUserData(ud);
  renderPlaylists();
  showToast('"' + name + '" deleted');
}

function viewPlaylist(i) {
  var ud = getUserData();
  var pl = ud.playlists[i];
  if (!pl) return;
  ['home-view','search-view','favorites-view','playlists-view'].forEach(function(v) {
    var el = $(v); if (el) el.style.display = 'none';
  });
  var detail = $('playlist-detail-view');
  detail.style.display = '';
  var songsHtml = pl.songs && pl.songs.length
    ? pl.songs.map(function(s, j) {
        var safe = safeJson(s);
        return '<div class="song-card">' +
          '<span class="pl-song-num">' + (j+1) + '</span>' +
          '<img class="song-card-thumb" src="' + esc(s.thumbnail) + '" alt="">' +
          '<div class="card-info"><div class="card-title">' + esc(s.title) + '</div>' +
          '<div class="card-channel">' + esc(s.channel) + '</div></div>' +
          '<div class="card-actions">' +
          '<button class="btn-card btn-card-play" onclick="playSong(' + safe + ')">&#9654; Play</button>' +
          '<button class="btn-card btn-danger" onclick="removeSongFromPlaylist(' + i + ',' + j + ')">&#10005;</button>' +
          '</div></div>';
      }).join('')
    : '<div class="empty-state"><h3>Empty playlist</h3><p>Add songs using the "+List" button on any song.</p></div>';
  detail.innerHTML =
    '<div class="detail-header">' +
    '<button class="btn-back" onclick="switchTab(\'playlists\')">&#8592; Playlists</button>' +
    '<h2>' + esc(pl.name) + '</h2>' +
    '<div class="detail-actions">' +
    '<button class="btn btn-sm-green" onclick="playPlaylist(' + i + ')">&#9654; Play All</button>' +
    '<button class="btn btn-sm-ghost" onclick="shufflePlaylist(' + i + ')">&#128256; Shuffle</button>' +
    '</div></div>' +
    '<div class="songs-grid">' + songsHtml + '</div>';
}

function playPlaylist(i) {
  var ud = getUserData(); var pl = ud.playlists[i];
  if (pl && pl.songs && pl.songs.length) playQueue(pl.songs, 0);
}
function shufflePlaylist(i) {
  var ud = getUserData(); var pl = ud.playlists[i];
  if (!pl || !pl.songs || !pl.songs.length) return;
  var saved = shuffleMode; shuffleMode = true;
  playQueue(pl.songs, 0);
  shuffleMode = saved;
}
function removeSongFromPlaylist(plIndex, songIndex) {
  var ud = getUserData();
  ud.playlists[plIndex].songs.splice(songIndex, 1);
  saveUserData(ud);
  viewPlaylist(plIndex);
}

// ─── Playlist Modal ──────────────────────────────────────────────
function showAddToPlaylist(song) {
  var ud = getUserData();
  if (!ud.playlists.length) { showToast('Create a playlist first!'); switchTab('playlists'); return; }
  var modal = $('playlist-modal');
  modal.innerHTML = '<div class="modal-box" onclick="event.stopPropagation()">' +
    '<h3>Add to playlist</h3>' +
    ud.playlists.map(function(pl, i) {
      return '<button class="modal-pl-btn" onclick="addSongToPlaylist(' + i + ',' + safeJson(song) + ')">' +
        esc(pl.name) + ' <span class="modal-count">(' + pl.songs.length + ')</span></button>';
    }).join('') +
    '<button class="btn-card btn-danger modal-cancel" onclick="closeModal()">Cancel</button>' +
    '</div>';
  modal.style.display = 'flex';
}

function addSongToPlaylist(plIndex, song) {
  var ud = getUserData(); var pl = ud.playlists[plIndex];
  var exists = pl.songs.some(function(s) { return s.videoId === song.videoId; });
  if (!exists) { pl.songs.push(song); saveUserData(ud); showToast('Added to "' + pl.name + '"'); }
  else showToast('Already in "' + pl.name + '"');
  closeModal();
}

function closeModal() { $('playlist-modal').style.display = 'none'; }

// ─── Keyboard shortcuts ─────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
  if (e.code === 'ArrowRight') advanceQueue(1);
  if (e.code === 'ArrowLeft') advanceQueue(-1);
  if (e.code === 'KeyS') toggleShuffle();
  if (e.code === 'KeyR') toggleRepeat();
});

// ─── Init ───────────────────────────────────────────────────────
initAuth();
