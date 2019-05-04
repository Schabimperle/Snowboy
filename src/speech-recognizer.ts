import * as fs from "fs";
// tslint:disable-next-line
const Stt = require("@google-cloud/speech");
// tslint:disable-next-line
const { Detector, Models } = require("snowboy");
import { Writable, WritableOptions } from "stream";
import { Command } from "./command";

const GOOGLE_KEYS_PATH = "./google-keys.json";

const SPEECH_REQUEST = {
    config: {
        alternativeLanguageCodes: ["en-US"],
        encoding: "LINEAR16",
        languageCode: "de-DE",
        // maxAlternatives: 5,
        sampleRateHertz: 16000,
        speechContexts: [{
            phrases: [] as string[],
        }],
    },
    interimResults: true, // If you want interim results, set this to true
    singleUtterance: false, // recognize speech pause or end and end stream
};

const TIMER_SILENCE = 250;
const TIMER_ABORT_CHECK = 1000;

const TIMEOUT_AFTER_MIN = 1000;
const TIMEOUT_NO_MATCH = 3000;

const SILENCE_BUFFER_250MS = fs.readFileSync("sounds/silence.pcm");

export class SpeechRecognizer extends Writable {

    private detector: any;
    private commands: Command[];
    private sttClient: any;
    private sttStream: Writable | null = null;
    private abortHandle: NodeJS.Timeout | null = null;
    private silence: {
        handle: NodeJS.Timeout | null,
        calledWrite: boolean,
    } = { handle: null, calledWrite: false };
    private sttResult: string = "";
    private match: { cmd: Command, wordCount: number, timestamp: bigint } | null = null;

    constructor(detectorModels: any[], commands: Command[], streamOptions?: WritableOptions) {
        super(streamOptions);
        const models = new Models();
        detectorModels.forEach((model) => models.add(model));
        this.detector = new Detector({
            applyFrontend: false,
            audioGain: 1.0,
            models,
            resource: "node_modules/snowboy/resources/common.res",
        })
            .on("hotword", this.handleDetectorHotword.bind(this))
            // .on("silence", this.handleDetectorSilence.bind(this))
            .on("error", console.error);
        // .on("sound", () => console.log("sound"));
        this.sttClient = new Stt.SpeechClient({ keyFilename: GOOGLE_KEYS_PATH });
        this.commands = commands;
        SPEECH_REQUEST.config.speechContexts[0].phrases = this.commands.map((cmd) => cmd.command);
    }

    // public handleDetectorSilence() {
    // console.debug("silence");
    // }

    // handleDetectorSound(buffer) {
    // 	// <buffer> contains the last chunk of the audio that triggers the "sound"
    // 	// event. It could be written to a wav Stream.
    // 	console.debug('sound');
    // }

    public isTranscribing() {
        return Boolean(this.sttStream);
    }

    public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
        if (this.sttStream) {
            this.sttStream.write(chunk, encoding, callback);

            // set silence timer
            if (this.silence.handle) {
                clearTimeout(this.silence.handle);
            }
            // write silence if no input receives for google stt to work better
            this.silence.handle = setTimeout(() => this.write(SILENCE_BUFFER_250MS), TIMER_SILENCE);
        } else {
            this.detector.write(chunk, encoding, callback);
        }
    }

    public _final(callback: (error?: Error | null) => void) {
        console.log("on _final");
        this.detector.destroy();
        if (this.sttStream) { this.sttStream.destroy(); }
        callback();
    }

    private checkSttAbort() {
        if (!this.writable) {
            return;
        }

        let abort = false;
        // if we have a match and enough words to execute a command -> time out fast
        if (this.match && this.match.wordCount >= this.match.cmd.minWords) {
            // @ts-ignore
            if (process.hrtime.bigint() - this.match.timestamp >= BigInt(TIMEOUT_AFTER_MIN * 1000000)) {
                console.log("stt timeout after min");
                abort = true;
            }
            // @ts-ignore
            // if we don't have a match and a lot of time passed -> end transcribing
        } else if ((process.hrtime.bigint() - this.silence.sttStart) >= BigInt(TIMEOUT_NO_MATCH * 1000000)) {
            console.log("stt timeout no match");
            abort = true;
        }

        if (abort) {
            this.endTranscribing(false);
        } else {
            this.abortHandle = setTimeout(this.checkSttAbort.bind(this), TIMER_ABORT_CHECK);
        }
    }

    private handleDetectorHotword(index: number, hotword: string, buffer: Buffer) {
        // <buffer> contains the last chunk of the audio that triggers the "hotword"
        // event. It could be written to a wav Stream. You will have to use it
        // together with the <buffer> in the "sound" event if you want to get audio
        // data after the hotword.
        console.debug("hotword", index, hotword);
        this.emit("hotword");

        // start speech to text stream
        this.sttStream = this.sttClient.streamingRecognize(SPEECH_REQUEST)
            // .on('start', this.handleSttStart.bind(this))
            .on("data", this.handleSttData.bind(this))
            .on("error", this.handleSttError.bind(this))
            .on("end", this.handleSttEnd.bind(this));

        // timeout if we don't even have a partial result after a long time
        // @ts-ignore
        this.silence.sttStart = process.hrtime.bigint();
        this.abortHandle = setTimeout(this.checkSttAbort.bind(this), TIMER_ABORT_CHECK);
        this.emit("transcribe-start");
    }

    private handleSttData(data: any) {
        if (data.error) {
            console.error(data.error);
            return;
        }

        for (const result of data.results) {
            if (result.isFinal) {
                this.sttResult += result.alternatives[0].transcript.toLowerCase();
                console.log(`new final result:(${result.stability.toFixed(3)})`, this.sttResult);
                this.checkTranscript(this.sttResult);
                // if the transcript dint't start with a command, end transcribing
                if (!this.match) {
                    console.log("stt end no command");
                    this.endTranscribing(true);
                    return;
                }
            } else if (result.stability >= 0.5) {
                const interimResult = this.sttResult + result.alternatives[0].transcript.toLowerCase();
                console.log(`interim result(${result.stability.toFixed(3)}):`, interimResult);
                this.checkTranscript(interimResult);
                // if the transcript dint't start with a command, end transcribing
                if (!this.match) {
                    console.log("stt end no command");
                    this.endTranscribing(true);
                    return;
                }
            } else {
                console.debug(`threw away(${result.stability.toFixed(3)}):`, result.alternatives[0].transcript);
            }
        }
    }

    private checkTranscript(transcript: string) {
        const wordCount = transcript.split(" ").length;

        for (const cmd of this.commands) {
            // check if our transcript starts with a command
            if (transcript.startsWith(cmd.command) || cmd.command.startsWith(transcript)) {
                // @ts-ignore
                this.match = { cmd, wordCount, timestamp: process.hrtime.bigint() };
                // if we have the maximum words needed, end transcribing
                if (wordCount >= cmd.maxWords) {
                    console.log("stt end max words");
                    this.sttResult = transcript;
                    this.endTranscribing(true);
                }
            }
        }
        return;
    }

    private endTranscribing(destroy: boolean) {
        this.clearTimeouts();

        if (this.sttStream && this.sttStream.writable) {
            if (destroy) {
                console.log("destroying stt");
                this.sttStream.destroy();
                this.handleSttEnd();
            } else {
                console.log("ending stt");
                this.sttStream.end();
            }
        }
        this.sttStream = null;
    }

    private handleSttEnd() {
        this.clearTimeouts();

        if (!this.match || this.match.wordCount <= this.match.cmd.minWords) {
            this.emit("bad-command", "none", "");
        }
        if (this.match) {
            this.emit("command", this.match.cmd.command, this.sttResult.slice(this.match.cmd.command.length + 1));
        }

        this.sttResult = "";
        this.sttStream = null;
        this.match = null;
        this.emit("transcribe-end");
    }

    private handleSttError(error: any) {
        this.clearTimeouts();
        console.error(error);
        this.sttResult = "";
        this.sttStream = null;
        this.match = null;
        this.emit("transcribe-error", error);
    }

    private clearTimeouts() {
        if (this.silence.handle) {
            clearTimeout(this.silence.handle);
        }
        if (this.abortHandle) {
            clearTimeout(this.abortHandle);
        }
    }
}
