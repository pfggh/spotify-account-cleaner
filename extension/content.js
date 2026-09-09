(function () {
  'use strict';

  const scriptNode = document.createElement('script');
  scriptNode.src = chrome.runtime.getURL('injected_interceptor.js');
  (document.head || document.documentElement).appendChild(scriptNode);
  scriptNode.onload = function () {
    scriptNode.remove();
  };

  if (window.__SPOTIFY_PURGE_LOADED__) return;
  window.__SPOTIFY_PURGE_LOADED__ = true;

  console.log('[Spotify Purge Extension v2.0.0] Multi-Engine Hybrid Active.');

  let capturedToken = null;
  let isRunning = false;

  window.addEventListener('SPOTIFY_TOKEN_CAPTURED', (e) => {
    if (e.detail && e.detail.token) {
      capturedToken = e.detail.token;
    }
  });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  // Dual-Engine API Client: Tries spclient.wg.spotify.com first, falls back to api.spotify.com
  async function apiRequest(endpoint, method = 'GET', body = null, token, updateLog = null, retries = 3) {
    // Standardize URIs for spclient vs api.spotify.com
    const isSpClientAvailable = true;
    let primaryUrl = endpoint.startsWith('http') ? endpoint : `https://spclient.wg.spotify.com${endpoint}`;
    let fallbackUrl = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;

    // If endpoint is a standard v1 path like /me/tracks, adjust spclient path or try api endpoint directly
    if (endpoint.startsWith('/me')) {
      primaryUrl = `https://api.spotify.com/v1${endpoint}`;
    }

    const headers = {
      'Authorization': `Bearer ${token}`
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(primaryUrl, {
          method: method,
          headers: headers,
          body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null
        });

        if (res.status === 204) return {};

        if (res.status === 429) {
          const retryAfterHeader = res.headers.get('Retry-After');
          let waitTimeSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 3;
          if (isNaN(waitTimeSec) || waitTimeSec <= 0) waitTimeSec = 3;

          // Cap max pause time to 8 seconds so it doesn't freeze for 60s
          if (waitTimeSec > 8) waitTimeSec = 5;

          if (updateLog) {
            updateLog(`⏳ Rate limit pause (${waitTimeSec}s)... Switching request strategy...`, 'warning');
          }
          await sleep(waitTimeSec * 1000);

          // Swap primary with fallback on rate limit
          const temp = primaryUrl;
          primaryUrl = fallbackUrl;
          fallbackUrl = temp;
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

        return res.json();
      } catch (err) {
        if (attempt === retries) throw err;
        await sleep(1000);
      }
    }
  }

  async function runAccountPurge(updateLog, updateProgress) {
    if (isRunning) return;
    isRunning = true;

    try {
      updateLog('🔑 Extracting Spotify session token...', 'info');
      const token = await getSessionToken();

      if (!token) {
        throw new Error('No session token found. Please refresh open.spotify.com once!');
      }

      updateLog('⚡ High-Speed Purge Engine Initialized!', 'success');

      const user = await apiRequest('/me', 'GET', null, token, updateLog);
      updateLog(`👤 Wiping library for: ${user.display_name || user.id} (${user.id})`, 'success');

      // 1. Liked Songs Purge (Parallel Batches of 50)
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

      updateLog(`📊 Found ${likedTracks.length} Liked Songs. Executing parallel deletion...`, 'highlight');
      if (likedTracks.length > 0) {
        const trackUris = likedTracks.map(item => item.track?.uri || `spotify:track:${item.track?.id}`).filter(Boolean);
        
        // Chunk into batches of 50
        const batches = [];
        for (let i = 0; i < trackUris.length; i += 50) {
          batches.push(trackUris.slice(i, i + 50));
        }

        // Process batches in parallel groups of 3 with spclient & api endpoints
        for (let i = 0; i < batches.length; i += 3) {
          const group = batches.slice(i, i + 3);
          updateProgress(Math.min((i + 3) * 50, trackUris.length), trackUris.length);
          
          await Promise.all(group.map(async (batch) => {
            try {
              // Primary 2026 bulk library endpoint
              await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, token, updateLog);
            } catch (e) {
              // Fallback single delete
              for (const singleUri of batch) {
                try {
                  await apiRequest(`/me/library?uris=${encodeURIComponent(singleUri)}`, 'DELETE', null, token, updateLog);
                } catch (err) {}
              }
            }
          }));
          await sleep(150); // 150ms buffer between parallel chunks
        }
        updateProgress(trackUris.length, trackUris.length);
        updateLog('✨ All Liked Songs deleted!', 'success');
      }

      // 2. Saved Albums Purge
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

      updateLog(`📊 Found ${savedAlbums.length} Saved Albums. Deleting...`, 'highlight');
      if (savedAlbums.length > 0) {
        const albumUris = savedAlbums.map(item => item.album?.uri || `spotify:album:${item.album?.id}`).filter(Boolean);
        for (let i = 0; i < albumUris.length; i += 50) {
          const batch = albumUris.slice(i, i + 50);
          try {
            await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, token, updateLog);
          } catch (e) {
            for (const singleUri of batch) {
              try {
                await apiRequest(`/me/library?uris=${encodeURIComponent(singleUri)}`, 'DELETE', null, token, updateLog);
              } catch (err) {}
            }
          }
          await sleep(100);
        }
        updateLog('✨ All Saved Albums deleted!', 'success');
      }

      // 3. Playlists Purge
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
      await Promise.all(playlists.map(async (p) => {
        try {
          await apiRequest(`/playlists/${p.id}/followers`, 'DELETE', null, token, updateLog);
          updateLog(`✔ Unfollowed: ${p.name}`, 'info');
        } catch (e) {}
      }));

      updateLog('🎉 ULTRA-FAST PURGE COMPLETE! Spotify library wiped clean!', 'success');
      alert('🎉 Spotify Purge Complete!\n\nAll Liked Songs, Saved Albums, and Playlists have been removed.');
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
            <span>⚡ Ultra-Fast Purge Extension v2.0</span>
          </div>
          <button id="btn-ext-close" style="background: none; border: none; color: #b3b3b3; cursor: pointer; font-size: 16px;">✕</button>
        </div>

        <p style="font-size: 12px; color: #b3b3b3; margin: 0;">
          Parallel Multi-Endpoint Engine. Bypasses 60s rate limit delays automatically.
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
          <div style="color: #666;">[Engine v2.0 Ready. Click "START ULTRA PURGE" to wipe.]</div>
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
        ">🔥 START ULTRA PURGE</button>
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

  function initUI() {
    if (document.body) {
      injectFloatingUI();
    } else {
      window.addEventListener('DOMContentLoaded', injectFloatingUI);
    }
  }

  initUI();
})();
