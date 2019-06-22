import * as Discord from "discord.js";
import ffmpeg, { FfmpegCommand } from "fluent-ffmpeg";
import * as fs from "fs";
import { EventEmitter } from "events";
// @ts-ignore
import * as prism from "prism-media";
// @ts-ignore
import Models from "snowboy";

import { Readable, Writable } from "stream";
import { Command } from "./command";
import * as Config from "./config.json";
import { Player } from "./player";
import { Song } from "./song";
import { SpeechRecognizer } from "./speech-recognizer";

const COMMANDS: Command[] = [
    { command: "play", minWords: 1, maxWords: 20 },
    { command: "next result", minWords: 1, maxWords: 2 },
    { command: "add", minWords: 1, maxWords: 20 },
    { command: "pause", minWords: 1, maxWords: 1 },
    { command: "resume", minWords: 1, maxWords: 1 },
    { command: "skip", minWords: 1, maxWords: 1 },
    { command: "stop", minWords: 1, maxWords: 1 },
    { command: "leave", minWords: 1, maxWords: 1 },
];

export class Bot {

    public readonly connection: Discord.VoiceConnection;
    private models: Models;
    private player: Player;
    private manuallyPaused: boolean = false;
    private users: Map<Discord.Snowflake, {
        discordStream: Readable,
        ffmpegCommand: FfmpegCommand,
        recognizer: Writable,
    }> = new Map();

    constructor(connection: Discord.VoiceConnection, models: Models, ytApiKey: string) {
        this.connection = connection;
        this.models = models;
        this.player = new Player(connection, ytApiKey, true)
            .on("song", (song: Song) => {
                // TODO communicate to user
            })
            .on("end", () => {
                // TODO communicate to user
            })
            .on("error", (error, song) => console.error(error, song));

        // listen to current members of the channel
        for (const member of this.connection.channel.members.values()) {
            this.listenTo(member);
        }
    }

    public onVoiceStateUpdate(oldState: Discord.VoiceState, newState: Discord.VoiceState) {
        // user muted/deafened himself -> ignore?
        if (newState.member && newState.channelID === oldState.channelID) {
            console.debug(newState.member.user.username, "muted/deafened himself");

            // member joined channel
        } else if (newState.member && newState.channelID === this.connection.channel.id) {
            console.debug(newState.member.user.username, "connected");
            this.listenTo(newState.member);
            // member left channel
        } else if (oldState.member && oldState.channelID === this.connection.channel.id) {
            console.debug(oldState.member.user.username, "disconnected");
            this.stopListeningTo(oldState.member);
        }
    }

    public disconnect() {
        // disconnect from all channel members
        this.connection.channel.members.forEach((member) => this.stopListeningTo(member));
        // end music player
        this.player.stop();
        console.debug("disconnected from channel", this.connection.channel.name);
        // disconnect from channel
        this.connection.disconnect();
    }

    public onHotword(member: Discord.GuildMember) {
        console.debug("onHotword", member.user.username);
        if (this.player.isPlaying) {
            this.player.pause();
        }
        this.playSoundEffect("sounds/wake.ogg");
    }

    public onBadCommand(member: Discord.GuildMember, command: string, text: string) {
        console.debug("onBadCommand", command + ":", text);
        if (this.player.isPlaying) {
            this.player.pause();
        }
        this.playSoundEffect("sounds/failure-02.ogg", () => {
            if (this.player.isPaused && !this.manuallyPaused) {
                this.player.resume();
            }
        });
    }

    public onTextCommand(member: Discord.GuildMember, command: string, text:string) {
        if (COMMANDS.some(availableCommand => command === availableCommand.command)) {
            this.onCommand(member, command, text);
        } else {
            this.onBadCommand(member, command, text);
        }
    }

    public onCommand(member: Discord.GuildMember, command: string, text: string) {
        console.debug("onCommand", command + ":", text);
        if (this.player.isPlaying) {
            this.player.pause();
        }
        this.playSoundEffect("sounds/success-01.ogg", () => {
            switch (command) {
                case "play":
                    this.manuallyPaused = false;
                    this.player.clearPaused();
                    this.player.play(text);
                    break;
                case "next result":
                    this.manuallyPaused = false;
                    this.player.clearPaused();
                    this.player.playNextResult();
                    break;
                case "add":
                    this.player.add(text);
                    // playing a sound effect pauses the currently played music so we need to resume here
                    if (this.player.isPaused && !this.manuallyPaused) {
                        this.player.resume();
                    }
                    break;
                case "pause":
                    this.manuallyPaused = true;
                    // we already paused because of the sound effects
                    break;
                case "resume":
                    this.manuallyPaused = false;
                    this.player.resume();
                    break;
                case "skip":
                    this.player.clearPaused();
                    this.manuallyPaused = false;
                    this.player.playNext();
                    break;
                case "stop":
                    this.manuallyPaused = false;
                    this.player.stop();
                    break;
                case "leave":
                    this.disconnect();
                    break;
                default:
                    console.debug(command + " is no known command");
                    if (this.player.isPaused && !this.manuallyPaused) {
                        this.player.resume();
                    }
            }
        });
    }

    public playSoundEffect(path: string, cb?: () => void) {
        console.log("playing sound file" + path);
        this.connection.play(fs.createReadStream(path), { type: "ogg/opus", volume: Config.volume })
            .on("finish", () => {
                if (cb) {
                    cb();
                }
            })
            .on("error", (error) => console.log("dispatcher error:", path, error));
    }

    private listenTo(member: Discord.GuildMember) {
        // dont listen to ourself
        if (this.connection.client.user && this.connection.client.user.id === member.id) {
            return;
        }

        // if already listening, stop listening before
        if (this.users.has(member.id)) {
            this.stopListeningTo(member);
        }

        const discordStream = this.connection.receiver.createStream(member, { mode: "pcm", end: "manual" })
            // .on("data", () => console.debug("sound"))
            .on("error", () => console.error)
            .on("end", () => console.debug("user discordStream ended"));

        const recognizer = new SpeechRecognizer(this.models, COMMANDS)
            .on("hotword", () => this.onHotword(member))
            .on("command", (command: string, text: string) => this.onCommand(member, command, text))
            .on("bad-command", (command: string, text: string) => this.onBadCommand(member, command, text));

        const ffmpegCommand = ffmpeg(discordStream)
            .inputFormat("s32le")
            .audioFrequency(16000)
            .audioCodec("pcm_s16le")
            .format("s16le")
            .on("error", console.error);
        ffmpegCommand.pipe(recognizer);

        this.users.set(member.id, { discordStream, ffmpegCommand, recognizer });

        console.debug("listening to", member.user.username);
    }

    private stopListeningTo(member: Discord.GuildMember) {
        if (!this.connection) {
            return;
        }

        if (this.connection.client.user && member.id === this.connection.client.user.id) {
            return;
        }

        const user = this.users.get(member.id);
        if (!user) {
            return;
        }

        // @ts-ignore
        user.discordStream.push(null);
        // user.discordStream.destroy();
        this.users.delete(member.id);
        console.debug("stopped listening to", member.user.username);
    }
}
