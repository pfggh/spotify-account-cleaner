# Spotify Account Cleaner (Trikatuka2 Engine)

Based on the [Trikatuka2](https://github.com/aartek/trikatuka2) Spotify migration tool architecture, **Spotify Account Cleaner** provides 100% reliable, complete removal of all content from your Spotify account.

## Features

- 🧹 **Complete Library Wipe**:
  - Liked Songs (Saved Tracks)
  - Playlists (Created & Followed)
  - Saved Albums
  - Followed Artists & Users
  - Saved Podcast Episodes
  - Saved Shows (Podcasts)
- 🔒 **Secure Authentication**: OAuth 2.0 with PKCE (No secret credentials required in the client app).
- 🛡️ **Safety Protection**: Confirmation modal requiring manual typing of `DELETE EVERYTHING` before execution.
- ⚡ **Rate-Limit Resilient**: Automatically detects Spotify HTTP 429 rate limits and retries with backoff delays.
- 📊 **Real-time Live Logs & Progress Bar**: Step-by-step progress tracking for batch deletions.
- 🐍 **Dual Support**: Modern Web UI (Vite + JS) + Python CLI script.

---

## 🚀 Quick Start (Web App)

### 1. Register Spotify Developer App
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Click **Create App**.
   - **App Name**: `Spotify Cleaner`
   - **Redirect URI**: `http://127.0.0.1:5173/` *(Note: Spotify disallows `localhost`, explicit IP `127.0.0.1` is required)*
3. Copy your **Client ID**.

### 2. Launch the Application
```bash
cd /home/user/Projects/spotify-account-cleaner
npm install
npm run dev
```

Open your browser at `http://127.0.0.1:5173/`.

### 3. Usage
1. Enter your **Spotify Client ID** and click **Connect with Spotify**.
2. Click **Scan Account** to inspect your saved songs, playlists, albums, artists, episodes, and podcasts.
3. Check the categories you wish to clear (or leave all checked to wipe everything).
4. Click **Wipe Selected Items**, type `DELETE EVERYTHING`, and confirm.

---

## 🐍 Terminal CLI Usage (Optional)

If you prefer running directly from terminal:

```bash
cd /home/user/Projects/spotify-account-cleaner
python3 cleaner_cli.py
```

Follow the prompts to enter your Spotify Client ID and Client Secret.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: Vanilla JS (ES Modules) + HTML5 + Custom Spotify Dark Theme CSS
- **Build Tool**: Vite
- **Engine**: Trikatuka2 API patterns & OAuth 2.0 PKCE authentication flow
- **API Version**: Spotify Web API v1
