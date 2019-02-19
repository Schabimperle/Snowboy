import * as Discord from "discord.js";
import nodeCleanup from "node-cleanup";

import { Bot } from "./bot";
import * as Config from "./config.json";

class Client extends Discord.Client {

    private bots: Map<Discord.Snowflake, Bot> = new Map();

    constructor(opts?: Discord.ClientOptions) {
        super(opts);
        this.on("ready", this.onReady);
        this.on("message", this.onMessage);
        this.on("voiceStateUpdate", this.onVoiceStateUpdate);
        this.login(Config.discordToken);
    }

    public disconect() {
        this.bots.forEach((bot) => bot.disconnect());
        this.destroy();
    }

    private onReady() {
        if (this.user) {
            console.log(`Logged in as ${this.user.tag}!`);
        }

        // debug
        if (Config.testChannelId) {
            const channel = this.channels.get(Config.testChannelId);
            if (channel && channel.type === "voice") {
                const voiceChannel: Discord.VoiceChannel = channel as Discord.VoiceChannel;
                voiceChannel.join()
                    .then((connection) => {
                        const bot = new Bot(
                            connection,
                            Config.snowboyModels,
                            Config.ytApiToken);
                        this.bots.set(voiceChannel.guild.id, bot);
                    }).catch(console.error);
            }
        }
    }

    private onMessage(message: Discord.Message) {
        // Voice only works in guilds, if the message does not come from a guild, we ignore it
        if (!message.guild) { return; }

        // message intended for us?
        if (!message.content.startsWith(Config.prefix)) {
            return;
        }

        const bot = this.bots.get(message.guild.id);

        switch (message.content.slice(Config.prefix.length)) {
            case "join":
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
                        const newBot = new Bot(con, Config.snowboyModels, Config.ytApiToken);
                        this.bots.set(message.guild.id, newBot);

                        con.on("error", (err) => console.log("connection error, need to destroy channel bot here???"));
                        con.on("disconnect", (err) => {
                            console.log("voiceConnection disconnect, removing bot from map");
                            this.bots.delete(message.guild.id);
                        });
                    }).catch(console.error);
                break;
            case "leave":
                // leave if we have a voice connection to the channel of the author of the message
                if (bot && bot.connection.channel.id === message.member.voice.channelID) {
                    bot.disconnect();
                    this.bots.delete(message.guild.id);
                }
                break;
            case "help":
                message.reply(
                    `\n` +
                    `Available text commands:\n` +
                    `\t${Config.prefix}join\t join your channel\n` +
                    `\t${Config.prefix}leave\t leave your channel\n` +
                    `\t${Config.prefix}help\t answer with this help message\n` +
                    `\n` +
                    `In your channel, i will listen for the voice command "${Config.snowboyModels[0].hotwords}"\n` +
                    `After triggering the the hotword, i will listen for the following voice commands:\n` +
                    `\tplay ...\t plays the requested song, e.g. "snowboy, play eminem"\n` +
                    `\tnext result\t skips currently played song and plays next search result for your request\n` +
                    `\tadd ...\t adds a song to your playlist\n` +
                    `\tpause\t pauses the currently played song\n` +
                    `\tresume\t resumes a paused song\n` +
                    `\tskip\t skips the currently played song\n` +
                    `\tstop\t stops playing and clears your playlist\n` +
                    `\tleave\t - leave your channel\n`);
                break;

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

const client = new Client();

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

function cleanup() {
    // close every connection
    if (client) {
        client.disconect();
    }
    process.exit();
}
