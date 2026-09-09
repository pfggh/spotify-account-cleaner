import { SpotifyAuth, SpotifyApiClient } from './spotifyApi.js';
import { exportLibraryToCsv } from './csvExport.js';

let auth;
let api;
let currentUserId = 'spotify_user';

// State holding fetched items
const inventory = {
  tracks: [],
  playlists: [],
  albums: [],
  artists: [],
  episodes: [],
  shows: []
};

// DOM Elements
const CLIENT_ID = '4007674e2eb842958dd17309b805cd69';
const redirectUri = window.location.origin + window.location.pathname;

auth = new SpotifyAuth(CLIENT_ID, redirectUri);
api = new SpotifyApiClient(auth);

function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  
  let colorClass = 'text-slate-400';
  if (type === 'success') colorClass = 'text-emerald-400 font-semibold';
  if (type === 'warning') colorClass = 'text-amber-300';
  if (type === 'error') colorClass = 'text-rose-400 font-bold';
  if (type === 'highlight') colorClass = 'text-white font-bold';

  line.className = colorClass;
  line.innerHTML = `<span class="text-slate-600">[${time}]</span> ${message}`;
  
  if (logWindow) {
    logWindow.appendChild(line);
    logWindow.scrollTop = logWindow.scrollHeight;
  }
}

api.onLog = log;

// Initialize application
async function init() {
  // 1. Check for token in URL hash (Implicit Grant response_type=token)
  if (window.location.hash && window.location.hash.includes('access_token=')) {
    log('OAuth implicit token received from Spotify. Saving credentials...', 'info');
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const expiresIn = hashParams.get('expires_in');

    if (accessToken) {
      const expiresAt = Date.now() + (parseInt(expiresIn || '3600', 10) * 1000);
      window.localStorage.setItem('spotify_access_token', accessToken);
      window.localStorage.setItem('spotify_token_expires_at', expiresAt.toString());
      // Clean hash from address bar
      window.history.replaceState({}, document.title, window.location.pathname);
      log('Successfully authenticated with Spotify!', 'success');
    }
  }

  // 2. Check for OAuth Redirect Code (PKCE / Authorization Code)
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    log('OAuth code received. Exchanging for access token...', 'info');
    try {
      await auth.handleCallback(code);
      log('Successfully authenticated with Spotify!', 'success');
    } catch (e) {
      log(`Authentication error: ${e.message}`, 'error');
    }
  }

  // Check login state
  const token = await auth.getAccessToken();
  if (token) {
    await setupLoggedInUser();
  } else {
    showAuthCard();
  }
}

function showAuthCard() {
  if (cardAuth) cardAuth.classList.remove('hidden');
  if (cardDashboard) cardDashboard.classList.add('hidden');
  if (userProfile) userProfile.classList.add('hidden');
}

async function setupLoggedInUser() {
  if (cardAuth) cardAuth.classList.add('hidden');
  if (cardDashboard) cardDashboard.classList.remove('hidden');
  if (userProfile) userProfile.classList.remove('hidden');

  try {
    const user = await api.getCurrentUser();
    currentUserId = user.id || 'spotify_user';
    if (userName) userName.textContent = user.display_name || user.id;
    if (user.images && user.images.length > 0 && userAvatar) {
      userAvatar.src = user.images[0].url;
    } else if (userAvatar) {
      userAvatar.src = 'https://picsum.photos/32';
    }
    log(`Logged in as Spotify user: ${user.display_name} (${user.id})`, 'success');
    
    // Auto scan on login
    scanAccount();
  } catch (e) {
    if (e.message.includes('403')) {
      log(`HTTP 403 Error: Your Spotify Account is not whitelisted in Spotify Developer Dashboard!`, 'error');
      log(`Fix: Go to Developer Dashboard -> Your App -> User Management (Users & Access) and add your Spotify email address.`, 'warning');
    } else {
      log(`Error fetching user profile: ${e.message}`, 'error');
    }
    auth.logout();
    showAuthCard();
  }
}

// Event Listeners
if (btnLogin) {
  btnLogin.addEventListener('click', (e) => {
    e.preventDefault();
    auth.clientId = CLIENT_ID;
    auth.redirectUri = window.location.origin + window.location.pathname;
    auth.redirectToAuth();
  });
}

btnLogout.addEventListener('click', () => {
  auth.logout();
  showAuthCard();
  log('Logged out of Spotify.', 'info');
});

btnClearLog.addEventListener('click', () => {
  logWindow.innerHTML = '';
});

btnExportCsv.addEventListener('click', () => {
  const total = Object.values(inventory).reduce((acc, arr) => acc + arr.length, 0);
  if (total === 0) {
    alert('No items scanned yet. Please click "Scan Account" first to load your library.');
    return;
  }
  log(`Exporting CSV backup for ${total} items...`, 'highlight');
  exportLibraryToCsv(inventory, currentUserId);
  log(`CSV export generated and downloaded successfully!`, 'success');
});

btnScan.addEventListener('click', scanAccount);

function animateCounter(element, targetVal) {
  let startVal = parseInt(element.textContent || '0', 10);
  if (isNaN(startVal)) startVal = 0;
  const duration = 600;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.floor(startVal + (targetVal - startVal) * progress);
    element.textContent = current;
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  requestAnimationFrame(update);
}

async function scanAccount() {
  scanBtnSpinner.classList.remove('hidden');
  scanBtnText.textContent = 'Scanning...';
  btnScan.disabled = true;

  log('--- Starting Account Inventory Scan ---', 'highlight');

  try {
    log('Fetching Liked Songs...', 'info');
    inventory.tracks = await api.getLikedTracks();
    animateCounter(countTracks, inventory.tracks.length);

    log('Fetching Playlists...', 'info');
    inventory.playlists = await api.getPlaylists();
    animateCounter(countPlaylists, inventory.playlists.length);

    log('Fetching Saved Albums...', 'info');
    inventory.albums = await api.getSavedAlbums();
    animateCounter(countAlbums, inventory.albums.length);

    log('Fetching Followed Artists...', 'info');
    inventory.artists = await api.getFollowedArtists();
    animateCounter(countArtists, inventory.artists.length);

    log('Fetching Saved Episodes...', 'info');
    inventory.episodes = await api.getSavedEpisodes();
    animateCounter(countEpisodes, inventory.episodes.length);

    log('Fetching Saved Shows...', 'info');
    inventory.shows = await api.getSavedShows();
    animateCounter(countShows, inventory.shows.length);

    const total = Object.values(inventory).reduce((acc, arr) => acc + arr.length, 0);
    log(`Scan complete! Found ${total} total items across your Spotify account.`, 'success');

  } catch (e) {
    log(`Error during account scan: ${e.message}`, 'error');
  } finally {
    scanBtnSpinner.classList.add('hidden');
    scanBtnText.textContent = 'Scan Account';
    btnScan.disabled = false;
  }
}

// Trigger Wiping Process
btnTriggerClean.addEventListener('click', () => {
  const totalToDelete = getSelectedTotalCount();
  if (totalToDelete === 0) {
    alert('No items selected or found to wipe. Please scan your account and select items.');
    return;
  }

  modalTotalCount.textContent = totalToDelete;
  inputConfirmText.value = '';
  btnModalConfirm.disabled = true;
  modalConfirm.classList.remove('hidden');
});

inputConfirmText.addEventListener('input', (e) => {
  if (e.target.value.trim() === 'DELETE EVERYTHING') {
    btnModalConfirm.disabled = false;
  } else {
    btnModalConfirm.disabled = true;
  }
});

btnModalCancel.addEventListener('click', () => {
  modalConfirm.classList.add('hidden');
});

btnModalConfirm.addEventListener('click', async () => {
  modalConfirm.classList.add('hidden');
  await executeCleanup();
});

function getSelectedTotalCount() {
  let count = 0;
  if (chkTracks.checked) count += inventory.tracks.length;
  if (chkPlaylists.checked) count += inventory.playlists.length;
  if (chkAlbums.checked) count += inventory.albums.length;
  if (chkArtists.checked) count += inventory.artists.length;
  if (chkEpisodes.checked) count += inventory.episodes.length;
  if (chkShows.checked) count += inventory.shows.length;
  return count;
}

async function executeCleanup() {
  const totalItems = getSelectedTotalCount();
  let itemsProcessed = 0;

  progressContainer.classList.remove('hidden');
  btnTriggerClean.disabled = true;
  btnScan.disabled = true;

  log('==============================================', 'highlight');
  log(`STARTING ACCOUNT CLEANUP FOR ${totalItems} ITEMS`, 'highlight');
  log('==============================================', 'highlight');

  function updateProgress(processed, categoryTotal, categoryName) {
    const totalProcessed = itemsProcessed + processed;
    const pct = Math.round((totalProcessed / totalItems) * 100);
    progressBar.style.width = `${pct}%`;
    progressPercentage.textContent = `${pct}%`;
    progressStatus.textContent = `Deleting ${categoryName} (${processed}/${categoryTotal})...`;
  }

  try {
    // 1. Liked Tracks
    if (chkTracks.checked && inventory.tracks.length > 0) {
      log(`Removing ${inventory.tracks.length} Liked Songs...`, 'info');
      const trackIds = inventory.tracks.map(t => t.track?.id || t.id).filter(Boolean);
      await api.deleteLikedTracks(trackIds, (done, total) => {
        updateProgress(done, total, 'Liked Songs');
        log(`Liked Songs: deleted ${done}/${total}`, 'info');
      });
      itemsProcessed += inventory.tracks.length;
      log('All Liked Songs removed!', 'success');
    }

    // 2. Playlists
    if (chkPlaylists.checked && inventory.playlists.length > 0) {
      log(`Unfollowing/deleting ${inventory.playlists.length} Playlists...`, 'info');
      const playlistIds = inventory.playlists.map(p => p.id).filter(Boolean);
      await api.unfollowPlaylists(playlistIds, (done, total) => {
        updateProgress(done, total, 'Playlists');
        log(`Playlists: unfollowed ${done}/${total}`, 'info');
      });
      itemsProcessed += inventory.playlists.length;
      log('All Playlists removed!', 'success');
    }

    // 3. Albums
    if (chkAlbums.checked && inventory.albums.length > 0) {
      log(`Removing ${inventory.albums.length} Saved Albums...`, 'info');
      const albumIds = inventory.albums.map(a => a.album?.id || a.id).filter(Boolean);
      await api.deleteSavedAlbums(albumIds, (done, total) => {
        updateProgress(done, total, 'Albums');
        log(`Albums: deleted ${done}/${total}`, 'info');
      });
      itemsProcessed += inventory.albums.length;
      log('All Saved Albums removed!', 'success');
    }

    // 4. Artists
    if (chkArtists.checked && inventory.artists.length > 0) {
      log(`Unfollowing ${inventory.artists.length} Followed Artists...`, 'info');
      const artistIds = inventory.artists.map(a => a.id).filter(Boolean);
      await api.unfollowArtists(artistIds, (done, total) => {
        updateProgress(done, total, 'Artists');
        log(`Artists: unfollowed ${done}/${total}`, 'info');
      });
      itemsProcessed += inventory.artists.length;
      log('All Followed Artists removed!', 'success');
    }

    // 5. Episodes
    if (chkEpisodes.checked && inventory.episodes.length > 0) {
      log(`Removing ${inventory.episodes.length} Saved Episodes...`, 'info');
      const epIds = inventory.episodes.map(e => e.episode?.id || e.id).filter(Boolean);
      await api.deleteSavedEpisodes(epIds, (done, total) => {
        updateProgress(done, total, 'Episodes');
        log(`Episodes: deleted ${done}/${total}`, 'info');
      });
      itemsProcessed += inventory.episodes.length;
      log('All Saved Episodes removed!', 'success');
    }

    // 6. Shows
    if (chkShows.checked && inventory.shows.length > 0) {
      log(`Removing ${inventory.shows.length} Saved Shows/Podcasts...`, 'info');
      const showIds = inventory.shows.map(s => s.show?.id || s.id).filter(Boolean);
      await api.deleteSavedShows(showIds, (done, total) => {
        updateProgress(done, total, 'Shows');
        log(`Shows: deleted ${done}/${total}`, 'info');
      });
      itemsProcessed += inventory.shows.length;
      log('All Saved Shows removed!', 'success');
    }

    progressBar.style.width = '100%';
    progressPercentage.textContent = '100%';
    progressStatus.textContent = 'Cleanup Complete!';
    
    log('==============================================', 'highlight');
    log('SUCCESS! All selected content removed from Spotify.', 'success');
    log('==============================================', 'highlight');

    // Re-scan to update counts to 0
    await scanAccount();

  } catch (e) {
    log(`CRITICAL ERROR during cleanup: ${e.message}`, 'error');
  } finally {
    btnTriggerClean.disabled = false;
    btnScan.disabled = false;
  }
}

// Start app
init();
