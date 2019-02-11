import { GuildMember } from "discord.js";
import ffmpeg from "fluent-ffmpeg";
// @ts-ignore
import Models from "snowboy";
import { Readable } from "stream";

import { SpeechRecognizer, WritableOptions } from "./speech-recognizer";

export class User extends SpeechRecognizer {
    public readonly member: GuildMember;

    constructor(member: GuildMember,
                stream: Readable,
                detectorModels: Models,
                googleKeysPath: string,
                commands: string[],
                streamOptions?: WritableOptions) {
        super(detectorModels, googleKeysPath, commands, streamOptions);

        this.member = member;

        // debug
        stream
            // .on("data", () => console.debug("sound"))
            .on("error", () => console.error)
            .on("end", () => console.debug("user stream ended"));

        ffmpeg(stream)
            .inputFormat("s32le")
            .audioFrequency(16000)
            .audioCodec("pcm_s16le")
            .format("s16le")
            .on("error", console.error)
            .pipe(this);
    }
}
