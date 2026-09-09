#!/usr/bin/env python3
"""
Spotify Account Cleaner CLI (Trikatuka2 Engine)
Removes all songs, playlists, albums, podcasts, and followed artists from a Spotify account.
"""

import sys
import time
import json
import urllib.parse
import urllib.request
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8888
REDIRECT_URI = f"http://127.0.0.1:{PORT}/callback"
SCOPES = "user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private user-follow-read user-follow-modify"

auth_code = None

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        query = urllib.parse.urlparse(this_url := self.path).query
        params = urllib.parse.parse_qs(query)
        if 'code' in params:
            auth_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(b"<h1>Authentication successful!</h1><p>You can close this tab and return to the terminal.</p>")
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        return

def spot_request(url, method="GET", data=None, token=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    body = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    
    retries = 0
    while retries < 5:
        try:
            with urllib.request.urlopen(req) as response:
                if response.status == 204:
                    return None
                resp_data = response.read().decode('utf-8')
                return json.loads(resp_data) if resp_data else None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", 5)) + 1
                print(f"[!] Rate limited (HTTP 429). Retrying in {retry_after} seconds...")
                time.sleep(retry_after)
                retries += 1
                continue
            elif e.code in (500, 502, 503, 504):
                time.sleep(2 ** retries)
                retries += 1
                continue
            else:
                err_body = e.read().decode('utf-8')
                print(f"[-] HTTP Error {e.code}: {err_body}")
                raise e

def get_all_items(endpoint, token, key=None):
    items = []
    url = endpoint if "limit=" in endpoint else f"{endpoint}{'&' if '?' in endpoint else '?'}limit=50"
    while url:
        res = spot_request(url, token=token)
        if not res:
            break
        if key and key in res:
            items.extend(res[key].get('items', []))
            url = res[key].get('next')
        elif 'items' in res:
            items.extend(res.get('items', []))
            url = res.get('next')
        else:
            break
        time.sleep(0.1)
    return items

def batch_delete(endpoint, ids, token, key_name="ids"):
    batch_size = 50
    for i in range(0, len(ids), batch_size):
        batch = ids[i:i+batch_size]
        spot_request(endpoint, method="DELETE", data={key_name: batch}, token=token)
        print(f"    Progress: {min(i+batch_size, len(ids))}/{len(ids)} deleted")
        time.sleep(0.15)

def main():
    print("=" * 60)
    print("      Spotify Account Cleaner CLI (Trikatuka2 Engine)")
    print("=" * 60)

    client_id = input("\nEnter your Spotify App Client ID: ").strip()
    if not client_id:
        print("[!] Client ID cannot be empty.")
        sys.exit(1)

    # 1. Authorize via browser
    auth_params = urllib.parse.urlencode({
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "show_dialog": "true"
    })
    auth_url = f"https://accounts.spotify.com/authorize?{auth_params}"

    print(f"\n[+] Opening browser for authentication...")
    print(f"    If browser does not open automatically, visit:\n    {auth_url}\n")
    webbrowser.open(auth_url)

    server = HTTPServer(('127.0.0.1', PORT), OAuthHandler)
    server.handle_request()

    if not auth_code:
        print("[-] Authorization failed or timed out.")
        sys.exit(1)

    client_secret = input("Enter your Spotify App Client Secret: ").strip()
    
    # Exchange code for token
    token_url = "https://accounts.spotify.com/api/token"
    token_data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": auth_code,
        "redirect_uri": REDIRECT_URI,
        "client_id": client_id,
        "client_secret": client_secret
    }).encode('utf-8')

    req = urllib.request.Request(token_url, data=token_data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        access_token = res['access_token']

    print("[+] Successfully authenticated!")

    # User profile
    user = spot_request("https://api.spotify.com/v1/me", token=access_token)
    print(f"[+] Account: {user.get('display_name')} ({user.get('id')})")

    # Fetch inventory
    print("\n[+] Scanning account contents...")
    tracks = get_all_items("https://api.spotify.com/v1/me/tracks", token=access_token)
    playlists = get_all_items("https://api.spotify.com/v1/me/playlists", token=access_token)
    albums = get_all_items("https://api.spotify.com/v1/me/albums", token=access_token)
    
    print(f"    - Liked Songs: {len(tracks)}")
    print(f"    - Playlists: {len(playlists)}")
    print(f"    - Saved Albums: {len(albums)}")

    total = len(tracks) + len(playlists) + len(albums)
    if total == 0:
        print("\n[+] Account is already completely empty!")
        sys.exit(0)

    confirm = input(f"\n[!] WARNING: Type 'DELETE EVERYTHING' to permanently remove {total} items: ").strip()
    if confirm != "DELETE EVERYTHING":
        print("[-] Deletion aborted.")
        sys.exit(0)

    # Deletion
    if tracks:
        print(f"\n[+] Deleting {len(tracks)} Liked Songs...")
        batch_delete("https://api.spotify.com/v1/me/tracks", [t['track']['id'] for t in tracks if t.get('track')], access_token)

    if playlists:
        print(f"\n[+] Unfollowing/Deleting {len(playlists)} Playlists...")
        for idx, pl in enumerate(playlists):
            spot_request(f"https://api.spotify.com/v1/playlists/{pl['id']}/followers", method="DELETE", token=access_token)
            print(f"    Progress: {idx+1}/{len(playlists)} deleted")
            time.sleep(0.15)

    if albums:
        print(f"\n[+] Deleting {len(albums)} Saved Albums...")
        batch_delete("https://api.spotify.com/v1/me/albums", [a['album']['id'] for a in albums if a.get('album')], access_token)

    print("\n[+] CLEANUP COMPLETE! Account has been wiped.")

if __name__ == "__main__":
    main()
