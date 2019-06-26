// @ts-ignore
import Spotify from 'node-spotify-api';

export interface PlaylistProvider {
    extractPlaylistId: (s: string) => string | null;
    getPlaylist: (playlistId: string) => Promise<string[]>;
}

export class SpotifyPlaylistProvider implements PlaylistProvider {
    private spotifyApi: Spotify;

    constructor(clientId: string, clientSecret: string) {
        this.spotifyApi = new Spotify({
            id: clientId,
            secret: clientSecret
        });
    }

    /**
     * Extracts the playlist id from spotify playlist URI or URL
     * e.g. URL: https://open.spotify.com/playlist/2gaE8Y3U4aGTVrUCH1A5dQ?si=AaAa1aaAAA-AAaaAA12AAA
     * e.g. URI: spotify:playlist:2gaE8Y3U4aGTVrUCH1A5dQ
     * @param s the string to extract the playlist id from
     * @returns string | null a string containing the playlist id or null
     */
    public extractPlaylistId(s: string) {
        const BASE_URL = 'spotify:playlist:';
        const BASE_URI = 'https://open.spotify.com/playlist/'
        const PLAYLIST_STRLENGTH = 22;
        // extract playlist id from url
        if (s.startsWith(BASE_URL) && s.length >= BASE_URL.length + PLAYLIST_STRLENGTH) {
            return s.substr(BASE_URL.length, PLAYLIST_STRLENGTH);
        // extract playlist id from uri
        } else if (s.startsWith(BASE_URI) && s.length >= BASE_URI.length + PLAYLIST_STRLENGTH) {
            return s.substr(BASE_URI.length, PLAYLIST_STRLENGTH);
        } else {
            return null;
        }
    }
 
    /**
     * 
     * @param playlistId the playlist id to get the tracks from
     * @returns Promise<string[]> a Promise returning an array of strings, each containing author and title of the song
     */
    public getPlaylist(playlistId: string): Promise<string[]> {
        return this.requestPlaylist(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
    }

    private requestPlaylist(url: string, songs: string[] = []): Promise<string[]> {
        return this.spotifyApi.request(url)
            .then((data: any) => {
                for (const item of data.items) {
                    let artistsString = '';
                    for (const artist of item.track.artists) {
                        artistsString += artist.name + ' ';
                    }
                    songs.push(artistsString + '- ' + item.track.name);
                }

                if (data.next) {
                    return this.requestPlaylist(data.next, songs);
                }
                return songs;
            });
    }
}

