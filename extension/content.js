(function () {
  'use strict';

  if (window.__SPOTIFY_PURGE_LOADED__) return;
  window.__SPOTIFY_PURGE_LOADED__ = true;

  console.log('[Spotify Purge Chrome Extension] Loaded on open.spotify.com');

  let isRunning = false;

  async function getSessionToken() {
    try {
      const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.accessToken) {
          return data.accessToken;
        }
      }
    } catch (e) {
      console.warn('[Spotify Purge Extension] Session token fetch error:', e);
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('token') || key.includes('session'))) {
        try {
          const val = JSON.parse(localStorage.getItem(key));
          if (val && val.accessToken) return val.accessToken;
        } catch (e) {}
      }
    }

    return null;
  }

  async function apiRequest(endpoint, method = 'GET', body = null, token) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: method,
      headers: headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null
    });

    if (res.status === 204) return {};
    if (!res.ok) {
      const errText = await res.text();
      let msg = `HTTP ${res.status} ${res.statusText}`;
      try {
        const parsed = JSON.parse(errText);
        msg = parsed.error?.message || msg;
      } catch(e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  async function runAccountPurge(updateLog, updateProgress) {
    if (isRunning) return;
    isRunning = true;

    try {
      updateLog('🔑 Extracting active Spotify session token...', 'info');
      const webToken = await getSessionToken();

      if (!webToken) {
        throw new Error('Could not find active session token! Make sure you are logged in to open.spotify.com.');
      }

      updateLog('✅ Session authenticated successfully!', 'success');

      const user = await apiRequest('/me', 'GET', null, webToken);
      updateLog(`👤 Wiping account for user: ${user.display_name || user.id} (${user.id})`, 'success');

      // 1. Liked Songs Purge
      updateLog('🔍 Fetching Liked Songs...', 'info');
      let likedTracks = [];
      let nextUrl = '/me/tracks?limit=50';
      while (nextUrl) {
        const res = await apiRequest(nextUrl, 'GET', null, webToken);
        if (!res || !res.items) break;
        likedTracks = likedTracks.concat(res.items);
        nextUrl = res.next;
      }

      updateLog(`📊 Found ${likedTracks.length} Liked Songs. Deleting...`, 'highlight');
      if (likedTracks.length > 0) {
        const trackUris = likedTracks.map(item => item.track?.uri || `spotify:track:${item.track?.id}`).filter(Boolean);
        for (let i = 0; i < trackUris.length; i += 50) {
          const batch = trackUris.slice(i, i + 50);
          updateProgress(i, trackUris.length, 'Liked Songs');
          try {
            await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, webToken);
            updateLog(`✔ Deleted batch ${Math.floor(i / 50) + 1} (${Math.min(i + 50, trackUris.length)}/${trackUris.length})`, 'info');
          } catch (e) {
            updateLog(`⚠️ Batch fallback active: ${e.message}`, 'warning');
            for (const singleUri of batch) {
              try {
                await apiRequest(`/me/library?uris=${encodeURIComponent(singleUri)}`, 'DELETE', null, webToken);
              } catch (err) {}
            }
          }
        }
        updateProgress(trackUris.length, trackUris.length, 'Liked Songs');
        updateLog('✨ All Liked Songs deleted!', 'success');
      }

      // 2. Saved Albums Purge
      updateLog('🔍 Fetching Saved Albums...', 'info');
      let savedAlbums = [];
      let albumUrl = '/me/albums?limit=50';
      while (albumUrl) {
        const res = await apiRequest(albumUrl, 'GET', null, webToken);
        if (!res || !res.items) break;
        savedAlbums = savedAlbums.concat(res.items);
        albumUrl = res.next;
      }

      updateLog(`📊 Found ${savedAlbums.length} Saved Albums. Deleting...`, 'highlight');
      if (savedAlbums.length > 0) {
        const albumUris = savedAlbums.map(item => item.album?.uri || `spotify:album:${item.album?.id}`).filter(Boolean);
        for (let i = 0; i < albumUris.length; i += 50) {
          const batch = albumUris.slice(i, i + 50);
          try {
            await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, webToken);
          } catch (e) {
            for (const singleUri of batch) {
              try {
                await apiRequest(`/me/library?uris=${encodeURIComponent(singleUri)}`, 'DELETE', null, webToken);
              } catch (err) {}
            }
          }
        }
        updateLog('✨ All Saved Albums deleted!', 'success');
      }

      // 3. Playlists Purge
      updateLog('🔍 Fetching Playlists...', 'info');
      let playlists = [];
      let playlistUrl = '/me/playlists?limit=50';
      while (playlistUrl) {
        const res = await apiRequest(playlistUrl, 'GET', null, webToken);
        if (!res || !res.items) break;
        playlists = playlists.concat(res.items);
        playlistUrl = res.next;
      }

      updateLog(`📊 Found ${playlists.length} Playlists. Unfollowing...`, 'highlight');
      for (let i = 0; i < playlists.length; i++) {
        const p = playlists[i];
        try {
          await apiRequest(`/playlists/${p.id}/followers`, 'DELETE', null, webToken);
          updateLog(`✔ Unfollowed: ${p.name}`, 'info');
        } catch (e) {
          updateLog(`Could not unfollow ${p.name}: ${e.message}`, 'warning');
        }
      }

      updateLog('🎉 SUCCESS! Spotify account library wiped clean!', 'success');
      alert('🎉 Spotify Purge Complete!\n\nAll Liked Songs, Saved Albums, and Playlists have been removed from your account.');
      location.reload();
    } catch (err) {
      updateLog(`❌ ERROR: ${err.message}`, 'error');
      alert(`Purge Error: ${err.message}`);
    } finally {
      isRunning = false;
    }
  }

  function injectFloatingUI() {
    if (document.getElementById('spotify-purge-extension-root')) return;

    const root = document.createElement('div');
    root.id = 'spotify-purge-extension-root';
    root.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    root.innerHTML = `
      <div id="purge-ext-panel" style="
        width: 360px;
        background: #121212;
        border: 1px solid #282828;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.8);
        color: #ffffff;
        display: none;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #282828; padding-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #1db954;">
            <span>⚡ Spotify Purge Extension</span>
          </div>
          <button id="btn-ext-close" style="background: none; border: none; color: #b3b3b3; cursor: pointer; font-size: 16px;">✕</button>
        </div>

        <p style="font-size: 12px; color: #b3b3b3; margin: 0;">
          Battle-tested Chrome Extension. Wipes all Liked Songs, Saved Albums & Playlists.
        </p>

        <div id="purge-ext-progress" style="width: 100%; background: #282828; height: 6px; border-radius: 3px; overflow: hidden; display: none;">
          <div id="purge-ext-fill" style="width: 0%; height: 100%; background: #1db954; transition: width 0.2s;"></div>
        </div>

        <div id="purge-ext-logs" style="
          height: 130px;
          background: #000000;
          border: 1px solid #282828;
          border-radius: 8px;
          padding: 8px;
          font-family: monospace;
          font-size: 11px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        ">
          <div style="color: #666;">[Extension Ready. Click "START PURGE" to wipe account.]</div>
        </div>

        <button id="btn-ext-start" style="
          width: 100%;
          background: #1db954;
          border: none;
          color: #000000;
          font-weight: 700;
          font-size: 13px;
          padding: 10px;
          border-radius: 8px;
          cursor: pointer;
        ">🔥 START PURGE</button>
      </div>

      <button id="btn-ext-toggle" style="
        background: #1db954;
        color: #000000;
        border: none;
        font-weight: 700;
        font-size: 13px;
        padding: 10px 18px;
        border-radius: 50px;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(0,0,0,0.5);
      ">⚡ Spotify Purge</button>
    `;

    document.body.appendChild(root);

    const panel = document.getElementById('purge-ext-panel');
    const toggleBtn = document.getElementById('btn-ext-toggle');
    const closeBtn = document.getElementById('btn-ext-close');
    const startBtn = document.getElementById('btn-ext-start');
    const logsBox = document.getElementById('purge-ext-logs');
    const progressWrap = document.getElementById('purge-ext-progress');
    const progressFill = document.getElementById('purge-ext-fill');

    toggleBtn.onclick = () => {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    };

    closeBtn.onclick = () => {
      panel.style.display = 'none';
    };

    function addLog(msg, type = 'info') {
      const line = document.createElement('div');
      const time = new Date().toLocaleTimeString();
      let color = '#b3b3b3';
      if (type === 'success') color = '#1db954';
      if (type === 'warning') color = '#f59e0b';
      if (type === 'error') color = '#ef4444';
      if (type === 'highlight') color = '#ffffff';

      line.style.color = color;
      line.innerHTML = `<span style="color: #666;">[${time}]</span> ${msg}`;
      logsBox.appendChild(line);
      logsBox.scrollTop = logsBox.scrollHeight;
    }

    function updateProgress(done, total) {
      progressWrap.style.display = 'block';
      const pct = Math.round((done / total) * 100);
      progressFill.style.width = `${pct}%`;
    }

    startBtn.onclick = () => {
      if (confirm('⚠️ Are you sure you want to permanently delete all Liked Songs, Saved Albums & Playlists?')) {
        startBtn.disabled = true;
        startBtn.style.opacity = '0.5';
        runAccountPurge(addLog, updateProgress).finally(() => {
          startBtn.disabled = false;
          startBtn.style.opacity = '1';
        });
      }
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectFloatingUI();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingUI);
  }
})();
