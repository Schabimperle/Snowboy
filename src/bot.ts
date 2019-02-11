import * as Discord from "discord.js";
// @ts-ignore
import * as prism from "prism-media";
// @ts-ignore
import Models from "snowboy";
import { Player } from "./player";
import { User } from "./user";

const GOOGLE_KEYS_PATH = "./google-keys.json";

export class Bot {

    public readonly connection: Discord.VoiceConnection;
    private models: Models;
    private ytApiKey: string;
    private player: Player;

    constructor(connection: Discord.VoiceConnection, models: Models, ytApiKey: string) {
        this.connection = connection;
        this.models = models;
        this.ytApiKey = ytApiKey;
        this.player = new Player(connection, ytApiKey);

        // listen to current members of the channel
        for (const member of this.connection.channel.members.values()) {
            this.listenTo(member);
        }
    }

    public onVoiceStateUpdate(oldState: Discord.VoiceState, newState: Discord.VoiceState) {
        // user muted/deafened himself -> ignore?
        if (newState.channelID === oldState.channelID) {
            console.debug(newState.member.user.username, "muted/deafened himself");

        // member joined channel
        } else if (newState.channelID === this.connection.channel.id) {
            console.debug(newState.member.user.username, "connected");
            this.listenTo(newState.member);
        // member left channel
        } else if (oldState.channelID === this.connection.channel.id) {
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

    public onHotword(user: User) {
        console.debug("onHotword", user.member.user.username);
        if (this.player.isPlaying) {
            this.player.pause();
        }
        this.player.playSoundFile("sounds/wake.ogg");
    }

    public onBadCommand(user: User, command: string, text: string) {
        console.debug("onBadCommand", command + ":", text);
        this.player.playSoundFile("sounds/failure-02.ogg", () => {
            if (this.player.isPaused) {
                this.player.resume();
            }
        });
    }

    public onCommand(user: User, command: string, text: string) {
        console.debug("onCommand", command + ":", text);
        this.player.playSoundFile("sounds/success-01.ogg", () => {
            switch (command) {
                case "play": {
                    this.player.play(text);
                    break;
                }
                case "pause": {
<<<<<<< HEAD
                    // automatically pausing because we played the success sound
=======
                    this.player.pause();
>>>>>>> 8db5c7200d188571c8fe5b9aeac9d13302878de7
                    break;
                }
                case "resume": {
                    this.player.resume();
                }
                case "skip": {
                    this.player.skip();
                    break;
                }
                case "stop": {
                    this.player.stop();
                    break;
                }
                case "leave": {
                    this.connection.disconnect();
                    break;
                }
                default: {
                    console.debug("command '" + command + "' not implemented yet");
                }
            }
        });
    }

    private listenTo(member: Discord.GuildMember) {
        // dont listen to ourself
        if (this.connection.client.user && this.connection.client.user.id === member.id) {
            return;
        }

        const stream = this.connection.receiver.createStream(member, { mode: "pcm", end: "manual" });
        const user: User = new User(member, stream, this.models, GOOGLE_KEYS_PATH, [
                "play",
                "pause",
                "resume",
                "stop",
                "skip",
                "leave",
            ])
            .on("hotword", () => this.onHotword(user))
            .on("command", (command: string, text: string) => this.onCommand(user, command, text))
            .on("bad-command", (command: string, text: string) => this.onBadCommand(user, command, text));

        console.debug("listening to", member.user.username);
    }

    private stopListeningTo(member: Discord.GuildMember) {
        if (!this.connection) {
            return;
        }
6;
        if (this.connection.client.user && member.id === this.connection.client.user.id) {
            return;
        }
        // returns an existing stream if there is one already (which should be the case)
        const stream = this.connection.receiver.createStream(member);
        stream.push(null);
        console.debug("stopped listening to", member.user.username);
    }
}
