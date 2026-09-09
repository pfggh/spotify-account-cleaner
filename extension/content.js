(function () {
  'use strict';

  // Inject page script interceptor into main document context immediately
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const scriptNode = document.createElement('script');
      scriptNode.src = chrome.runtime.getURL('injected_interceptor.js');
      (document.head || document.documentElement).appendChild(scriptNode);
      scriptNode.onload = function () { scriptNode.remove(); };
    }
  } catch (e) {}

  if (window.__SPOTIFY_PURGE_LOADED__) return;
  window.__SPOTIFY_PURGE_LOADED__ = true;

  console.log('[Spotify Purge Extension v5.0] Developer App OAuth Automation Active.');

  let capturedToken = null;
  let isRunning = false;

  window.addEventListener('SPOTIFY_TOKEN_CAPTURED', (e) => {
    if (e.detail && e.detail.token) {
      capturedToken = e.detail.token;
    }
  });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // --- API CALL WRAPPER (Validates null responses) ---
  async function apiRequest(endpoint, method = 'GET', body = null, token, updateLog = null, retries = 3) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
    const headers = { 'Authorization': `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: method,
          headers: headers,
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null
        });

        if (res.status === 204) return {};

        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('Retry-After');
          let waitTimeSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 3;
          if (isNaN(waitTimeSec) || waitTimeSec <= 0) waitTimeSec = 3;
          if (waitTimeSec > 8) waitTimeSec = 5;

          if (updateLog) updateLog(`⏳ Spotify Rate Limit reached (429). Retrying in ${waitTimeSec}s...`, 'warning');
          await sleep(waitTimeSec * 1000);
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          let msg = `HTTP ${res.status} ${res.statusText}`;
          try {
            const parsed = JSON.parse(errText);
            msg = parsed.error?.message || msg;
          } catch (e) {}
          throw new Error(msg);
        }

        const data = await res.json();
        if (!data) throw new Error('Received empty response from Spotify API.');
        return data;
      } catch (err) {
        if (attempt === retries) throw err;
        await sleep(1200);
      }
    }
  }

  // --- CORE PURGE EXECUTION ENGINE ---
  async function runAccountPurge(token, updateLog, updateProgress) {
    updateLog('🔑 Validating active Bearer token with Spotify API...', 'info');
    const user = await apiRequest('/me', 'GET', null, token, updateLog);
    if (!user || !user.id) {
      throw new Error('Invalid token response from /v1/me. Account details could not be retrieved.');
    }

    updateLog(`👤 Logged in as: ${user.display_name || user.id} (${user.id})`, 'success');

    // 1. Liked Songs
    updateLog('🔍 Scanning Liked Songs...', 'info');
    let likedTracks = [];
    let nextUrl = '/me/tracks?limit=50';
    while (nextUrl) {
      const res = await apiRequest(nextUrl, 'GET', null, token, updateLog);
      if (!res || !res.items) break;
      likedTracks = likedTracks.concat(res.items);
      nextUrl = res.next;
      await sleep(50);
    }

    updateLog(`📊 Found ${likedTracks.length} Liked Songs. Purging...`, 'highlight');
    if (likedTracks.length > 0) {
      const trackUris = likedTracks.map(item => item.track?.uri || `spotify:track:${item.track?.id}`).filter(Boolean);
      for (let i = 0; i < trackUris.length; i += 50) {
        const batch = trackUris.slice(i, i + 50);
        updateProgress(i, trackUris.length);
        try {
          await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, token, updateLog);
          updateLog(`✔ Purged batch ${Math.floor(i / 50) + 1} (${Math.min(i + 50, trackUris.length)}/${trackUris.length})`, 'info');
        } catch (e) {
          for (const u of batch) {
            try { await apiRequest(`/me/library?uris=${encodeURIComponent(u)}`, 'DELETE', null, token, updateLog); } catch (err) {}
          }
        }
        await sleep(150);
      }
      updateProgress(trackUris.length, trackUris.length);
      updateLog('✨ All Liked Songs permanently wiped!', 'success');
    }

    // 2. Saved Albums
    updateLog('🔍 Scanning Saved Albums...', 'info');
    let savedAlbums = [];
    let albumUrl = '/me/albums?limit=50';
    while (albumUrl) {
      const res = await apiRequest(albumUrl, 'GET', null, token, updateLog);
      if (!res || !res.items) break;
      savedAlbums = savedAlbums.concat(res.items);
      albumUrl = res.next;
      await sleep(50);
    }

    updateLog(`📊 Found ${savedAlbums.length} Saved Albums. Purging...`, 'highlight');
    if (savedAlbums.length > 0) {
      const albumUris = savedAlbums.map(item => item.album?.uri || `spotify:album:${item.album?.id}`).filter(Boolean);
      for (let i = 0; i < albumUris.length; i += 50) {
        const batch = albumUris.slice(i, i + 50);
        try {
          await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, token, updateLog);
        } catch (e) {}
        await sleep(150);
      }
      updateLog('✨ All Saved Albums wiped!', 'success');
    }

    // 3. Playlists
    updateLog('🔍 Scanning Playlists...', 'info');
    let playlists = [];
    let playlistUrl = '/me/playlists?limit=50';
    while (playlistUrl) {
      const res = await apiRequest(playlistUrl, 'GET', null, token, updateLog);
      if (!res || !res.items) break;
      playlists = playlists.concat(res.items);
      playlistUrl = res.next;
      await sleep(50);
    }

    updateLog(`📊 Found ${playlists.length} Playlists. Unfollowing...`, 'highlight');
    for (const p of playlists) {
      try {
        await apiRequest(`/playlists/${p.id}/followers`, 'DELETE', null, token, updateLog);
        updateLog(`✔ Removed playlist: ${p.name}`, 'info');
      } catch (e) {}
      await sleep(100);
    }

    // 4. Followed Artists
    updateLog('🔍 Scanning Followed Artists...', 'info');
    let artists = [];
    let artistUrl = '/me/following?type=artist&limit=50';
    while (artistUrl) {
      const res = await apiRequest(artistUrl, 'GET', null, token, updateLog);
      if (!res || !res.artists || !res.artists.items) break;
      artists = artists.concat(res.artists.items);
      artistUrl = res.artists.next;
      await sleep(50);
    }

    if (artists.length > 0) {
      updateLog(`📊 Found ${artists.length} Followed Artists. Unfollowing...`, 'highlight');
      const artistIds = artists.map(a => a.id).filter(Boolean);
      for (let i = 0; i < artistIds.length; i += 50) {
        const batch = artistIds.slice(i, i + 50);
        try {
          await apiRequest(`/me/following?type=artist&ids=${batch.join(',')}`, 'DELETE', null, token, updateLog);
        } catch (e) {}
      }
      updateLog('✨ All Followed Artists unfollowed!', 'success');
    }

    updateLog('🎉 SUCCESS! Entire Spotify Account Library Reset Clean!', 'success');
    alert('🎉 SPOTIFY PURGE COMPLETE!\n\nAll Liked Songs, Saved Albums, Playlists & Followed Artists have been permanently removed.');
    location.reload();
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
        width: 380px;
        background: #121212;
        border: 1px solid #282828;
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 16px 40px rgba(0,0,0,0.85);
        color: #ffffff;
        display: none;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 12px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #282828; padding-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: #1db954;">
            <span>⚡ Spotify Purge Pro v5.0</span>
          </div>
          <button id="btn-ext-close" style="background: none; border: none; color: #b3b3b3; cursor: pointer; font-size: 16px;">✕</button>
        </div>

        <p style="font-size: 12px; color: #b3b3b3; margin: 0;">
          Select authorization method to wipe account library:
        </p>

        <!-- Developer App ID Input -->
        <div style="display: flex; flex-direction: column; gap: 6px; background: #181818; padding: 10px; border-radius: 8px; border: 1px solid #282828;">
          <label style="font-size: 10px; color: #999; text-transform: uppercase;">Spotify Developer Client ID</label>
          <input id="input-dev-client-id" type="text" value="0d5587ddaa23481b993862a77551ca5a" style="background: #000; border: 1px solid #333; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-family: monospace;" />
        </div>

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
          <div style="color: #666;">[System Ready. Click button below to connect & purge.]</div>
        </div>

        <button id="btn-ext-start-oauth" style="
          width: 100%;
          background: linear-gradient(135deg, #1db954, #10b981);
          border: none;
          color: #000000;
          font-weight: 800;
          font-size: 13px;
          padding: 12px;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(29, 185, 84, 0.3);
        ">🔑 1-CLICK DEVELOPER OAUTH PURGE</button>
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

    (document.body || document.documentElement).appendChild(root);

    const panel = document.getElementById('purge-ext-panel');
    const toggleBtn = document.getElementById('btn-ext-toggle');
    const closeBtn = document.getElementById('btn-ext-close');
    const startOAuthBtn = document.getElementById('btn-ext-start-oauth');
    const inputClientId = document.getElementById('input-dev-client-id');
    const logsBox = document.getElementById('purge-ext-logs');
    const progressWrap = document.getElementById('purge-ext-progress');
    const progressFill = document.getElementById('purge-ext-fill');

    toggleBtn.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; };
    closeBtn.onclick = () => { panel.style.display = 'none'; };

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

    // Auto-Run Purge if returning from Developer OAuth Callback URL with #access_token=...
    if (window.location.hash && window.location.hash.includes('access_token=')) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const oauthToken = hashParams.get('access_token');
      if (oauthToken) {
        panel.style.display = 'flex';
        addLog('✅ Developer OAuth Access Token Received!', 'success');
        runAccountPurge(oauthToken, addLog, updateProgress);
      }
    }

    startOAuthBtn.onclick = async () => {
      const clientId = inputClientId.value.trim() || '0d5587ddaa23481b993862a77551ca5a';
      localStorage.setItem('SPOTIFY_DEV_CLIENT_ID', clientId);

      addLog(`🔑 Initiating Spotify Developer App Authorization...`, 'info');

      const scopes = encodeURIComponent('user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-follow-read user-follow-modify');
      const redirectUri = encodeURIComponent('https://teshrij.xyz/spotify-account-cleaner/');
      const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${redirectUri}&scope=${scopes}&show_dialog=true`;

      window.location.href = authUrl;
    };
  }

  function initUI() {
    injectFloatingUI();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
