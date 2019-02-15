import * as Discord from "discord.js";
import request from "request";
import { Readable } from "stream";
import ytdl from "ytdl-core";

const YT_API_URL = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEO_URL = "https://www.youtube.com/watch?v=";

export class Player {

    private connection: Discord.VoiceConnection;
    private ytApiKey: string;
    private queue: any[] = [];
    private lastPlayed: any;
    private paused: any;
    private autoplay: boolean;
    private onPlayFinish: () => void;

    constructor(connection: Discord.VoiceConnection, ytApiKey: string, autoplay: boolean) {
        this.connection = connection;
        this.ytApiKey = ytApiKey;
        this.onPlayFinish = () => {
            console.log("dispatcher finished, playing next");
            this.playNext();
        };
        this.autoplay = autoplay;
    }

    public get isPaused() {
        return Boolean(this.paused);
    }

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
                part: "id",
                q: search,
                type: "video",
            },
            url: YT_API_URL,
        };
        this.search(opts, (err, response) => {
            if (!err) {
                this.queue.unshift(response);
                this.skip();
            }
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
                part: "id",
                q: search,
                type: "video",
            },
            url: YT_API_URL,
        };
        this.search(opts, (err, response) => {
            if (!err) {
                this.queue.push(response);
            }
        });
    }

    /**
     * skippes the current song and playes the next one
     */
    public skip() {
        if (this.paused) {
            this.paused.ffmpeg.destroy();
            this.paused = null;
        }
        this.playNext();
    }

    /**
     * pauses the currently played song (by unpiping the opus stream)
     */
    public pause() {
        if (!this.isPlaying) {
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
        };
        // @ts-ignore
        this.connection.dispatcher.streams.ffmpeg = null;
        this.connection.dispatcher.removeListener("finish", this.onPlayFinish);
        this.connection.dispatcher.destroy();
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
     * stoppes anything played, resets the player
     */
    public stop() {
        this.queue = [];
        this.lastPlayed = false;
        if (this.isPaused) {
            this.paused.ffmpeg.destroy();
            this.paused = null;
        }
        if (this.connection.dispatcher) {
            this.connection.dispatcher.destroy();
        }
        if (this.connection.client.user) {
            this.connection.client.user.setActivity();
        }
        // TODO finish source stream here? (through stream.push(null))
    }

    /**
     * playes the next song from queue or does autoplay if enabled
     */
    private playNext() {
        // get next item from queue
        const response = this.queue.shift();

        if (!response) {
            if (this.autoplay) {
                this.doAutoplay();
            }
            return;
        }

        if (!response.items.length) {
            // TODO communicate bad result to user...
            return;
        }

        // play next item
        const video = response.items.find((item: any) => item.id.videoId);

        const url = YT_VIDEO_URL + video.id.videoId;
        console.debug("playing", url);
        const stream = ytdl(url, { quality: "highestaudio"/*, highWaterMark: 1*/ })
            .on("info", (info: ytdl.videoInfo, format: ytdl.videoFormat) => {
                if (this.connection.client.user) {
                    this.connection.client.user.setActivity(info.title, { type: "LISTENING" });
                }
            })
            .on("end", () => console.log("ytdl stream end"))
            .on("close", () => console.log("ytdl stream close"))
            .on("error", (error) => console.error("ytdl stream error:", error));

        this.connection.play(stream)
            .on("finish", this.onPlayFinish)
            .on("close", () => console.log("dispatcher closed", url))
            .on("end", () => console.log("dispatcher ended", url))
            .on("start", () => console.log("dispatcher started", url))
            .on("debug", (debug) => console.log("dispatcher debug:", url, debug))
            .on("error", (error) => console.log("dispatcher error:", url, error));

        this.lastPlayed = video;
    }

    private doAutoplay() {
        if (!this.lastPlayed) {
            console.debug("skipping autoplay call, no last played song");
            return;
        }
        console.log("autoplaying...");
        const opts = {
            qs: {
                key: this.ytApiKey,
                part: "id",
                relatedToVideoId: this.lastPlayed.id.videoId,
                type: "video",
            },
            url: YT_API_URL,
        };
        this.search(opts, (err, response) => {
            if (!err) {
                this.queue.push(response);
                this.playNext();
            }
        });
    }

    private search(reqOptions: request.Options, cb?: (err: any, res?: string) => any) {
        request(reqOptions,
            (error, response, body) => {
                if (error || response.statusCode !== 200) {
                    const err = error || "bad status code:" + response.statusCode;
                    console.error(err);
                    console.error(reqOptions);
                    console.error(body);
                    if (cb) {
                        cb(err);
                    }
                    return;
                }
                const responseJSON = JSON.parse(body);
                if (cb) {
                    cb(false, responseJSON);
                }
            },
        );
    }
}
