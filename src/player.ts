import * as Discord from "discord.js";
import * as fs from "fs";
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
    private onPlayFinish: () => void;

    public get isPaused() {
        return Boolean(this.paused);
    }

    public get isPlaying() {
        return this.connection.speaking.has(Discord.Speaking.FLAGS.SPEAKING);
    }

    constructor(connection: Discord.VoiceConnection, ytApiKey: string) {
        this.connection = connection;
        this.ytApiKey = ytApiKey;
        this.onPlayFinish = () =>  {
            console.log("dispatcher finished, playing next");
            this.playNext();
        };
    }

    public play(search: string) {
        this.enqueue({
            qs: {
                key: this.ytApiKey,
                part: "id",
                q: encodeURIComponent(search),
                type: "video",
            },
            url: YT_API_URL,
        });
    }

    public playSoundFile(path: string, cb?: () => void) {
        console.log("playing sound file" + path);
        this.connection.play(fs.createReadStream(path), { type: "ogg/opus" })
            .on("finish", () => {
                if (cb) {
                    cb();
                }
            })
            .on("error", (error) => console.log("dispatcher error:", path, error));
    }

    public skip() {
        if (this.paused) {
            this.paused.ffmpeg.destroy();
            this.paused = null;
            this.playNext();
        } else {
            console.log("can't skip, nothing on hold");
        }
    }

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

    public pause() {
        if (!this.isPlaying) {
            console.log("can't pause, we're not Playing");
            return;
        }
        if (this.paused) {
            console.log("can't pause, we're already paused");
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

    public resume() {
        if (!this.paused) {
            console.log("can't resume, we're not paused");
            return;
        }
        if (this.isPlaying) {
            console.log("can't resume, we're currently Playing");
            return;
        }
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

    private enqueue(reqOptions: request.Options) {
        request(reqOptions,
            (error, response, body) => {
                if (error || response.statusCode !== 200) {
                    console.error(error || "bad status code:" + response.statusCode);
                    console.error(reqOptions);
                    console.error(body);
                    return;
                }
                const responseJSON = JSON.parse(body);
                this.queue.push(responseJSON);

                if (!this.isPlaying && !this.isPaused) {
                    this.playNext();
                }
            },
        );
    }

    private playNext() {
        // play paused stream if there is one
        if (this.paused) {
            this.resume();
            return;
        }

        // get next item from queue
        const response = this.queue.shift();
        if (!response) {
            this.autoplay();
            return;
        }

        // play next item
        const video = response.items.find((item: any) => item.id.videoId);
        const url = YT_VIDEO_URL + video.id.videoId;
        console.debug("playing", url);
        const stream = ytdl(url, { quality: "highestaudio"/*, highWaterMark: 1*/})
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

    private autoplay() {
        if (!this.lastPlayed) {
            return;
        }
        console.log("autoplaying...");
        this.enqueue({
            qs: {
                key: this.ytApiKey,
                part: "id",
                relatedToVideoId: this.lastPlayed.id.videoId,
                type: "video",
            },
            url: YT_API_URL,
        });
    }
}
