(function () {
  'use strict';

  if (window.__SPOTIFY_HOOK_INSTALLED__) return;
  window.__SPOTIFY_HOOK_INSTALLED__ = true;

  console.log('[Spotify Purge Hook] Interceptor initialized on page context.');

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const init = args[1];
      if (init && init.headers) {
        let auth = null;
        if (init.headers instanceof Headers) {
          auth = init.headers.get('authorization') || init.headers.get('Authorization');
        } else if (typeof init.headers === 'object') {
          auth = init.headers['authorization'] || init.headers['Authorization'] || init.headers['AUTHORIZATION'];
        }

        if (auth && auth.startsWith('Bearer ')) {
          const token = auth.substring(7).trim();
          if (token && token.length > 20) {
            window.__SPOTIFY_CAPTURED_TOKEN__ = token;
            window.dispatchEvent(new CustomEvent('SPOTIFY_TOKEN_CAPTURED', { detail: { token } }));
          }
        }
      }
    } catch (e) {}
    return origFetch.apply(this, args);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (...args) {
    this._headers = {};
    return origOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (header && header.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
      const token = value.substring(7).trim();
      if (token && token.length > 20) {
        window.__SPOTIFY_CAPTURED_TOKEN__ = token;
        window.dispatchEvent(new CustomEvent('SPOTIFY_TOKEN_CAPTURED', { detail: { token } }));
      }
    }
    return origSetHeader.apply(this, arguments);
  };
})();
