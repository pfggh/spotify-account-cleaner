/**
 * Helper module to generate and export Spotify library data to a CSV file.
 */

function escapeCsvField(field) {
  if (field === null || field === undefined) return '""';
  const str = String(field).replace(/"/g, '""');
  return `"${str}"`;
}

export function exportLibraryToCsv(inventory, username = 'spotify_user') {
  const rows = [];
  rows.push(['Type', 'Spotify ID', 'Title / Name', 'Artist / Creator / Publisher', 'Spotify URL']);

  // 1. Tracks
  if (inventory.tracks && inventory.tracks.length > 0) {
    inventory.tracks.forEach(item => {
      const t = item.track || item;
      const artists = t.artists ? t.artists.map(a => a.name).join('; ') : 'Unknown';
      const url = t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`;
      rows.push(['Liked Song', t.id || '', t.name || 'Untitled', artists, url]);
    });
  }

  // 2. Playlists
  if (inventory.playlists && inventory.playlists.length > 0) {
    inventory.playlists.forEach(p => {
      const owner = p.owner?.display_name || p.owner?.id || 'Unknown';
      const url = p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`;
      rows.push(['Playlist', p.id || '', p.name || 'Untitled Playlist', owner, url]);
    });
  }

  // 3. Albums
  if (inventory.albums && inventory.albums.length > 0) {
    inventory.albums.forEach(item => {
      const a = item.album || item;
      const artists = a.artists ? a.artists.map(ar => ar.name).join('; ') : 'Unknown';
      const url = a.external_urls?.spotify || `https://open.spotify.com/album/${a.id}`;
      rows.push(['Saved Album', a.id || '', a.name || 'Untitled Album', artists, url]);
    });
  }

  // 4. Artists
  if (inventory.artists && inventory.artists.length > 0) {
    inventory.artists.forEach(art => {
      const url = art.external_urls?.spotify || `https://open.spotify.com/artist/${art.id}`;
      rows.push(['Followed Artist', art.id || '', art.name || 'Untitled Artist', 'N/A', url]);
    });
  }

  // 5. Episodes
  if (inventory.episodes && inventory.episodes.length > 0) {
    inventory.episodes.forEach(item => {
      const ep = item.episode || item;
      const showName = ep.show?.name || 'Unknown Show';
      const url = ep.external_urls?.spotify || `https://open.spotify.com/episode/${ep.id}`;
      rows.push(['Podcast Episode', ep.id || '', ep.name || 'Untitled Episode', showName, url]);
    });
  }

  // 6. Shows
  if (inventory.shows && inventory.shows.length > 0) {
    inventory.shows.forEach(item => {
      const s = item.show || item;
      const publisher = s.publisher || 'Unknown Publisher';
      const url = s.external_urls?.spotify || `https://open.spotify.com/show/${s.id}`;
      rows.push(['Podcast Show', s.id || '', s.name || 'Untitled Show', publisher, url]);
    });
  }

  if (rows.length <= 1) {
    alert('No items available to export into CSV.');
    return;
  }

  // Build CSV String
  const csvContent = rows
    .map(row => row.map(escapeCsvField).join(','))
    .join('\r\n');

  // Trigger Download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${username}_spotify_backup_${dateStr}.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
