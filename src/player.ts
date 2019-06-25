import { emit } from "cluster";
import * as Discord from "discord.js";
import { EventEmitter } from "events";
import request from "request";
import { Readable } from "stream";
import ytdl from "ytdl-core";

import * as Config from "./config.json";
import { Song } from "./song";

const YT_API_URL = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEO_URL = "https://www.youtube.com/watch?v=";

export class Player extends EventEmitter {

    private connection: Discord.VoiceConnection;
    private ytApiKey: string;
    private queue: Song[] = [];
    private lastPlayed?: Song;
    private paused: {
        song: Song,
        opus: Readable,
        ffmpeg: Readable,
    } | null = null;
    private autoplay: boolean;
    private autoplayHistory: string[] = [];
    private onPlayFinish: () => void;
    
    constructor(connection: Discord.VoiceConnection, ytApiKey: string, autoplay: boolean) {
        super();
        this.connection = connection;
        this.ytApiKey = ytApiKey;
        this.autoplay = autoplay;
        /**
         * gets called when a song is finished
         */
        this.onPlayFinish = () => {
            console.log("dispatcher finished, playing next");
            this.playNext();
        };
    }


    /**
     * getter for paused status
     */
    public get isPaused() {
        return Boolean(this.paused);
    }

    /**
     * getter for playing status
     */
    public get isPlaying() {
        return this.connection.speaking.has(Discord.Speaking.FLAGS.SPEAKING);
    }

    /**
     * - adds search query
     * - skips current song
     * - starts when it was not playing before
     * @param search song to search and play from youtube
     */
    public play(search: string) {
        const opts = {
            qs: {
                key: this.ytApiKey,
                part: "id,snippet",
                q: search,
                type: "video",
            },
        };
        this.search(opts, (song) => {
            this.playSong(song, false);
        });
    }

    /**
     * adds a song to the queue
     * @param search song to search and play from youtube
     */
    public add(search: string) {
        const opts = {
            qs: {
                key: this.ytApiKey,
                part: "id,snippet",
                q: search,
                type: "video",
            },
        };
        this.search(opts, (song) => {
            this.queue.push(song);
        });
    }

    /**
     * pauses the currently played song (by unpiping the opus stream)
     */
    public pause() {
        if (!this.isPlaying || !this.lastPlayed) {
            console.log("skipping pause call, we're not Playing");
            return;
        }
        if (this.paused) {
            console.log("skipping pause call, we're already paused");
            return;
        }
        this.paused = {
            // @ts-ignore
            ffmpeg: this.connection.dispatcher.streams.ffmpeg,
            // @ts-ignore
            opus: this.connection.dispatcher.streams.opus,
            song: this.lastPlayed,
        };
        // @ts-ignore
        this.connection.dispatcher.streams.ffmpeg = null;
        // @ts-ignore
        this.connection.dispatcher.streams.opus = null;
        this.connection.dispatcher.removeListener("finish", this.onPlayFinish);
        this.connection.dispatcher.destroy();
    }

    /**
     * clear paused song
     */
    public clearPaused() {
        if (this.paused) {
            if (this.paused.song.stream) {
                this.paused.song.stream.push(null);
                this.paused.song.stream.destroy();
            }
            this.paused = null;
        }
    }

    /**
     * resumes if there is a paused song
     */
    public resume() {
        if (this.isPlaying) {
            console.log("skipping resume, we're currently Playing");
            return;
        }

        if (this.paused) {
            this.connection.play(this.paused.opus, { type: "opus" })
                .on("finish", this.onPlayFinish)
                .on("close", () => console.log("dispatcher closed previously paused"))
                .on("end", () => console.log("dispatcher ended previously paused"))
                .on("start", () => console.log("dispatcher started previously paused"))
                .on("debug", (debug) => console.log("dispatcher debug previously paused:", debug))
                .on("error", (error) => console.log("dispatcher error previously paused:", error));
            // @ts-ignore
            this.connection.dispatcher.streams.ffmpeg = this.paused.ffmpeg;
            this.paused = null;
        }
    }

    /**
     * stops anything played, resets the player
     * @event Player#end
     */
    public stop() {
        // finish currently played song
        if (this.lastPlayed && this.lastPlayed.stream) {
            this.lastPlayed.stream.push(null);
            this.lastPlayed.stream.destroy();
        }

        this.queue.length = 0;
        this.autoplayHistory.length = 0;
        this.clearPaused();

        // close discord player connection
        if (this.connection.dispatcher) {
            this.connection.dispatcher.destroy();
        }

        this.emit("end");
    }

    /**
     * plays the next search result from the last search
     */
    public playNextResult() {
        if (!this.lastPlayed) {
            return;
        }

        this.findNextValidSong(this.lastPlayed, (song) => {
            this.playSong(song, false);
        });
    }

    /**
     * plays the next song from queue or does autoplay if enabled
     * @event Player#end
     */
    public playNext() {
        // get first item from queue
        const song = this.queue.shift();

        if (!song) {
            if (this.autoplay) {
                this.doAutoplay();
            } else {
                this.emit("end");
            }
            return;
        }

        this.playSong(song, false);
    }

    /**
     * starts playing a given song
     * @param song 
     * @param calledByAutoplay
     */
    private playSong(song: Song, calledByAutoplay: Boolean) {
        if (!song.stream) {
            return;
        }

        if (!calledByAutoplay) {
            // clear autoplay history
            this.autoplayHistory.length = 0;
        }
        this.autoplayHistory.push(song.videoId);

        this.connection.play(song.stream, { volume: Config.volume })
            .on("finish", this.onPlayFinish)
            .on("close", () => console.log("dispatcher closed", song.videoId))
            .on("end", () => console.log("dispatcher ended", song.videoId))
            .on("start", () => console.log("dispatcher started", song.videoId))
            .on("debug", (debug) => console.log("dispatcher debug:", song.videoId, debug))
            .on("error", (error) => console.log("dispatcher error:", song.videoId, error));

        this.lastPlayed = song;
        this.emit("song", song);
    }

    /**
     * searches and plays the next auto play song depending on the last played song
     */
    private doAutoplay() {
        if (!this.lastPlayed) {
            console.debug("skipping autoplay call, no last played song");
            return;
        }
        console.log("autoplaying...");
        const opts = {
            qs: {
                key: this.ytApiKey,
                part: "id,snippet",
                relatedToVideoId: this.lastPlayed.videoId,
                type: "video",
            },
        };
        this.search(opts, (song) => {
            this.playSong(song, true);
        });
    }

    /**
     * Does various youtube api calls depending on the given requestOpts
     * @param requestOpts 
     * @param cb 
     */
    private search(requestOpts: request.CoreOptions, cb: (song: Song) => void) {
        const reqSong = new Song(requestOpts);

        request(YT_API_URL, requestOpts,
            (error, response, body) => {
                // error check
                if (error || response.statusCode !== 200) {
                    const err = error || "Bad status code:" + response.statusCode;
                    console.error(err);
                    throw err;
                }

                reqSong.response = JSON.parse(body);
                this.findNextValidSong(reqSong, (song) => {
                    cb(song);
                });
            },
        );
    }

    /**
     * finds the next valid song item (ignores playlist and user items) by iterating through the search result item list
     * @param song 
     * @param cb 
     */
    private findNextValidSong(song: Song, cb: (song: Song) => void) {
        if (!song.response.items.length) {
            this.emit("error", { message: "No search results", song });
            return;
        }

        const startIndex = song.itemIndex;
        for (let i = song.itemIndex + 1; i < song.response.items.length; i++) {
            if (song.response.items[i].id.videoId) {
                song.itemIndex = i;
                break;
            }
        }
        
        // did we find a valid index?
        if (song.itemIndex !== startIndex) {
            // if the found song was already autoplayed, resume searching
            if (this.autoplayHistory.find((apVideoId) => apVideoId == song.videoId)) {
                console.debug(`skipping ${song.videoId} to prevent autplay loop`)
                this.findNextValidSong(song, cb);
                return;
            }

            const url = YT_VIDEO_URL + song.videoId;
            console.debug("queueing", url, "search text:", song.searchText);
             // highwatermark defines buffersize for the video download (1<<20 = 1048576 Bytes = ~1MB)
            song.stream = ytdl(url, { quality: "highestaudio", highWaterMark: 1<<20 })
                .on("info", (info: ytdl.videoInfo, format: ytdl.videoFormat) => {
                    song.info = info;
                })
                .on("end", () => console.log("ytdl stream end"))
                .on("close", () => console.log("ytdl stream close"))
                .on("error", (err) => console.error("ytdl stream error:", err));
            cb(song);
            // ...check next page if we dint't
        } else if (song.response.nextPageToken) {
            song.requestOpts.qs.pageToken = song.response.nextPageToken;
            this.search(song.requestOpts, cb);
            // we can't find a valid index
        } else {
            emit("error", { message: "No next page to search for valid videoId", song });
        }
    }
}
