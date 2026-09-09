# ⚡ Spotify 1-Click Plug & Go Auto-Cleaner

A lightweight, zero-setup browser automation script for **Linux, Windows, macOS, and any modern browser** (Firefox, Chrome, Edge, Brave, Opera).

Unlike external web apps, this userscript runs **100% inside `open.spotify.com`** using your browser's existing active Spotify session.

### 🌟 Key Features
- **0 Developer Setup Required**: No Client IDs, no redirect URIs, no Developer Dashboard whitelisting.
- **Works on Any PC**: Linux, Windows, macOS (Firefox / Chrome / Edge / Brave).
- **1-Click Auto Purge**: Wipes Liked Songs, Saved Albums, Playlists, and Podcasts automatically.
- **Spotify 2026 API Engine**: Powered by the official Spotify `/v1/me/library` batch endpoint with 1-by-1 fallback loops.
- **Glassmorphism Floating Widget**: Injects a clean, non-intrusive floating control panel directly onto `open.spotify.com`.

---

## 🚀 Quick Setup (20 Seconds)

### Step 1: Install a Userscript Manager Extension
Install one of the following standard browser extensions (if you don't already have one):
- **Violentmonkey** ([Firefox](https://addons.mozilla.org/en-US/firefox/addon/violentmonkey/) | [Chrome/Edge/Brave](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag))
- **Tampermonkey** ([Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) | [Chrome/Edge/Brave](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo))

### Step 2: Install the Script
1. Click **[Install Spotify Auto-Cleaner Userscript](https://raw.githubusercontent.com/pfggh/spotify-account-cleaner/master/spotify-cleaner.user.js)**.
2. Violentmonkey / Tampermonkey will open an installation prompt. Click **Install / Confirm Installation**.

---

## ⚡ How to Use

1. Open **[open.spotify.com](https://open.spotify.com)** on any account.
2. A floating button named **⚡ Spotify Cleaner** will appear at the bottom-right corner of your screen.
3. Click **⚡ Spotify Cleaner** → Click **🔥 START 1-CLICK PURGE**.
4. The script automatically authenticates your session and wipes your Liked Songs, Albums, and Playlists instantly!

---

## 🛠 Tech & Security Details
- **Zero Remote Servers**: All API calls run directly from your browser to `api.spotify.com`.
- **Cross-Platform**: Uses standard GM / Tampermonkey / W3C Fetch primitives compatible across Linux, Windows, and macOS.
- **CORS Bypass**: Native `GM_xmlhttpRequest` support handles Spotify CORS rules smoothly.
