import * as Discord from "discord.js";
import ffmpeg, { FfmpegCommand } from "fluent-ffmpeg";
import * as fs from "fs";
// @ts-ignore
import Models from "snowboy";

import { Readable, Writable } from "stream";
import { Command } from "./command";
import * as Config from "./config.json";
import { Player } from "./player";
import { Song } from "./song";
import { SpeechRecognizer } from "./speech-recognizer";
import { PlaylistProvider, SpotifyPlaylistProvider } from "./playlistProvider";

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
    private spotifyPP: SpotifyPlaylistProvider;
    private users: Map<Discord.Snowflake, {
        discordStream: Readable,
        ffmpegCommand: FfmpegCommand,
        recognizer: Writable,
    }> = new Map();

    constructor(connection: Discord.VoiceConnection) {
        this.connection = connection;
        this.models = Config.snowboyModels;
        this.spotifyPP = new SpotifyPlaylistProvider(Config.spotifyClientID, Config.spotifyClientSecret);
        this.player = new Player(connection, Config.ytApiToken, true)
            .on("song", (song: Song) => {
                // TODO communicate to user
            })
            .on("end", () => {
                // TODO communicate to user
            })
            .on("error", (error, song) => console.error(error, song));

        // listen to current members of the channel
        for (const member of this.connection.channel.members.values()) {
            // ignore bots
            if (member.user.bot) {
                continue;
            }

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

            // leave channel if alone
            if (this.users.size == 0) {
                this.disconnect();
            }
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
        this.playSoundEffect("sounds/failure-02.ogg").then(() => {
            if (this.player.isPaused && !this.manuallyPaused) {
                this.player.resume();
            }
        });
    }

    public onTextCommand(member: Discord.GuildMember, command: string) {
        let found: boolean = false;
        let text = '';
        for (const defCommand of COMMANDS) {
            if (command.startsWith(defCommand.command)) {
                found = true;
                text = command.slice(defCommand.command.length + 1);
                command = command.slice(0, defCommand.command.length);
            }
        }

        if (found) {
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
        this.playSoundEffect("sounds/success-01.ogg").then(() => {
            switch (command) {
                case "play":
                    this.manuallyPaused = false;
                    this.player.clearPaused();
                    this.extractSongs(text)
                    .then(songs => {
                        // play the first song
                        this.player.play(songs.shift() || '');
                        // add the rest to the playlist
                        for (let song of songs) {
                            this.player.add(song);
                        }
                    }).catch((err: any) => {
                        console.error(err);
                    })
                    break;
                case "next result":
                    this.manuallyPaused = false;
                    this.player.clearPaused();
                    this.player.playNextSearchResult();
                    break;
                case "add":
                    this.extractSongs(text)
                    .then(songs => {
                        for (let song of songs) {
                            this.player.add(song);
                        }
                    }).catch((err: any) => {
                        console.error(err);
                    })
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

    /**
     * 
     * @param text 
     * @returns Promise<string[]> A Promise returning a string array, containing author and title of the songs
     */
    public extractSongs(text: string) {
        // example spotify links:
        // spotify:playlist:2gaE8Y3U4aGTVrUCH1A5dQ
        // https://open.spotify.com/playlist/2gaE8Y3U4aGTVrUCH1A5dQ?si=DgDs8jnYSM-C5axXZ76VOQ
        text = text.trimLeft();
        text = text.trimRight();
        const playlistID = this.spotifyPP.extractPlaylistId(text);
        if (playlistID) {
            return this.spotifyPP.getPlaylist(playlistID);
        } else {
            return Promise.resolve([text]);
        }
    }

    public playSoundEffect(path: string): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log("playing sound file", path);
            this.connection.play(fs.createReadStream(path), { type: "ogg/opus", volume: Config.volume })
                .on("finish", () => resolve())
                .on("error", error => reject({error, path}));
        });
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

        // important! if not executed, ffmpeg streams wont end
        user.discordStream.push(null);
        // any sense executing destroy after push(null)?
        user.discordStream.destroy();

        this.users.delete(member.id);
        console.debug("stopped listening to", member.user.username);
    }
}
