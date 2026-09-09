(function () {
  'use strict';

  // Injected Page Interceptor for fetching Bearer token from page context
  const scriptNode = document.createElement('script');
  scriptNode.src = chrome.runtime.getURL('injected_interceptor.js');
  (document.head || document.documentElement).appendChild(scriptNode);
  scriptNode.onload = function () {
    scriptNode.remove();
  };

  if (window.__SPOTIFY_PURGE_LOADED__) return;
  window.__SPOTIFY_PURGE_LOADED__ = true;

  console.log('[Spotify Purge v3.0] Automated Developer OAuth & Token Engine Loaded.');

  let capturedToken = null;
  let isRunning = false;

  window.addEventListener('SPOTIFY_TOKEN_CAPTURED', (e) => {
    if (e.detail && e.detail.token) {
      capturedToken = e.detail.token;
    }
  });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Mode 1: Quick Web Session / Interceptor Token
  async function getSessionToken() {
    if (capturedToken) return capturedToken;
    if (window.__SPOTIFY_CAPTURED_TOKEN__) return window.__SPOTIFY_CAPTURED_TOKEN__;

    try {
      const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.accessToken) return data.accessToken;
      }
    } catch (e) {}

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

  // API Call Wrapper
  async function apiRequest(endpoint, method = 'GET', body = null, token) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
    const headers = { 'Authorization': `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';

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
      } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  // Core Purge Execution Engine
  async function runAccountPurge(token, updateLog, updateProgress) {
    const user = await apiRequest('/me', 'GET', null, token);
    updateLog(`👤 Target Account: ${user.display_name || user.id} (${user.id})`, 'success');

    // 1. Liked Songs
    updateLog('🔍 Fetching Liked Songs...', 'info');
    let likedTracks = [];
    let nextUrl = '/me/tracks?limit=50';
    while (nextUrl) {
      const res = await apiRequest(nextUrl, 'GET', null, token);
      if (!res || !res.items) break;
      likedTracks = likedTracks.concat(res.items);
      nextUrl = res.next;
      await sleep(50);
    }

    updateLog(`📊 Found ${likedTracks.length} Liked Songs. Deleting...`, 'highlight');
    if (likedTracks.length > 0) {
      const trackUris = likedTracks.map(item => item.track?.uri || `spotify:track:${item.track?.id}`).filter(Boolean);
      for (let i = 0; i < trackUris.length; i += 50) {
        const batch = trackUris.slice(i, i + 50);
        updateProgress(i, trackUris.length);
        try {
          await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, token);
          updateLog(`✔ Deleted batch ${Math.floor(i / 50) + 1} (${Math.min(i + 50, trackUris.length)}/${trackUris.length})`, 'info');
        } catch (e) {
          for (const u of batch) {
            try { await apiRequest(`/me/library?uris=${encodeURIComponent(u)}`, 'DELETE', null, token); } catch (err) {}
          }
        }
        await sleep(150);
      }
      updateProgress(trackUris.length, trackUris.length);
      updateLog('✨ All Liked Songs deleted!', 'success');
    }

    // 2. Saved Albums
    updateLog('🔍 Fetching Saved Albums...', 'info');
    let savedAlbums = [];
    let albumUrl = '/me/albums?limit=50';
    while (albumUrl) {
      const res = await apiRequest(albumUrl, 'GET', null, token);
      if (!res || !res.items) break;
      savedAlbums = savedAlbums.concat(res.items);
      albumUrl = res.next;
      await sleep(50);
    }

    updateLog(`📊 Found ${savedAlbums.length} Saved Albums. Deleting...`, 'highlight');
    if (savedAlbums.length > 0) {
      const albumUris = savedAlbums.map(item => item.album?.uri || `spotify:album:${item.album?.id}`).filter(Boolean);
      for (let i = 0; i < albumUris.length; i += 50) {
        const batch = albumUris.slice(i, i + 50);
        try {
          await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, token);
        } catch (e) {}
        await sleep(150);
      }
      updateLog('✨ All Saved Albums deleted!', 'success');
    }

    // 3. Playlists
    updateLog('🔍 Fetching Playlists...', 'info');
    let playlists = [];
    let playlistUrl = '/me/playlists?limit=50';
    while (playlistUrl) {
      const res = await apiRequest(playlistUrl, 'GET', null, token);
      if (!res || !res.items) break;
      playlists = playlists.concat(res.items);
      playlistUrl = res.next;
      await sleep(50);
    }

    updateLog(`📊 Found ${playlists.length} Playlists. Unfollowing...`, 'highlight');
    for (const p of playlists) {
      try {
        await apiRequest(`/playlists/${p.id}/followers`, 'DELETE', null, token);
        updateLog(`✔ Unfollowed: ${p.name}`, 'info');
      } catch (e) {}
      await sleep(100);
    }

    updateLog('🎉 SUCCESS! Spotify account fully wiped!', 'success');
    alert('🎉 Spotify Purge Complete!\n\nAll items removed successfully.');
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
            <span>⚡ Spotify Purge Pro v3.0</span>
          </div>
          <button id="btn-ext-close" style="background: none; border: none; color: #b3b3b3; cursor: pointer; font-size: 16px;">✕</button>
        </div>

        <p style="font-size: 12px; color: #b3b3b3; margin: 0;">
          Select authentication mode to wipe account:
        </p>

        <!-- Mode Selectors -->
        <div style="display: flex; gap: 8px;">
          <button id="tab-auto-token" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; background: #1db954; color: #000; border: none; cursor: pointer;">1-Click Auto Token</button>
          <button id="tab-dev-oauth" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; background: #282828; color: #fff; border: 1px solid #444; cursor: pointer;">Developer OAuth</button>
        </div>

        <!-- Dev OAuth Inputs Section -->
        <div id="dev-oauth-inputs" style="display: none; flex-direction: column; gap: 8px; background: #181818; padding: 10px; border-radius: 8px; border: 1px solid #282828;">
          <label style="font-size: 10px; color: #999; text-transform: uppercase;">Spotify Developer Client ID</label>
          <input id="input-dev-client-id" type="text" placeholder="0d5587ddaa23481b993862a77551ca5a" style="background: #000; border: 1px solid #333; color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-family: monospace;" />
          <button id="btn-trigger-oauth" style="background: #3b82f6; color: #fff; border: none; font-weight: 700; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 11px;">🔑 Connect & Whitelist via App OAuth</button>
        </div>

        <div id="purge-ext-progress" style="width: 100%; background: #282828; height: 6px; border-radius: 3px; overflow: hidden; display: none;">
          <div id="purge-ext-fill" style="width: 0%; height: 100%; background: #1db954; transition: width 0.2s;"></div>
        </div>

        <div id="purge-ext-logs" style="
          height: 120px;
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
          <div style="color: #666;">[System Ready. Choose mode and click Start.]</div>
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
        ">🔥 START 1-CLICK PURGE</button>
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
    const tabAuto = document.getElementById('tab-auto-token');
    const tabDev = document.getElementById('tab-dev-oauth');
    const devInputs = document.getElementById('dev-oauth-inputs');
    const inputClientId = document.getElementById('input-dev-client-id');
    const btnOAuth = document.getElementById('btn-trigger-oauth');
    const logsBox = document.getElementById('purge-ext-logs');
    const progressWrap = document.getElementById('purge-ext-progress');
    const progressFill = document.getElementById('purge-ext-fill');

    let activeMode = 'auto';

    toggleBtn.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; };
    closeBtn.onclick = () => { panel.style.display = 'none'; };

    tabAuto.onclick = () => {
      activeMode = 'auto';
      tabAuto.style.background = '#1db954'; tabAuto.style.color = '#000';
      tabDev.style.background = '#282828'; tabDev.style.color = '#fff';
      devInputs.style.display = 'none';
    };

    tabDev.onclick = () => {
      activeMode = 'dev';
      tabDev.style.background = '#1db954'; tabDev.style.color = '#000';
      tabAuto.style.background = '#282828'; tabAuto.style.color = '#fff';
      devInputs.style.display = 'flex';
      const savedId = localStorage.getItem('SPOTIFY_DEV_CLIENT_ID') || '0d5587ddaa23481b993862a77551ca5a';
      inputClientId.value = savedId;
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

    // Trigger Developer App Implicit Grant Authorization
    btnOAuth.onclick = () => {
      const cid = inputClientId.value.trim() || '0d5587ddaa23481b993862a77551ca5a';
      localStorage.setItem('SPOTIFY_DEV_CLIENT_ID', cid);
      
      const scopes = encodeURIComponent('user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-follow-read user-follow-modify');
      const redirectUri = encodeURIComponent('https://teshrij.xyz/spotify-account-cleaner/');
      const authUrl = `https://accounts.spotify.com/authorize?client_id=${cid}&response_type=token&redirect_uri=${redirectUri}&scope=${scopes}&show_dialog=true`;

      addLog(`🔑 Redirecting to Developer App OAuth authorization...`, 'info');
      window.location.href = authUrl;
    };

    // Check if returning from Developer OAuth redirect with #access_token=...
    if (window.location.hash && window.location.hash.includes('access_token=')) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const oauthToken = hashParams.get('access_token');
      if (oauthToken) {
        panel.style.display = 'flex';
        addLog('✅ Developer App OAuth token extracted!', 'success');
        if (confirm('⚡ Developer App Authorized!\n\nDo you want to run account purge now using your Developer App token?')) {
          runAccountPurge(oauthToken, addLog, updateProgress);
        }
      }
    }

    startBtn.onclick = async () => {
      if (!confirm('⚠️ Are you sure you want to permanently delete all Liked Songs, Saved Albums & Playlists?')) return;

      startBtn.disabled = true;
      startBtn.style.opacity = '0.5';

      try {
        let token = await getSessionToken();
        if (!token) {
          throw new Error('No session token found. Switch to Developer OAuth mode to connect your app!');
        }
        await runAccountPurge(token, addLog, updateProgress);
      } catch (err) {
        addLog(`❌ Error: ${err.message}`, 'error');
        alert(`Purge Error: ${err.message}`);
      } finally {
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
      }
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectFloatingUI();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingUI);
  }
})();
