import * as Discord from "discord.js";

import { Bot } from "./bot";
import * as Config from "./config.json";

// workaround for not receiving audio data from users after joining a channel
// @ts-ignore
import Silence from "../node_modules/discord.js/src/client/voice/util/Silence.js";
class SomeSilence extends Silence {
    _read() {
        for(let i = 0; i < 20; i++) {
            super._read();
        }
        // @ts-ignore
        this.push(null);
    }
}

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
            this.user.setActivity(Config.prefix + "help", { type: "LISTENING" });
        }

        // debug
        if (Config.testChannelId) {
            const channel = this.channels.get(Config.testChannelId);
            if (channel && channel.type === "voice") {
                const voiceChannel: Discord.VoiceChannel = channel as Discord.VoiceChannel;
                voiceChannel.join()
                    .then((connection) => {
                        const bot = new Bot(connection);
                        this.bots.set(voiceChannel.guild.id, bot);
                        connection.on("disconnect", () => {
                            console.log("voiceConnection disconnect, removing oldBot from map");
                            this.bots.delete(voiceChannel.guild.id);
                        });

                        // bot.extractSongs("spotify:playlist:2gaE8Y3U4aGTVrUCH1A5dQ");
                    }).catch(console.error);
            }
        }
    }

    private async onMessage(message: Discord.Message) {
        // Voice only works in guilds, if the message does not come from a guild, we ignore it
        if (!message.guild || !message.member) {
            return;
        }

        // Ignore messages from bots
        if (message.member.user?.bot) {
            return;
        }

        // message intended for us?
        const match = message.content.match(new RegExp(`^${Config.prefix}([^ ]*)`));
        if (!match) {
            return;
        }

        let bot = this.bots.get(message.guild.id);
        const member = message.member;
        const command = match[1];
       
        switch (command) {
            case "join":
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

                this.createBot(message);
                break;
            case "play":
                if (!bot) {
                    bot = await this.createBot(message)
                }
                bot.onTextCommand(member, message.content.slice(Config.prefix.length));
                break;
            case "help":
                message.reply(new Discord.MessageEmbed()
                    .setColor('#000000')
                    .setTitle('Some title')
                    .setURL('https://discord.js.org/')
                    .setAuthor('Some name', 'https://i.imgur.com/wSTFkRM.png', 'https://discord.js.org')
                    .setDescription('Some description here')
                    .setThumbnail('https://i.imgur.com/wSTFkRM.png')
                    .addField('Regular field title', 'Some value here')
                    .addBlankField()
                    .addField('Inline field title', 'Some value here', true)
                    .addField('Inline field title', 'Some value here', true)
                    .addField('Inline field title', 'Some value here', true)
                    .setImage('https://i.imgur.com/wSTFkRM.png')
                    .setTimestamp()
                    .setFooter('Some footer text here', 'https://i.imgur.com/wSTFkRM.png')
                );
                // message.reply(
                //     `\n` +
                //     `Available text commands:\n` +
                //     `\t${Config.prefix}join\t join your channel\n` +
                //     `\t${Config.prefix}leave\t leave your channel\n` +
                //     `\t${Config.prefix}help\t answer with this help message\n` +
                //     `\n` +
                //     `In your channel, i will listen for the voice command "${Config.snowboyModels[0].hotwords}"\n` +
                //     `After triggering the the hotword, i will listen for the following voice commands:\n` +
                //     `\tplay ...\t plays the requested song, e.g. "snowboy, play eminem"\n` +
                //     `\tnext result\t skips currently played song and plays next search result for your request\n` +
                //     `\tadd ...\t adds a song to your playlist\n` +
                //     `\tpause\t pauses the currently played song\n` +
                //     `\tresume\t resumes a paused song\n` +
                //     `\tskip\t skips the currently played song\n` +
                //     `\tstop\t stops playing and clears your playlist\n` +
                //     `\tleave\t - leave your channel\n`);
                break;
            default:
                // sender in a voice channel?
                if (!message.member.voice.channel) {
                    message.reply(`You need to join a voice channel first, then type "${Config.prefix}join" to call me to join your channel.`);
                    return;
                }

                // watch reply for a description
                if (!bot || bot.connection.channel.id !== message.member.voice.channelID) {
                    message.reply(`You need to be in the same channel as me to send commands. Type "${Config.prefix}join" to call me to enter your channel.`);
                    return;
                }

                bot.onTextCommand(message.member, command);
        }
    }

    private async createBot(message : Discord.Message) {
        // Voice only works in guilds, if the message does not come from a guild, we ignore it
        if (!message.guild || !message.member) {
            return Promise.reject("Voice only works in guilds, if the message does not come from a guild, we ignore it.");
        }
        
        // Only try to join the sender's voice channel if they are in one themselves
        if (!message.member.voice.channel) {
            message.reply("You need to join a voice channel first!");
            return Promise.reject("Sending message member is not in a voice channel.");
        }

        // setup new connection
        const voiceChannel = message.member.voice.channel;
        const guild = message.guild
        const con = await voiceChannel.join();

        await this.soundBugWorkaround(con);

        // create a new bot
        const newBot = new Bot(con);
        this.bots.set(guild.id, newBot);
        con.on("error", (err) => {
            console.error(err);
        });
        con.on("disconnect", () => {
            console.log("voiceConnection disconnect, removing bot from map");
            this.bots.delete(guild.id);
        });
        return newBot;
    }

    private soundBugWorkaround(con : Discord.VoiceConnection) {
        // for a description see comment above class SomeSilence
        // @ts-ignore
        const dispatcher = con.play(new SomeSilence(), { type: 'opus' });
        return new Promise(resolve => {
            dispatcher.on('finish', () => {
                resolve();
            });
        });
    }

    private onVoiceStateUpdate(oldState: Discord.VoiceState, newState: Discord.VoiceState) {
        // ignore bots
        if (!newState.member || newState.member.user.bot) {
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
}
