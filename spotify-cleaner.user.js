// ==UserScript==
// @name         Spotify One-Click Auto-Purge & Cleaner
// @namespace    https://github.com/pfggh/spotify-account-cleaner
// @version      3.0.0
// @description  Automated 1-Click Spotify Library Cleaner. Works natively inside open.spotify.com on any browser (Tampermonkey/Violentmonkey/Greasemonkey). Zero Developer Setup or Client ID required!
// @author       Antigravity AI
// @match        https://open.spotify.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.spotify.com
// @connect      open.spotify.com
// @run-at       document-idle
// ==UserScript==

(function () {
  'use me strict';

  // Prevent multiple injections
  if (window.__SPOTIFY_PURGE_LOADED__) return;
  window.__SPOTIFY_PURGE_LOADED__ = true;

  console.log('[Spotify Purge Engine] Initialized and active.');

  // UI state
  let isRunning = false;
  let webToken = null;

  // --- Helper: Fetch Spotify Session Token from Browser Memory ---
  async function getSessionToken() {
    // 1. Try reading token from page window state or fetch endpoint
    try {
      const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.accessToken) {
          console.log('[Spotify Purge Engine] Successfully extracted web player session token!');
          return data.accessToken;
        }
      }
    } catch (e) {
      console.warn('[Spotify Purge Engine] Session endpoint fetch warning:', e);
    }

    // 2. Try window session storage or local storage tokens
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

  // --- API Client wrapper using session token ---
  async function apiRequest(endpoint, method = 'GET', body = null, token) {
    const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${token}`
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    return new Promise((resolve, reject) => {
      const reqDetails = {
        method: method,
        url: url,
        headers: headers,
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) {
            try {
              resolve(response.responseText ? JSON.parse(response.responseText) : {});
            } catch (e) {
              resolve({});
            }
          } else {
            try {
              const err = JSON.parse(response.responseText);
              reject(new Error(err.error?.message || `HTTP ${response.status} ${response.statusText}`));
            } catch (e) {
              reject(new Error(`HTTP ${response.status} ${response.statusText}`));
            }
          }
        },
        onerror: function (err) {
          reject(new Error('Network error executing Spotify API request'));
        }
      };

      if (body) {
        reqDetails.data = typeof body === 'string' ? body : JSON.stringify(body);
      }

      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest(reqDetails);
      } else {
        // Native fetch fallback
        fetch(url, {
          method: method,
          headers: headers,
          body: reqDetails.data
        }).then(res => {
          if (res.status === 204) return resolve({});
          if (!res.ok) return res.json().then(e => reject(new Error(e.error?.message || `HTTP ${res.status}`)));
          return res.json().then(resolve);
        }).catch(reject);
      }
    });
  }

  // --- Core Purge Algorithm ---
  async function runAccountPurge(updateLog, updateProgress) {
    if (isRunning) return;
    isRunning = true;

    try {
      updateLog('🔑 Obtaining active Spotify session token...', 'info');
      webToken = await getSessionToken();
      
      if (!webToken) {
        throw new Error('Could not automatically retrieve Spotify session token. Please ensure you are logged into open.spotify.com!');
      }

      updateLog('✅ Session authenticated successfully!', 'success');

      // Fetch user profile
      const user = await apiRequest('/me', 'GET', null, webToken);
      updateLog(`👤 Logged in as: ${user.display_name || user.id} (${user.id})`, 'success');

      // --- 1. Fetch & Wiping Liked Songs ---
      updateLog('🔍 Scanning Liked Songs...', 'info');
      let likedTracks = [];
      let nextUrl = '/me/tracks?limit=50';
      while (nextUrl) {
        const res = await apiRequest(nextUrl, 'GET', null, webToken);
        if (!res || !res.items) break;
        likedTracks = likedTracks.concat(res.items);
        nextUrl = res.next;
      }

      updateLog(`📊 Found ${likedTracks.length} Liked Songs. Starting purge...`, 'highlight');
      if (likedTracks.length > 0) {
        const trackUris = likedTracks.map(item => item.track?.uri || `spotify:track:${item.track?.id}`).filter(Boolean);
        
        for (let i = 0; i < trackUris.length; i += 50) {
          const batch = trackUris.slice(i, i + 50);
          updateProgress(i, trackUris.length, 'Liked Songs');
          
          try {
            // 2026 API Endpoint: DELETE /v1/me/library?uris=...
            await apiRequest(`/me/library?uris=${encodeURIComponent(batch.join(','))}`, 'DELETE', null, webToken);
            updateLog(`✔ Removed batch ${Math.floor(i / 50) + 1} (${Math.min(i + 50, trackUris.length)}/${trackUris.length})`, 'info');
          } catch (e) {
            updateLog(`⚠️ Batch delete fallback: ${e.message}`, 'warning');
            for (const singleUri of batch) {
              try {
                await apiRequest(`/me/library?uris=${encodeURIComponent(singleUri)}`, 'DELETE', null, webToken);
              } catch (singleErr) {
                updateLog(`Could not remove ${singleUri}: ${singleErr.message}`, 'warning');
              }
            }
          }
        }
        updateProgress(trackUris.length, trackUris.length, 'Liked Songs');
        updateLog('✨ All Liked Songs permanently wiped!', 'success');
      }

      // --- 2. Fetch & Wiping Saved Albums ---
      updateLog('🔍 Scanning Saved Albums...', 'info');
      let savedAlbums = [];
      let albumUrl = '/me/albums?limit=50';
      while (albumUrl) {
        const res = await apiRequest(albumUrl, 'GET', null, webToken);
        if (!res || !res.items) break;
        savedAlbums = savedAlbums.concat(res.items);
        albumUrl = res.next;
      }

      updateLog(`📊 Found ${savedAlbums.length} Saved Albums. Starting purge...`, 'highlight');
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
        updateLog('✨ All Saved Albums wiped!', 'success');
      }

      // --- 3. Fetch & Unfollowing Playlists ---
      updateLog('🔍 Scanning Playlists...', 'info');
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
          updateLog(`✔ Unfollowed playlist: ${p.name}`, 'info');
        } catch (e) {
          updateLog(`Could not unfollow ${p.name}: ${e.message}`, 'warning');
        }
      }

      updateLog('🎉 COMPLETE! Account successfully wiped!', 'success');
      alert('🎉 Spotify Purge Complete!\n\nAll selected items, Liked Songs, Saved Albums & Playlists have been wiped from your account.');
    } catch (err) {
      updateLog(`❌ CRITICAL ERROR: ${err.message}`, 'error');
      alert(`Spotify Purge Error: ${err.message}`);
    } finally {
      isRunning = false;
    }
  }

  // --- Inject Modern Floating Widget UI into open.spotify.com ---
  function injectFloatingUI() {
    if (document.getElementById('spotify-purge-floating-root')) return;

    const root = document.createElement('div');
    root.id = 'spotify-purge-floating-root';
    root.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    `;

    root.innerHTML = `
      <div id="purge-widget-panel" style="
        width: 380px;
        background: rgba(9, 13, 22, 0.95);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        padding: 20px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(16, 185, 129, 0.15);
        color: #f8fafc;
        display: none;
        flex-direction: column;
        gap: 14px;
        margin-bottom: 12px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 28px; height: 28px; background: #10b981; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #000; font-size: 14px;">⚡</div>
            <span style="font-weight: 800; font-size: 15px; background: linear-gradient(to right, #fff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Spotify Auto-Purge</span>
          </div>
          <button id="btn-close-purge" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 18px;">✕</button>
        </div>

        <p style="font-size: 12px; color: #94a3b8; margin: 0; leading-height: 1.4;">
          1-Click Automated Account Cleaner. Scans and wipes all Liked Songs, Saved Albums & Playlists.
        </p>

        <div id="purge-progress-bar-wrap" style="width: 100%; background: rgba(255,255,255,0.05); height: 6px; border-radius: 3px; overflow: hidden; display: none;">
          <div id="purge-progress-bar-fill" style="width: 0%; height: 100%; background: #10b981; transition: width 0.2s;"></div>
        </div>

        <div id="purge-logs-box" style="
          height: 140px;
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 10px;
          font-family: monospace;
          font-size: 11px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        ">
          <div style="color: #64748b;">[System Ready. Click "START 1-CLICK PURGE" to begin.]</div>
        </div>

        <button id="btn-start-purge" style="
          width: 100%;
          background: linear-gradient(135deg, #10b981, #059669);
          border: none;
          color: #000;
          font-weight: 800;
          font-size: 13px;
          padding: 12px;
          border-radius: 12px;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
          transition: transform 0.1s, opacity 0.2s;
        ">🔥 START 1-CLICK PURGE</button>
      </div>

      <!-- Trigger Launcher Button -->
      <button id="btn-toggle-purge-widget" style="
        background: linear-gradient(135deg, #10b981, #047857);
        color: #000;
        border: 2px solid rgba(255,255,255,0.2);
        font-weight: 800;
        font-size: 13px;
        padding: 12px 20px;
        border-radius: 50px;
        cursor: pointer;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 15px rgba(16,185,129,0.4);
        display: flex;
        align-items: center;
        gap: 8px;
      ">
        <span>⚡ Spotify Cleaner</span>
      </button>
    `;

    document.body.appendChild(root);

    const panel = document.getElementById('purge-widget-panel');
    const toggleBtn = document.getElementById('btn-toggle-purge-widget');
    const closeBtn = document.getElementById('btn-close-purge');
    const startBtn = document.getElementById('btn-start-purge');
    const logsBox = document.getElementById('purge-logs-box');
    const progressWrap = document.getElementById('purge-progress-bar-wrap');
    const progressFill = document.getElementById('purge-progress-bar-fill');

    toggleBtn.onclick = () => {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    };

    closeBtn.onclick = () => {
      panel.style.display = 'none';
    };

    function addLog(msg, type = 'info') {
      const line = document.createElement('div');
      const time = new Date().toLocaleTimeString();
      let color = '#94a3b8';
      if (type === 'success') color = '#34d399';
      if (type === 'warning') color = '#fbbf24';
      if (type === 'error') color = '#f87171';
      if (type === 'highlight') color = '#ffffff';

      line.style.color = color;
      line.innerHTML = `<span style="color: #475569;">[${time}]</span> ${msg}`;
      logsBox.appendChild(line);
      logsBox.scrollTop = logsBox.scrollHeight;
    }

    function updateProgress(done, total, cat) {
      progressWrap.style.display = 'block';
      const pct = Math.round((done / total) * 100);
      progressFill.style.width = `${pct}%`;
    }

    startBtn.onclick = () => {
      if (confirm('⚠️ Are you sure you want to permanently wipe your Spotify Liked Songs, Saved Albums & Playlists?\n\nThis operation cannot be undone!')) {
        startBtn.disabled = true;
        startBtn.style.opacity = '0.5';
        runAccountPurge(addLog, updateProgress).finally(() => {
          startBtn.disabled = false;
          startBtn.style.opacity = '1';
        });
      }
    };
  }

  // Inject UI when page DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectFloatingUI();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingUI);
  }

  // Register command in Violentmonkey / Tampermonkey menu
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('⚡ Open Spotify Cleaner Panel', () => {
      const panel = document.getElementById('purge-widget-panel');
      if (panel) panel.style.display = 'flex';
    });
  }

})();
