// ================================================================
// Fredify v3.1 â app.js (Firebase Edition)
// Features: Media Session, Artist Radio, Crossfade, Artist Pages,
//           Because You Liked, Genre Radio, Smart Playlists, Dup Detection
// ================================================================


// Firebase â initialised async from /api/firebase-config
var auth = null;
var db   = null;

// App state
var currentUser = null;
var currentUserData = null; // in-memory Firestore cache
var ytPlayer = null;
var ytReady = false;
var currentSong = null;
var queue = [];
var queueIndex = -1;
var shuffleMode = false;
var repeatMode = 'none';
var progressInterval = null;
// Crossfade state
var crossfadeActive  = false;
var crossfadeStarted = false;
var crossfadeTimer   = null;
// Radio state
var genreRadioQuery  = null; // set when genre radio is on

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

// ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function isFavorite(videoId) {
  return getUserData().favorites.some(function(s) { return s.videoId === videoId; });
}

function searchArtist(name) {
  switchTab('search');
  $('search-input').value = name;
  searchYouTube();
}

// ââ Firebase Auth âââââââââââââââââââââââââââââââââââââââââââââââââ

function loadUserData(uid) {
  return db.collection('users').doc(uid).get().then(function(doc) {
    if (doc.exists) {
      currentUserData = doc.data();
    } else {
      currentUserData = { favorites: [], playlists: [], recentlyPlayed: [], playCounts: {} };
      return db.collection('users').doc(uid).set(currentUserData);
    }
    if (!currentUserData.favorites) currentUserData.favorites = [];
    if (!currentUserData.playlists) currentUserData.playlists = [];
    if (!currentUserData.recentlyPlayed) currentUserData.recentlyPlayed = [];
    if (!currentUserData.playCounts) currentUserData.playCounts = {};
  }).catch(function(err) {
    console.error('loadUserData error', err);
    currentUserData = { favorites: [], playlists: [], recentlyPlayed: [], playCounts: {} };
  });
}

function initAuth() {
  auth.onAuthStateChanged(function(user) {
    if (user) {
      currentUser = user.email;
      loadUserData(user.uid).then(function() {
        showApp();
      });
    } else {
      currentUser = null;
      currentUserData = null;
      showAuth();
    }
  });
}

function signup() {
  var e = $('signup-email').value.trim();
  var p = $('signup-pass').value.trim();
  var err = $('signup-error');
  if (!e || !p) { err.textContent = 'Fill in all fields.'; return; }
  err.textContent = '';
  auth.createUserWithEmailAndPassword(e, p)
    .catch(function(error) {
      err.textContent = error.message;
    });
}

function login() {
  var e = $('login-email').value.trim();
  var p = $('login-pass').value.trim();
  var err = $('login-error');
  if (!e || !p) { err.textContent = 'Fill in all fields.'; return; }
  err.textContent = '';
  auth.signInWithEmailAndPassword(e, p)
    .catch(function(error) {
      err.textContent = 'Invalid credentials.';
    });
}

function logout() {
  queue = [];
  queueIndex = -1;
  genreRadioQuery = null;
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  $('player-bar').style.display = 'none'; document.body.classList.remove('player-active');
  auth.signOut();
}

function getUserData() {
  return currentUserData || { favorites: [], playlists: [], recentlyPlayed: [], playCounts: {} };
}

function saveUserData(data) {
  currentUserData = Object.assign({}, currentUserData || {}, data);
  if (!currentUserData.favorites) currentUserData.favorites = [];
  if (!currentUserData.playlists) currentUserData.playlists = [];
  if (!currentUserData.recentlyPlayed) currentUserData.recentlyPlayed = [];
  if (!currentUserData.playCounts) currentUserData.playCounts = {};
  var user = auth.currentUser;
  if (user) {
    db.collection('users').doc(user.uid).set(currentUserData).catch(function(err) {
      console.error('saveUserData error', err);
    });
  }
}

// ââ Views âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function showAuth() {
  $('auth-screen').style.display = 'flex';
  $('app-screen').style.display = 'none';
  document.body.classList.remove('app-active');
}

function showApp() {
  $('auth-screen').style.display = 'none';
  $('app-screen').style.display = 'flex';
  document.body.classList.add('app-active');
  $('user-email').textContent = currentUser;
  switchTab('home');
  // YT API often fires onYouTubeIframeAPIReady before login (app-screen hidden).
  // Re-init the player now that the DOM is visible.
  if (typeof YT !== 'undefined' && YT.Player && !ytReady) {
    onYouTubeIframeAPIReady();
  }
}

function switchTab(tab) {
  ['home','search','favorites','playlists'].forEach(function(t) {
    var el = $(t + '-tab');
    if (el) el.classList.remove('active');
    var mob = $('mob-' + t + '-tab');
    if (mob) mob.classList.remove('active');
  });
  var activeTab = $(tab + '-tab');
  if (activeTab) activeTab.classList.add('active');
  var activeMob = $('mob-' + tab + '-tab');
  if (activeMob) activeMob.classList.add('active');
  ['home-view','search-view','favorites-view','playlists-view','playlist-detail-view'].forEach(function(v) {
    var el = $(v); if (el) el.style.display = 'none';
  });
  var view = $(tab + '-view');
  if (view) view.style.display = '';
  if (tab === 'home') loadHome();
  if (tab === 'favorites') { renderFavorites(); checkLibraryAvailability(); }
  if (tab === 'playlists') { renderPlaylists(); checkLibraryAvailability(); }
}

function switchAuthTab(tab) {
  $('login-tab').classList.toggle('active', tab === 'login');
  $('signup-tab').classList.toggle('active', tab === 'signup');
  $('login-form').style.display = tab === 'login' ? 'flex' : 'none';
  $('signup-form').style.display = tab === 'signup' ? 'flex' : 'none';
}

// ââ YouTube Player ââââââââââââââââââââââââââââââââââââââââââââââââ

function onYouTubeIframeAPIReady() {
  ytReady = true;
  ytPlayer = new YT.Player('yt-player', {
    height: '72',
    width: '128',
    videoId: '',
    playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, origin: window.location.origin },
    events: {
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
      onReady: function() {}
    }
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    clearStartupWatchdog();
    startProgressTracking();
    $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined">pause</span>';
  } else if (event.data === YT.PlayerState.PAUSED) {
    clearStartupWatchdog();
    $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
  } else if (event.data === YT.PlayerState.ENDED) {
    clearStartupWatchdog();
    handleSongEnd();
} else if (event.data === YT.PlayerState.BUFFERING) {
    $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined" style="animation:spin 1s linear infinite">progress_activity</span>';
  } else if (event.data === -1) {
    // UNSTARTED — arm startup watchdog: skip if no PLAYING within 9s
    armStartupWatchdog();
  }
}

function onPlayerError(event) {
  clearStartupWatchdog();
  // 2=invalid id, 5=HTML5 error, 100=not found/private, 101/150=embed disabled
  var msg = (event.data === 100) ? 'Video not found or private' :
            (event.data === 101 || event.data === 150) ? 'Embedding not allowed' :
            'Playback error';
  showToast(msg + ' — skipping…');
  $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
  _errorSkipTimer = setTimeout(function() { advanceQueue(1); }, 1800);
}

var _startupWatchdog = null;
var _errorSkipTimer  = null;
function armStartupWatchdog() {
  clearStartupWatchdog();
  _startupWatchdog = setTimeout(function() {
    if (ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
      showToast('Song took too long to start — skipping…');
      $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
      advanceQueue(1);
    }
  }, 9000);
}
function clearStartupWatchdog() {
  if (_startupWatchdog) { clearTimeout(_startupWatchdog); _startupWatchdog = null; }
}

function handleSongEnd() {
  if (repeatMode === 'one') { ytPlayer.seekTo(0); ytPlayer.playVideo(); return; }
  // Ignore natural end if crossfade already triggered the next song
  if (crossfadeActive) { crossfadeActive = false; return; }
  advanceQueue(1);
}

function startProgressTracking() {
  clearInterval(progressInterval);
  crossfadeStarted = false;
  var _lastPos = -1, _stallTicks = 0;
  progressInterval = setInterval(function() {
    if (!ytPlayer || !ytPlayer.getCurrentTime) return;
    var cur = ytPlayer.getCurrentTime() || 0;
    // Stall watchdog: if position hasn't moved for 10s while not paused, skip
    var state = ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1;
    if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
      if (Math.abs(cur - _lastPos) < 0.1) { _stallTicks++; } else { _stallTicks = 0; }
      if (_stallTicks > 20) { // 10s stalled (interval=500ms)
        _stallTicks = 0;
        showToast('Song stalled — skipping…');
        advanceQueue(1); return;
      }
    } else { _stallTicks = 0; }
    _lastPos = cur;
    var dur = ytPlayer.getDuration() || 0;
    if (dur > 0) {
      $('progress-fill').style.width = (cur / dur * 100) + '%';
      $('time-current').textContent = formatTime(cur);
      $('time-total').textContent = formatTime(dur);
      // Crossfade: fade out in last 5s (only for songs > 10s)
      if (dur > 10 && dur - cur < 5 && dur - cur > 0.2 && !crossfadeStarted) {
        crossfadeStarted = true;
        crossfadeActive  = true;
        var baseVol = ytPlayer.getVolume ? ytPlayer.getVolume() : 100;
        var steps = 0, totalSteps = 20;
        crossfadeTimer = setInterval(function() {
          steps++;
          var newVol = Math.max(0, Math.round(baseVol * (1 - steps / totalSteps)));
          if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(newVol);
          if (steps >= totalSteps) {
            clearInterval(crossfadeTimer);
            crossfadeTimer = null;
            advanceQueue(1);
          }
        }, 250);
      }
    }
  }, 500);
}

function seekTo(e) {
  var bar = $('progress-bar');
  var rect = bar.getBoundingClientRect();
  var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (ytPlayer && ytPlayer.getDuration) ytPlayer.seekTo(pct * ytPlayer.getDuration(), true);
}

function togglePlayPause() {
  if (!ytPlayer) return;
  if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
  else ytPlayer.playVideo();
}

function toggleShuffle() {
  shuffleMode = !shuffleMode;
  $('shuffle-btn').classList.toggle('active', shuffleMode);
  showToast(shuffleMode ? 'Shuffle on' : 'Shuffle off');
}

function toggleRepeat() {
  var modes = ['none','one','all'];
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % 3];
  var btn = $('repeat-btn');
  btn.classList.toggle('active', repeatMode !== 'none');
  if (repeatMode === 'none') { btn.innerHTML = '<span class="material-symbols-outlined">repeat</span>'; btn.title = 'Repeat: Off'; showToast('Repeat off'); }
  if (repeatMode === 'one')  { btn.innerHTML = '<span class="material-symbols-outlined">repeat_one</span>'; btn.title = 'Repeat: One'; showToast('Repeat one song'); }
  if (repeatMode === 'all')  { btn.innerHTML = '<span class="material-symbols-outlined">repeat</span>'; btn.title = 'Repeat: All'; showToast('Repeat all songs'); }
}

function advanceQueue(dir) {
  clearTimeout(_errorSkipTimer);
  // Reset crossfade state on any queue advance
  crossfadeActive  = false;
  crossfadeStarted = false;
  if (crossfadeTimer) { clearInterval(crossfadeTimer); crossfadeTimer = null; }
  // Restore volume after crossfade
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(100);

  
  var next = queueIndex + dir;
  if (next < 0) next = 0;
  if (next >= queue.length) {
    if (repeatMode === 'all') { next = 0; }
    else if (genreRadioQuery) { genreRadio(); return; }
    else { artistRadio(); return; } // always-on: auto-queue more songs by same artist
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
  setRadioBadge(''); // clear radio badge on manual play
  if (typeof meta === 'string') meta = { videoId: meta, title: 'Unknown', thumbnail: '', channel: '' };
  currentSong = meta;
  var idx = queue.findIndex(function(s) { return s.videoId === meta.videoId; });
  if (idx !== -1) queueIndex = idx;
  $('player-title').textContent = meta.title || 'Unknown';
  $('player-channel').textContent = meta.channel || '';
  $('player-thumb').src = meta.thumbnail || '';
  $('player-bar').style.display = 'flex'; document.body.classList.add('player-active');
  $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined">pause</span>';
  // Update fav button state
  var favBtn = $('player-fav-btn');
  if (favBtn) favBtn.innerHTML = isFavorite(meta.videoId) ? '<span class="material-symbols-outlined" style="color:var(--accent)">favorite</span>' : '<span class="material-symbols-outlined">favorite_border</span>';
  renderQueueList();

  // Media Session API â enables lock screen controls + Now Playing widget
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  meta.title  || 'Unknown',
        artist: meta.channel || '',
        artwork: [{ src: meta.thumbnail || '', sizes: '120x90', type: 'image/jpeg' }]
      });
      navigator.mediaSession.setActionHandler('play',          function() { if (ytPlayer) ytPlayer.playVideo(); });
      navigator.mediaSession.setActionHandler('pause',         function() { if (ytPlayer) ytPlayer.pauseVideo(); });
      navigator.mediaSession.setActionHandler('nexttrack',     function() { advanceQueue(1); });
      navigator.mediaSession.setActionHandler('previoustrack', function() { advanceQueue(-1); });
    } catch(e) {}
  }

  function doLoad() {
    if (ytPlayer.setVolume) ytPlayer.setVolume(100);
    ytPlayer.loadVideoById(meta.videoId);
  }

  if (ytPlayer && ytPlayer.loadVideoById) {
    doLoad();
  } else {
    var tries = 0;
    var check = setInterval(function() {
      tries++;
      if (ytPlayer && ytPlayer.loadVideoById) { clearInterval(check); doLoad(); }
      else if (tries > 40) {
        clearInterval(check);
        showToast('Player failed to load — try refreshing.');
        $('play-pause-btn').innerHTML = '<span class="material-symbols-outlined">play_arrow</span>';
      }
    }, 200);
  }

  addToRecentlyPlayed(meta);
}

function addToRecentlyPlayed(meta) {
  var ud = getUserData();
  var recent = (ud.recentlyPlayed || []).slice();
  recent = recent.filter(function(s) { return s.videoId !== meta.videoId; });
  recent.unshift(meta);
  // Track play counts for Smart Playlists
  var counts = ud.playCounts || {};
  counts[meta.videoId] = (counts[meta.videoId] || 0) + 1;
  saveUserData({ recentlyPlayed: recent.slice(0, 20), playCounts: counts });
}

function favCurrentSong() {
  if (currentSong) {
    addFavorite(currentSong);
  }
}

// ââ Artist Radio ââââââââââââââââââââââââââââââââââââââââââââââââââ

function artistRadio() {
  if (!currentSong) { showToast('End of queue'); return; }
  var artist = (currentSong.channel || currentSong.title.split('-')[0]).trim();
  showToast('\u25CF Artist radio: ' + artist);
  fetch('/api/search?q=' + encodeURIComponent(artist + ' top songs'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var curId = currentSong ? currentSong.videoId : null;
      var songs = (data.items || []).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default) || {}).url || '',
          channel: item.snippet.channelTitle
        };
      }).filter(function(s) {
        return s.videoId !== curId && !queue.some(function(q) { return q.videoId === s.videoId; });
      });
      if (songs.length) {
        queue = queue.concat(songs);
        advanceQueue(1);
      } else {
        showToast('End of queue');
      }
    }).catch(function() { showToast('End of queue'); });
}

// ââ Genre Radio âââââââââââââââââââââââââââââââââââââââââââââââââââ

function genreRadio() {
  if (!genreRadioQuery) return;
  fetch('/api/search?q=' + encodeURIComponent(genreRadioQuery + ' popular'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var newSongs = (data.items || []).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default) || {}).url || '',
          channel: item.snippet.channelTitle
        };
      }).filter(function(s) {
        return !queue.some(function(q) { return q.videoId === s.videoId; });
      });
      if (newSongs.length) {
        queue = queue.concat(shuffleArray(newSongs));
        advanceQueue(1);
      }
    }).catch(function() {});
}

function startGenreRadio(cardId, query) {
  genreRadioQuery = query;
  var card = $(cardId);
  if (card && card.dataset.songs) {
    var songs = JSON.parse(card.dataset.songs);
    if (songs.length) {
      playQueue(shuffleArray(songs), 0);
      showToast('\uD83D\uDCFB Genre radio on');
      return;
    }
  }
  showToast('\uD83D\uDCFB Genre radio \u2014 loading\u2026');
  fetch('/api/search?q=' + encodeURIComponent(query + ' popular'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var songs = (data.items || []).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default) || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      if (songs.length) playQueue(shuffleArray(songs), 0);
    }).catch(function() {});
}

// ââ Queue Panel âââââââââââââââââââââââââââââââââââââââââââââââââââ

function renderQueueList() {
  var list = $('queue-list');
  if (!list) return;
  if (!queue.length) { list.innerHTML = '<div class="queue-empty">Queue is empty</div>'; return; }
  list.innerHTML = queue.map(function(s, i) {
    var cls = 'queue-item' + (i === queueIndex ? ' queue-item-active' : '');
    return '<div class="' + cls + '" onclick="queueJump(' + i + ')">' +
      '<img src="' + esc(s.thumbnail) + '" alt="">' +
      '<div class="queue-item-info">' +
      '<div class="queue-item-title">' + esc(s.title) + '</div>' +
      '<div class="queue-item-ch">' + esc(s.channel) + '</div></div>' +
      (i === queueIndex ? '<span class="now-badge">NOW</span>' : '') +
      '</div>';
  }).join('');
}

function queueJump(i) { queueIndex = i; playSong(queue[i]); }
function toggleQueuePanel() { $('queue-panel').classList.toggle('open'); }

// ââ Home ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

var FEATURED_CATEGORIES = [
  { label: 'Top Hits 2025',      query: 'top hits 2025' },
  { label: 'Chill Vibes',        query: 'chill vibes music' },
  { label: 'Hip Hop Essentials', query: 'hip hop essentials' },
  { label: 'Pop Anthems',        query: 'pop anthems best songs' },
  { label: 'R&B & Soul',         query: 'rnb soul music' },
  { label: 'Classic Rock',       query: 'classic rock hits' }
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
    var id = 'feat-' + c.query.replace(/\W+/g, '_');
    return '<div class="featured-card" id="' + id + '" data-query="' + esc(c.query) + '">' +
      '<div class="featured-card-header">' +
      '<span class="featured-label">' + esc(c.label) + '</span>' +
      '<div class="featured-actions">' +
      '<button class="btn btn-sm-green" data-cid="' + esc(id) + '" onclick="playFeaturedCard(this.dataset.cid)"><span class=\"material-symbols-outlined\">play_arrow</span> Play All</button>' +
      '<button class="btn btn-sm-ghost" data-cid="' + esc(id) + '" onclick="shuffleFeaturedCard(this.dataset.cid)"><span class=\"material-symbols-outlined\">shuffle</span> Shuffle</button>' +
      '<button class="btn btn-sm-radio" data-cid="' + esc(id) + '" data-query="' + esc(c.query) + '" onclick="startGenreRadio(this.dataset.cid, this.dataset.query)">&#128251; Radio</button>' +
      '</div></div><div class="featured-songs-list"><div class="loading-mini">Loading\u2026</div></div></div>';
  }).join('');
  FEATURED_CATEGORIES.forEach(function(c) {
    fetchFeaturedCategory(c, 'feat-' + c.query.replace(/\W+/g, '_'));
  });
}

function fetchFeaturedCategory(c, cardId) {
  fetch('/api/search?q=' + encodeURIComponent(c.query + ' official'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var card = $(cardId); if (!card) return;
      var songs = (data.items || []).slice(0, 5).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: (item.snippet.thumbnails.default || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      card.dataset.songs = JSON.stringify(songs);
      card.querySelector('.featured-songs-list').innerHTML = songs.map(function(s, i) {
        return '<div class="feat-row" data-song="' + safeJson(s) + '" onclick="playSong(JSON.parse(this.dataset.song))">' +
          '<span class="feat-num">' + (i+1) + '</span>' +
          '<img src="' + esc(s.thumbnail) + '" alt="">' +
          '<div class="feat-info"><div class="feat-title">' + esc(s.title) + '</div>' +
          '<div class="feat-ch"><button class="artist-link" data-artist="' + esc(s.channel) + '" onclick="event.stopPropagation();searchArtist(this.dataset.artist)">' + esc(s.channel) + '</button></div></div>' +
          '<button class="feat-add-fav' + (isFavorite(s.videoId) ? ' fav-active' : '') + '" data-song="' + safeJson(s) + '" onclick="event.stopPropagation();addFavorite(JSON.parse(this.dataset.song))" title="Favorite">' + (isFavorite(s.videoId) ? '&#9829;' : '&#9825;') + '</button>' +
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
  if (songs.length) { genreRadioQuery = card.dataset.query || null; playQueue(songs, 0); }
}

function shuffleFeaturedCard(cardId) {
  var card = $(cardId);
  if (!card || !card.dataset.songs) return;
  var songs = JSON.parse(card.dataset.songs);
  if (!songs.length) return;
  var saved = shuffleMode; shuffleMode = true;
  genreRadioQuery = card.dataset.query || null;
  playQueue(songs, 0);
  shuffleMode = saved;
}

function renderRecentlyPlayed() {
  var section = $('recently-played-section');
  var container = $('recently-played-container');
  if (!section || !container) return;
  var recent = getUserData().recentlyPlayed || [];
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  container.innerHTML = recent.slice(0, 10).map(function(s) {
    return '<div class="recent-card" data-song="' + safeJson(s) + '" onclick="playSong(JSON.parse(this.dataset.song))">' +
      '<img src="' + esc(s.thumbnail) + '" alt="">' +
      '<div class="recent-title">' + esc(s.title) + '</div></div>';
  }).join('');
}

function renderRecommendations() {
  var section = $('recommendations-section');
  var container = $('recommendations-container');
  if (!section || !container) return;
  var ud = getUserData();
  var recent = ud.recentlyPlayed || [];
  var pool = ud.favorites.concat(recent).filter(function(s) { return s && s.videoId; });
  if (!pool.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  // Pick a random seed from top 5 (weighted toward favorites)
  var seed = pool[Math.floor(Math.random() * Math.min(pool.length, 5))];
  var seedName = (seed.title || seed.channel || '').slice(0, 35);
  var query = (seed.channel || seed.title.split('-')[0]).trim() + ' similar songs';
  container.innerHTML =
    '<div class="because-label">Because you liked \u201c' + esc(seedName) + (seed.title && seed.title.length > 35 ? '\u2026' : '') + '\u201d</div>' +
    '<div class="loading-mini">Loading\u2026</div>';
  fetch('/api/search?q=' + encodeURIComponent(query))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var songs = (data.items || []).slice(0, 6).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default) || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      container.innerHTML =
        '<div class="because-label">Because you liked \u201c' + esc(seedName) + (seed.title && seed.title.length > 35 ? '\u2026' : '') + '\u201d</div>' +
        '<div class="songs-grid">' + songs.map(function(s) { return songCard(s); }).join('') + '</div>';
    })
    .catch(function() { section.style.display = 'none'; });
}

// ââ Search ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

var _currentResults = [];

function searchYouTube() {
  var query = $('search-input').value.trim();
  if (!query) return;
  genreRadioQuery = null; // clear genre radio when user searches manually
  $('search-results').innerHTML = '<div class="loading-state">Searching\u2026</div>';
  $('search-suggestions').innerHTML = '';
  fetch('/api/search?q=' + encodeURIComponent(query))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        $('search-results').innerHTML = '<div class="empty-state"><h3>API Error</h3><p>' + esc(data.error.message || data.error) + '</p></div>';
        return;
      }
      var items = data.items || [];
      if (!items.length) { $('search-results').innerHTML = '<div class="empty-state"><h3>No results</h3></div>'; return; }
      var songs = items.map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default) || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      _currentResults = songs;
      $('search-results').innerHTML =
        '<div class="results-header"><span>' + songs.length + ' results for <em>' + esc(query) + '</em></span>' +
        '<div class="results-actions">' +
        '<button class="btn btn-sm-green" onclick="playAllResults()"><span class=\"material-symbols-outlined\">play_arrow</span> Play All</button>' +
        '<button class="btn btn-sm-ghost" onclick="shuffleAllResults()"><span class=\"material-symbols-outlined\">shuffle</span> Shuffle All</button>' +
        '</div></div><div class="songs-grid">' + songs.map(function(s) { return songCard(s); }).join('') + '</div>';
      loadSearchSuggestions(query);
    })
    .catch(function(err) {
      console.error(err);
      $('search-results').innerHTML = '<div class="empty-state"><h3>Network error</h3></div>';
    });
}

function playAllResults() { if (_currentResults.length) playQueue(_currentResults, 0); }
function shuffleAllResults() {
  if (!_currentResults.length) return;
  var s = shuffleMode; shuffleMode = true;
  playQueue(_currentResults, 0);
  shuffleMode = s;
}

function loadSearchSuggestions(query) {
  fetch('/api/search?q=' + encodeURIComponent(query + ' similar songs'))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var songs = (data.items || []).slice(0, 4).map(function(item) {
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default) || {}).url || '',
          channel: item.snippet.channelTitle
        };
      });
      if (!songs.length) return;
      $('search-suggestions').innerHTML =
        '<h2 class="section-title suggestions-title">You might also like</h2>' +
        '<div class="songs-grid">' + songs.map(function(s) { return songCard(s); }).join('') + '</div>';
    }).catch(function() {});
}

// ââ Song Card âââââââââââââââââââââââââââââââââââââââââââââââââââââ

function songCard(s) {
  var ds = safeJson(s);
  var fav = isFavorite(s.videoId);
  var unavail = window._unavailableIds && window._unavailableIds[s.videoId];
  return '<div class="song-card' + (unavail ? ' song-unavailable' : '') + '" data-vid="' + esc(s.videoId) + '">' +
    '<img class="song-card-thumb" src="' + esc(s.thumbnail) + '" alt="">' +
    '<div class="card-info">' +
    '<div class="card-title" title="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
    '<button class="artist-link" data-artist="' + esc(s.channel) + '" onclick="event.stopPropagation();searchArtist(this.dataset.artist)">' + esc(s.channel) + '</button>' +
    '</div>' +
    '<div class="card-actions">' +
    '<button class="btn-card btn-card-play" data-song="' + ds + '" onclick="playSong(JSON.parse(this.dataset.song))"><span class=\"material-symbols-outlined\">play_arrow</span></button>' +
    '<button class="btn-card btn-fav-card' + (fav ? ' fav-active' : '') + '" data-song="' + ds + '" onclick="addFavorite(JSON.parse(this.dataset.song))" title="Favorite">' + (fav ? '&#9829;' : '&#9825;') + '</button>' +
    '<button class="btn-card" data-song="' + ds + '" onclick="showAddToPlaylist(JSON.parse(this.dataset.song))">+ List</button>' +
    '</div></div>';
}

// ââ Favorites âââââââââââââââââââââââââââââââââââââââââââââââââââââ

function addFavorite(song) {
  var ud = getUserData();
  if (!ud.favorites.some(function(s) { return s.videoId === song.videoId; })) {
    ud.favorites.unshift(song);
    saveUserData(ud);
    showToast('Added to favorites \u2665');
    // Update player fav button if this is the current song
    if (currentSong && currentSong.videoId === song.videoId) {
      var btn = $('player-fav-btn');
      if (btn) btn.textContent = '\u2665';
    }
  } else {
    showToast('Already in favorites \u2665');
  }
}

function removeFavorite(videoId) {
  var ud = getUserData();
  ud.favorites = ud.favorites.filter(function(s) { return s.videoId !== videoId; });
  saveUserData(ud);
  renderFavorites();
  // Reset player fav button if this was the current song
  if (currentSong && currentSong.videoId === videoId) {
    var btn = $('player-fav-btn');
    if (btn) {
      btn.innerHTML = '<span class="material-symbols-outlined">favorite_border</span>';
      btn.classList.remove('active');
    }
  }
}

function renderFavorites() {
  var container = $('favorites-container');
  var ud = getUserData();
  if (!ud.favorites.length) {
    container.innerHTML = '<div class="empty-state"><h3>\u2665 No favorites yet</h3><p>Search and hit the heart icon.</p></div>';
    return;
  }
  container.innerHTML =
    '<div class="results-header"><span>' + ud.favorites.length + ' songs</span>' +
    '<div class="results-actions">' +
    '<button class="btn btn-sm-green" onclick="playFavorites()"><span class=\"material-symbols-outlined\">play_arrow</span> Play All</button>' +
    '<button class="btn btn-sm-ghost" onclick="shuffleFavorites()"><span class=\"material-symbols-outlined\">shuffle</span> Shuffle</button>' +
    '</div></div><div class="songs-grid">' + ud.favorites.map(function(s) { return favCard(s); }).join('') + '</div>';
}

function favCard(s) {
  var ds = safeJson(s);
  var unavail = window._unavailableIds && window._unavailableIds[s.videoId];
  return '<div class="song-card' + (unavail ? ' song-unavailable' : '') + '" data-vid="' + esc(s.videoId) + '">' +
    '<img class="song-card-thumb" src="' + esc(s.thumbnail) + '" alt="">' +
    '<div class="card-info">' +
    '<div class="card-title" title="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
    '<button class="artist-link" data-artist="' + esc(s.channel) + '" onclick="event.stopPropagation();searchArtist(this.dataset.artist)">' + esc(s.channel) + '</button>' +
    '</div>' +
    '<div class="card-actions">' +
    '<button class="btn-card btn-card-play" data-song="' + ds + '" onclick="playSong(JSON.parse(this.dataset.song))"><span class=\"material-symbols-outlined\">play_arrow</span></button>' +
    '<button class="btn-card" data-song="' + ds + '" onclick="showAddToPlaylist(JSON.parse(this.dataset.song))">+ List</button>' +
    '<button class="btn-card btn-danger" data-vid="' + esc(s.videoId) + '" onclick="removeFavorite(this.dataset.vid)"><span class=\"material-symbols-outlined\">delete</span></button>' +
    '</div>' +
    (unavail ? '<div class="unavail-badge"><span class="material-symbols-outlined">warning</span> Unavailable <button class="btn-fix" data-vid="' + esc(s.videoId) + '" data-title="' + esc(s.title) + '" onclick="fixUnavailableSong(this.dataset.vid,this.dataset.title)">Find alt</button></div>' : '') +
    '</div>';
}

function playFavorites() {
  var ud = getUserData();
  if (ud.favorites.length) playQueue(ud.favorites, 0);
}
function shuffleFavorites() {
  var ud = getUserData();
  if (!ud.favorites.length) return;
  var s = shuffleMode; shuffleMode = true;
  playQueue(ud.favorites, 0);
  shuffleMode = s;
}

// ââ Playlists âââââââââââââââââââââââââââââââââââââââââââââââââââââ

function renderPlaylists() {
  var container = $('playlists-container');
  var ud = getUserData();
  var smartHtml = buildSmartPlaylistCards(ud);
  var cardsHtml = ud.playlists.length
    ? ud.playlists.map(function(pl, i) { return playlistCard(pl, i); }).join('')
    : '';
  var yourPlSection = cardsHtml ||
    (!smartHtml ? '<div class="empty-state"><h3>No playlists yet</h3><p>Create your first one above.</p></div>' : '');

  container.innerHTML =
    '<div class="create-playlist-bar">' +
    '<input id="new-pl-name" class="pl-name-input" placeholder="Playlist name\u2026" onkeydown="if(event.key===&quot;Enter&quot;)createPlaylist()" />' +
    '<button class="btn btn-green" onclick="createPlaylist()">+ Create</button>' +
    '</div>' +
    (smartHtml
      ? '<h3 class="smart-section-title">Smart Playlists</h3><div class="playlists-grid">' + smartHtml + '</div>'
      : '') +
    '<h3 class="smart-section-title">Your Playlists</h3>' +
    '<div class="playlists-grid">' + yourPlSection + '</div>';
}

function buildSmartPlaylistCards(ud) {
  var cards = [];
  var recent = ud.recentlyPlayed || [];
  if (recent.length) {
    cards.push(
      '<div class="playlist-card smart-pl">' +
      '<div class="pl-thumb smart-pl-icon">&#128337;</div>' +
      '<div class="pl-info"><div class="pl-name">Recently Played</div><div class="pl-count">' + recent.length + ' songs</div></div>' +
      '<div class="pl-actions">' +
      '<button class="btn-card btn-card-play" onclick="playSmartPlaylist(\'recent\')"><span class=\"material-symbols-outlined\">play_arrow</span></button>' +
      '<button class="btn-card" onclick="shuffleSmartPlaylist(\'recent\')"><span class=\"material-symbols-outlined\">shuffle</span></button>' +
      '</div></div>'
    );
  }
  // Most Played â needs at least 3 tracked songs
  var counts = ud.playCounts || {};
  var countKeys = Object.keys(counts);
  if (countKeys.length >= 3) {
    var allSongs = ud.favorites.concat(recent);
    var songMap = {};
    allSongs.forEach(function(s) { if (s && s.videoId && !songMap[s.videoId]) songMap[s.videoId] = s; });
    var topSongs = countKeys
      .sort(function(a, b) { return counts[b] - counts[a]; })
      .slice(0, 20)
      .map(function(vid) { return songMap[vid]; })
      .filter(Boolean);
    if (topSongs.length >= 3) {
      cards.push(
        '<div class="playlist-card smart-pl">' +
        '<div class="pl-thumb smart-pl-icon">&#128293;</div>' +
        '<div class="pl-info"><div class="pl-name">Most Played</div><div class="pl-count">' + topSongs.length + ' songs</div></div>' +
        '<div class="pl-actions">' +
        '<button class="btn-card btn-card-play" onclick="playSmartPlaylist(\'top\')"><span class=\"material-symbols-outlined\">play_arrow</span></button>' +
        '<button class="btn-card" onclick="shuffleSmartPlaylist(\'top\')"><span class=\"material-symbols-outlined\">shuffle</span></button>' +
        '</div></div>'
      );
    }
  }
  return cards.join('');
}

function playSmartPlaylist(type) {
  var ud = getUserData();
  if (type === 'recent') {
    if (ud.recentlyPlayed && ud.recentlyPlayed.length) playQueue(ud.recentlyPlayed, 0);
    return;
  }
  if (type === 'top') {
    var counts = ud.playCounts || {};
    var allSongs = ud.favorites.concat(ud.recentlyPlayed || []);
    var songMap = {};
    allSongs.forEach(function(s) { if (s && s.videoId && !songMap[s.videoId]) songMap[s.videoId] = s; });
    var topSongs = Object.keys(counts)
      .sort(function(a, b) { return counts[b] - counts[a]; })
      .slice(0, 20)
      .map(function(vid) { return songMap[vid]; })
      .filter(Boolean);
    if (topSongs.length) playQueue(topSongs, 0);
  }
}

function shuffleSmartPlaylist(type) {
  var saved = shuffleMode; shuffleMode = true;
  playSmartPlaylist(type);
  shuffleMode = saved;
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
    '<button class="btn-card btn-card-play" onclick="event.stopPropagation();playPlaylist(' + i + ')"><span class=\"material-symbols-outlined\">play_arrow</span></button>' +
    '<button class="btn-card" onclick="event.stopPropagation();shufflePlaylist(' + i + ')"><span class=\"material-symbols-outlined\">shuffle</span></button>' +
    '<button class="btn-card btn-danger" onclick="event.stopPropagation();deletePlaylist(' + i + ')"><span class=\"material-symbols-outlined\">close</span></button>' +
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
  showToast('Playlist created');
}

function deletePlaylist(i) {
  var ud = getUserData();
  ud.playlists.splice(i, 1);
  saveUserData(ud);
  renderPlaylists();
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
        var ds = safeJson(s);
        return '<div class="song-card">' +
          '<span class="pl-song-num">' + (j+1) + '</span>' +
          '<img class="song-card-thumb" src="' + esc(s.thumbnail) + '" alt="">' +
          '<div class="card-info"><div class="card-title">' + esc(s.title) + '</div>' +
          '<button class="artist-link" data-artist="' + esc(s.channel) + '" onclick="event.stopPropagation();searchArtist(this.dataset.artist)">' + esc(s.channel) + '</button></div>' +
          '<div class="card-actions">' +
          (window._unavailableIds && window._unavailableIds[s.videoId]
          ? '<span class="unavail-badge"><span class=\"material-symbols-outlined\">warning</span></span>' +
            '<button class="btn-card btn-fix" data-vid="' + esc(s.videoId) + '" data-title="' + esc(s.title) + '" data-ch="' + esc(s.channel) + '" onclick="fixUnavailableSong(this.dataset.vid,this.dataset.title,this.dataset.ch)"><span class=\"material-symbols-outlined\">find_replace</span></button>'
          : '') +
          '<button class="btn-card btn-card-play" data-song="' + ds + '" onclick="playSong(JSON.parse(this.dataset.song))"><span class=\"material-symbols-outlined\">play_arrow</span></button>' +
          '<button class="btn-card btn-danger" onclick="removeSongFromPlaylist(' + i + ',' + j + ')"><span class=\"material-symbols-outlined\">close</span></button>' +
          '</div></div>';
      }).join('')
    : '<div class="empty-state"><h3>Empty playlist</h3><p>Add songs using &quot;+ List&quot;.</p></div>';
  detail.innerHTML =
    '<div class="detail-header">' +
    '<button class="btn-back" onclick="switchTab(&quot;playlists&quot;)">&#8592; Playlists</button>' +
    '<h2>' + esc(pl.name) + '</h2>' +
    '<div class="detail-actions">' +
    '<button class="btn btn-sm-green" onclick="playPlaylist(' + i + ')"><span class=\"material-symbols-outlined\">play_arrow</span> Play All</button>' +
    '<button class="btn btn-sm-ghost" onclick="shufflePlaylist(' + i + ')"><span class=\"material-symbols-outlined\">shuffle</span> Shuffle</button>' +
    '</div></div><div class="songs-grid">' + songsHtml + '</div>';
}

function playPlaylist(i) {
  var ud = getUserData();
  var pl = ud.playlists[i];
  if (pl && pl.songs && pl.songs.length) playQueue(pl.songs, 0);
}

function shufflePlaylist(i) {
  var ud = getUserData();
  var pl = ud.playlists[i];
  if (!pl || !pl.songs || !pl.songs.length) return;
  var s = shuffleMode; shuffleMode = true;
  playQueue(pl.songs, 0);
  shuffleMode = s;
}

function removeSongFromPlaylist(pi, si) {
  var ud = getUserData();
  ud.playlists[pi].songs.splice(si, 1);
  saveUserData(ud);
  viewPlaylist(pi);
}

// ââ Modal âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function showAddToPlaylist(song) {
  var ud = getUserData();
  if (!ud.playlists.length) { showToast('Create a playlist first!'); switchTab('playlists'); return; }
  var modal = $('playlist-modal');
  modal.innerHTML =
    '<div class="modal-box" onclick="event.stopPropagation()">' +
    '<h3>Add to playlist</h3>' +
    ud.playlists.map(function(pl, i) {
      var alreadyIn = pl.songs.some(function(s) { return s.videoId === song.videoId; });
      return '<button class="modal-pl-btn' + (alreadyIn ? ' modal-pl-has' : '') + '" data-song="' + safeJson(song) + '" data-pli="' + i +
        '" onclick="addSongToPlaylist(parseInt(this.dataset.pli),JSON.parse(this.dataset.song))">' +
        esc(pl.name) + ' <span class="modal-count">(' + pl.songs.length + ')</span>' +
        (alreadyIn ? ' <span class="modal-dup">\u2713</span>' : '') +
        '</button>';
    }).join('') +
    '<button class="btn-card btn-danger modal-cancel" onclick="closeModal()">Cancel</button></div>';
  modal.style.display = 'flex';
}

function addSongToPlaylist(pi, song) {
  var ud = getUserData();
  var pl = ud.playlists[pi];
  if (!pl.songs.some(function(s) { return s.videoId === song.videoId; })) {
    pl.songs.push(song);
    saveUserData(ud);
    showToast('Added to ' + pl.name);
  } else {
    showToast('Already in ' + pl.name);
  }
  closeModal();
}

function closeModal() { $('playlist-modal').style.display = 'none'; }

// ââ Keyboard ââââââââââââââââââââââââââââââââââââââââââââââââââââââ

document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
  if (e.code === 'ArrowRight') advanceQueue(1);
  if (e.code === 'ArrowLeft') advanceQueue(-1);
  if (e.code === 'KeyS') toggleShuffle();
  if (e.code === 'KeyR') toggleRepeat();
});


// ââ Init ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

fetch('/api/firebase-config')
  .then(function(r) { return r.json(); })
  .then(function(cfg) {
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db   = firebase.firestore();
    initAuth();
  })
  .catch(function(err) { console.error('Firebase config load failed:', err); });

// ── Artist Radio Badge ──────────────────────────────────────────
function setRadioBadge(text) {
  var badge = $('radio-badge');
  if (!badge) return;
  badge.textContent = text;
  badge.style.display = text ? 'block' : 'none';
}

// ── Availability Check ─────────────────────────────────────────
window._unavailableIds = {};

function checkLibraryAvailability() {
  var ud = getUserData();
  var allSongs = (ud.favorites || []).slice();
  (ud.playlists || []).forEach(function(pl) {
    allSongs = allSongs.concat(pl.songs || []);
  });
  var ids = [];
  var seen = {};
  allSongs.forEach(function(s) {
    if (s && s.videoId && !seen[s.videoId]) { ids.push(s.videoId); seen[s.videoId] = true; }
  });
  if (!ids.length) return;

  // Check in batches of 50
  var batches = [];
  for (var i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));

  Promise.all(batches.map(function(batch) {
    return fetch('/api/check?ids=' + batch.join(','))
      .then(function(r) { return r.json(); })
      .catch(function() { return { available: {} }; });
  })).then(function(results) {
    var unavailable = {};
    results.forEach(function(res) {
      Object.keys(res.available || {}).forEach(function(id) {
        if (!res.available[id]) unavailable[id] = true;
      });
    });
    window._unavailableIds = unavailable;
    var count = Object.keys(unavailable).length;
    if (count > 0) {
      // Re-render active view to show badges
      if ($('favorites-view') && $('favorites-view').style.display !== 'none') renderFavorites();
      if ($('playlists-view') && $('playlists-view').style.display !== 'none') renderPlaylists();
      showToast(count + ' song' + (count > 1 ? 's' : '') + ' unavailable in your library');
    }
  });
}

// ── Fallback Search ────────────────────────────────────────────
function fixUnavailableSong(videoId, title, channel) {
  var query = (channel ? channel + ' - ' : '') + title;
  showToast('Finding replacement…');
  fetch('/api/search?q=' + encodeURIComponent(query))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var alt = (data.items || []).find(function(item) {
        return item.id && item.id.videoId && item.id.videoId !== videoId;
      });
      if (!alt) { showToast('No replacement found'); return; }
      var newSong = {
        videoId: alt.id.videoId,
        title: alt.snippet.title,
        thumbnail: ((alt.snippet.thumbnails.medium || alt.snippet.thumbnails.default) || {}).url || '',
        channel: alt.snippet.channelTitle
      };
      var ud = getUserData();
      // Replace in favorites
      var fi = (ud.favorites || []).findIndex(function(s) { return s.videoId === videoId; });
      if (fi >= 0) ud.favorites[fi] = newSong;
      // Replace in all playlists
      (ud.playlists || []).forEach(function(pl) {
        var pi = (pl.songs || []).findIndex(function(s) { return s.videoId === videoId; });
        if (pi >= 0) pl.songs[pi] = newSong;
      });
      saveUserData(ud);
      delete window._unavailableIds[videoId];
      showToast('Replaced: ' + newSong.title.substring(0, 35) + '…');
      renderFavorites();
    })
    .catch(function() { showToast('Could not find replacement'); });
}


// ─── Video expand overlay ───
// backdrop-filter on #player-bar creates a containing block that breaks fixed
// positioning for children. Fix: teleport #yt-thumb to <body> when expanding.
function toggleVideoExpand() {
  var thumb = document.getElementById('yt-thumb');
  if (!document.body.classList.contains('video-expanded')) {
    thumb._origParent = thumb.parentElement;
    thumb._origNext   = thumb.nextSibling;
    document.body.appendChild(thumb);
    document.body.classList.add('video-expanded');
  } else {
    toggleVideoExpand();
    if (thumb._origParent) {
      thumb._origParent.insertBefore(thumb, thumb._origNext || null);
    }
  }
}

(function() {
  var thumb = document.getElementById('yt-thumb');
  if (thumb) {
    thumb.addEventListener('click', function() {
      if (!document.body.classList.contains('video-expanded')) {
        toggleVideoExpand();
      }
    });
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.body.classList.contains('video-expanded')) {
      document.body.classList.remove('video-expanded');
    }
  });
})();
