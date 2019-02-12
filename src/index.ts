import * as Discord from "discord.js";
import nodeCleanup from "node-cleanup";

import { Bot } from "./bot";
import { IConfig } from "./config";

class Client extends Discord.Client {

    private config: IConfig;
    private bots: Map<Discord.Snowflake, Bot> = new Map();

    constructor(configPath: string, opts?: Discord.ClientOptions) {
        super(opts);
        this.config = require(configPath);
        this.on("ready", this.onReady);
        this.on("message", this.onMessage);
        this.on("voiceStateUpdate", this.onVoiceStateUpdate);
        this.login(this.config.discordToken);
    }

    public disconect() {
        this.bots.forEach((bot) => bot.disconnect());
    }

    private onReady() {
        if (this.user) {
            console.log(`Logged in as ${this.user.tag}!`);
        }

        // debug
        const channel = this.channels.get("524975496342274093");
        if (channel && channel.type === "voice") {
            const voiceChannel: Discord.VoiceChannel = channel as Discord.VoiceChannel;
            voiceChannel.join()
                .then((connection) => {
                    const bot = new Bot(
                        connection,
                        this.config.snowboyModels,
                        this.config.ytApiToken);
                    this.bots.set(voiceChannel.guild.id, bot);
                }).catch(console.error);
        }
    }

    private onMessage(message: Discord.Message) {
        // Voice only works in guilds, if the message does not come from a guild, we ignore it
        if (!message.guild) { return; }

        // message intended for us?
        if (!message.content.startsWith(this.config.prefix)) {
            return;
        }

        const bot = this.bots.get(message.guild.id);

        switch (message.content.slice(this.config.prefix.length)) {
            case "join": {
                // Only try to join the sender's voice channel if they are in one themselves
                if (!message.member.voice.channel) {
                    message.reply("You need to join a voice channel first!");
                    return;
                }

                // Are we connected already?
                if (bot && bot.connection.channel.id === message.member.voice.channelID) {
                    console.debug("we are already connected to", bot.connection.channel.name);
                    return;
                }

                // cleanup existing connection
                if (bot) {
                    console.debug("cleaning up existing connection to", bot.connection.channel.name);
                    bot.disconnect();
                }

                // setup new connection
                const voiceChannel = message.member.voice.channel;
                voiceChannel.join()
                    .then((con: Discord.VoiceConnection) => {
                        // create a new bot
                        const newBot = new Bot(con, this.config.snowboyModels, this.config.ytApiToken);
                        this.bots.set(message.guild.id, newBot);

                        con.on("error", (err) => console.log("connection error, need to destroy channel bot here???"));
                        con.on("disconnect", (err) => {
                            console.log("voiceConnection disconnect, removing bot from map");
                            this.bots.delete(message.guild.id);
                        });
                    }).catch(console.error);
                break;
            }
            case "leave": {
                // leave if we have a voice connection to the channel of the author of the message
                if (bot && bot.connection.channel.id === message.member.voice.channelID) {
                    bot.disconnect();
                    this.bots.delete(message.guild.id);
                }
                break;
            }
        }
    }

    private onVoiceStateUpdate(oldState: Discord.VoiceState, newState: Discord.VoiceState) {
        // ignore ourself
        if (this.user && this.user.id === oldState.member.user.id) {
            return;
        }

        // ignore if we dont have a connection
        const bot = this.bots.get(newState.member.guild.id);
        if (!bot) {
            return;
        }

        // ignore if not the connected channel
        if (newState.channelID !== bot.connection.channel.id && oldState.channelID !== bot.connection.channel.id) {
            return;
        }

        bot.onVoiceStateUpdate(oldState, newState);
    }
}

const client = new Client("../config.json", {});

process.on("SIGINT", () => {
    // close every connection
    if (client) {
        client.disconect();
    }
    process.exit();
});
