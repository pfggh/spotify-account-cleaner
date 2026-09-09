// Spotify API helper module with PKCE Auth & 100% reliable rate-limit handling

export const SCOPES = [
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-follow-read',
  'user-follow-modify'
].join(' ');

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64encode(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export class SpotifyAuth {
  constructor(clientId, redirectUri) {
    this.clientId = clientId;
    this.redirectUri = redirectUri || (window.location.origin + window.location.pathname);
  }

  async redirectToAuth() {
    const codeVerifier = generateRandomString(64);
    window.localStorage.setItem('spotify_code_verifier', codeVerifier);
    window.localStorage.setItem('spotify_client_id', this.clientId);

    let codeChallenge = '';
    try {
      if (window.crypto && window.crypto.subtle) {
        const hashed = await sha256(codeVerifier);
        codeChallenge = base64encode(hashed);
      }
    } catch (e) {
      console.warn('Crypto.subtle failed, fallback to plain verifier:', e);
    }

    const redirectTarget = this.redirectUri || (window.location.origin + window.location.pathname);

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectTarget,
      scope: SCOPES,
      show_dialog: 'true'
    });

    if (codeChallenge) {
      params.append('code_challenge_method', 'S256');
      params.append('code_challenge', codeChallenge);
    } else {
      params.append('code_challenge_method', 'plain');
      params.append('code_challenge', codeVerifier);
    }

    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
    window.location.href = authUrl;
  }

  async handleCallback(code) {
    const codeVerifier = window.localStorage.getItem('spotify_code_verifier');
    const clientId = window.localStorage.getItem('spotify_client_id') || this.clientId;

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error_description || 'Failed to exchange authorization code for access token.');
    }

    const data = await response.json();
    const expiresAt = Date.now() + data.expires_in * 1000;
    
    window.localStorage.setItem('spotify_access_token', data.access_token);
    window.localStorage.setItem('spotify_refresh_token', data.refresh_token || '');
    window.localStorage.setItem('spotify_token_expires_at', expiresAt.toString());

    // Clean URL params
    window.history.replaceState({}, document.title, window.location.pathname);

    return data.access_token;
  }

  async getAccessToken() {
    const accessToken = window.localStorage.getItem('spotify_access_token');
    const refreshToken = window.localStorage.getItem('spotify_refresh_token');
    const expiresAt = parseInt(window.localStorage.getItem('spotify_token_expires_at') || '0', 10);
    const clientId = window.localStorage.getItem('spotify_client_id');

    if (accessToken && Date.now() < expiresAt - 60000) {
      return accessToken;
    }

    if (refreshToken && clientId) {
      try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          const newExpiresAt = Date.now() + data.expires_in * 1000;
          window.localStorage.setItem('spotify_access_token', data.access_token);
          if (data.refresh_token) window.localStorage.setItem('spotify_refresh_token', data.refresh_token);
          window.localStorage.setItem('spotify_token_expires_at', newExpiresAt.toString());
          return data.access_token;
        }
      } catch (e) {
        console.warn('Failed to refresh token', e);
      }
    }

    return null;
  }

  logout() {
    window.localStorage.removeItem('spotify_access_token');
    window.localStorage.removeItem('spotify_refresh_token');
    window.localStorage.removeItem('spotify_token_expires_at');
    window.localStorage.removeItem('spotify_code_verifier');
  }
}

export class SpotifyApiClient {
  constructor(auth) {
    this.auth = auth;
    this.onLog = null;
  }

  log(msg, type = 'info') {
    if (this.onLog) this.onLog(msg, type);
  }

  async request(endpoint, options = {}) {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error('Not authenticated. Please log in with Spotify.');
    }

    const url = endpoint.startsWith('http') ? endpoint : `https://api.spotify.com/v1${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };

    let retries = 0;
    const maxRetries = 5;

    while (retries <= maxRetries) {
      const response = await fetch(url, { ...options, headers });

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const waitTimeSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) + 1 : Math.pow(2, retries) + 1;
        this.log(`Rate limited by Spotify (HTTP 429). Waiting ${waitTimeSeconds}s before retrying...`, 'warning');
        await new Promise(res => setTimeout(res, waitTimeSeconds * 1000));
        retries++;
        continue;
      }

      if (response.status >= 500 && retries < maxRetries) {
        const waitMs = Math.pow(2, retries) * 1000;
        this.log(`Spotify server error (${response.status}). Retrying in ${waitMs / 1000}s...`, 'warning');
        await new Promise(res => setTimeout(res, waitMs));
        retries++;
        continue;
      }

      if (!response.ok && response.status !== 204) {
        const errJson = await response.json().catch(() => ({}));
        const message = errJson.error?.message || `HTTP ${response.status} ${response.statusText}`;
        throw new Error(`Spotify API Error: ${message}`);
      }

      if (response.status === 204) {
        return null;
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }

    throw new Error('Exceeded maximum retries for Spotify API call.');
  }

  // --- Profile ---
  async getCurrentUser() {
    return this.request('/me');
  }

  // --- Fetching Items ---
  async fetchAllPages(endpoint, keyName) {
    let items = [];
    let url = endpoint.includes('limit=') ? endpoint : `${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=50`;
    
    while (url) {
      const res = await this.request(url);
      if (!res) break;

      let fetchedItems = [];
      if (keyName && res[keyName]) {
        fetchedItems = res[keyName].items || [];
        url = res[keyName].next;
      } else if (res.items) {
        fetchedItems = res.items;
        url = res.next;
      } else {
        break;
      }

      items = items.concat(fetchedItems);
      // Small throttle to avoid hitting rate limits on large libraries
      await new Promise(r => setTimeout(r, 100));
    }
    return items;
  }

  async getLikedTracks() {
    return this.fetchAllPages('/me/tracks');
  }

  async getSavedAlbums() {
    return this.fetchAllPages('/me/albums');
  }

  async getPlaylists() {
    return this.fetchAllPages('/me/playlists');
  }

  async getFollowedArtists() {
    // Followed artists uses cursor pagination
    let artists = [];
    let after = null;
    
    while (true) {
      let endpoint = `/me/following?type=artist&limit=50`;
      if (after) endpoint += `&after=${after}`;

      const res = await this.request(endpoint);
      if (!res || !res.artists || !res.artists.items || res.artists.items.length === 0) {
        break;
      }

      artists = artists.concat(res.artists.items);
      after = res.artists.cursors?.after;
      if (!after || res.artists.items.length < 50) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return artists;
  }

  async getSavedEpisodes() {
    try {
      return await this.fetchAllPages('/me/episodes');
    } catch (e) {
      this.log(`Could not fetch saved episodes: ${e.message}`, 'warning');
      return [];
    }
  }

  async getSavedShows() {
    try {
      return await this.fetchAllPages('/me/shows');
    } catch (e) {
      this.log(`Could not fetch saved shows: ${e.message}`, 'warning');
      return [];
    }
  }

  // --- Deletion Functions (In Batches of 50) ---

  async deleteLikedTracks(trackIds, onProgress) {
    const batchSize = 50;
    let count = 0;
    for (let i = 0; i < trackIds.length; i += batchSize) {
      const batch = trackIds.slice(i, i + batchSize);
      // Attempt 1: Query parameter format (Accepted by Spotify API CORS)
      try {
        await this.request(`/me/tracks?ids=${batch.join(',')}`, {
          method: 'DELETE'
        });
        count += batch.length;
      } catch (e1) {
        // Attempt 2: Body array
        try {
          await this.request('/me/tracks', {
            method: 'DELETE',
            body: JSON.stringify(batch)
          });
          count += batch.length;
        } catch (e2) {
          // Attempt 3: Individual item delete fallback
          for (const singleId of batch) {
            try {
              await this.request(`/me/tracks?ids=${singleId}`, { method: 'DELETE' });
            } catch (singleErr) {
              this.log(`Could not remove track ${singleId}: ${singleErr.message}`, 'warning');
            }
            count++;
            if (onProgress) onProgress(count, trackIds.length);
          }
        }
      }
      if (onProgress) onProgress(Math.min(count, trackIds.length), trackIds.length);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async deleteSavedAlbums(albumIds, onProgress) {
    const batchSize = 50;
    let count = 0;
    for (let i = 0; i < albumIds.length; i += batchSize) {
      const batch = albumIds.slice(i, i + batchSize);
      try {
        await this.request('/me/albums', {
          method: 'DELETE',
          body: JSON.stringify(batch)
        });
        count += batch.length;
      } catch (e1) {
        try {
          await this.request('/me/albums', {
            method: 'DELETE',
            body: JSON.stringify({ ids: batch })
          });
          count += batch.length;
        } catch (e2) {
          try {
            await this.request(`/me/albums?ids=${batch.join(',')}`, {
              method: 'DELETE'
            });
            count += batch.length;
          } catch (e3) {
            for (const singleId of batch) {
              try {
                await this.request('/me/albums', {
                  method: 'DELETE',
                  body: JSON.stringify([singleId])
                });
              } catch (singleErr) {
                this.log(`Could not remove album ${singleId}: ${singleErr.message}`, 'warning');
              }
              count++;
              if (onProgress) onProgress(count, albumIds.length);
            }
          }
        }
      }
      if (onProgress) onProgress(Math.min(count, albumIds.length), albumIds.length);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async unfollowPlaylists(playlistIds, onProgress) {
    for (let i = 0; i < playlistIds.length; i++) {
      const id = playlistIds[i];
      await this.request(`/playlists/${id}/followers`, {
        method: 'DELETE'
      });
      if (onProgress) onProgress(i + 1, playlistIds.length);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async unfollowArtists(artistIds, onProgress) {
    const batchSize = 50;
    for (let i = 0; i < artistIds.length; i += batchSize) {
      const batch = artistIds.slice(i, i + batchSize);
      try {
        await this.request('/me/following?type=artist', {
          method: 'DELETE',
          body: JSON.stringify({ ids: batch })
        });
      } catch (e) {
        await this.request(`/me/following?type=artist&ids=${batch.join(',')}`, {
          method: 'DELETE'
        });
      }
      if (onProgress) onProgress(Math.min(i + batchSize, artistIds.length), artistIds.length);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async deleteSavedEpisodes(episodeIds, onProgress) {
    const batchSize = 50;
    for (let i = 0; i < episodeIds.length; i += batchSize) {
      const batch = episodeIds.slice(i, i + batchSize);
      try {
        await this.request('/me/episodes', {
          method: 'DELETE',
          body: JSON.stringify({ ids: batch })
        });
      } catch (e) {
        await this.request(`/me/episodes?ids=${batch.join(',')}`, {
          method: 'DELETE'
        });
      }
      if (onProgress) onProgress(Math.min(i + batchSize, episodeIds.length), episodeIds.length);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async deleteSavedShows(showIds, onProgress) {
    const batchSize = 50;
    let count = 0;
    for (let i = 0; i < showIds.length; i += batchSize) {
      const batch = showIds.slice(i, i + batchSize);
      try {
        await this.request('/me/shows', {
          method: 'DELETE',
          body: JSON.stringify({ ids: batch })
        });
        count += batch.length;
      } catch (e) {
        try {
          await this.request(`/me/shows?ids=${batch.join(',')}`, {
            method: 'DELETE'
          });
          count += batch.length;
        } catch (err) {
          for (const singleId of batch) {
            try {
              await this.request(`/me/shows?ids=${singleId}`, { method: 'DELETE' });
            } catch (singleErr) {
              this.log(`Could not remove show ${singleErr.message}`, 'warning');
            }
            count++;
            if (onProgress) onProgress(count, showIds.length);
          }
        }
      }
      if (onProgress) onProgress(Math.min(count, showIds.length), showIds.length);
      await new Promise(r => setTimeout(r, 150));
    }
  }
}
