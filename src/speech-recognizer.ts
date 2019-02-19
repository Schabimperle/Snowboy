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
        alternativeLanguageCodes: ["de-DE"],
        encoding: "LINEAR16",
        languageCode: "en-US",
        // maxAlternatives: 5,
        sampleRateHertz: 16000,
        speechContexts: [{
            phrases: [] as string[],
        }],
    },
    interimResults: true, // If you want interim results, set this to true
    singleUtterance: false, // recognize speech pause or end and end stream
};

const TIMEOUT_SILENCE = 250;
const TIMEOUT_AFTER_MIN = 1000;
const TIMEOUT_NO_MATCH = 3000;

const SILENCE_BUFFER_250MS = fs.readFileSync("sounds/silence.pcm");

export class SpeechRecognizer extends Writable {

    private detector: any;
    private sttClient: any;
    private commands: Command[];
    private sttStream: Writable | null = null;
    private timer: any = { count: 0 };
    private sttResult: string = "";
    private match: Command | null = null;

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
            .on("error", this.handleDetectorError.bind(this))
            .on("silence", this.handleDetectorSilence.bind(this));
        // .on('sound', this.handleDetectorSound.bind(this))
        this.sttClient = new Stt.SpeechClient({ keyFilename: GOOGLE_KEYS_PATH });
        this.commands = commands;
        SPEECH_REQUEST.config.speechContexts[0].phrases = this.commands.map((cmd) => cmd.command);
    }

    public handleDetectorSilence() {
        // console.debug("silence");
    }

    // handleDetectorSound(buffer) {
    // 	// <buffer> contains the last chunk of the audio that triggers the "sound"
    // 	// event. It could be written to a wav Stream.
    // 	console.debug('sound');
    // }

    public isTranscribing() {
        return this.sttStream;
    }

    public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
        if (this.sttStream) {
            if (!this.timer.silenceCalled) {
                this.timer.count = 0;
            }

            this.sttStream.write(chunk, encoding, callback);

            // set silence timer
            clearTimeout(this.timer.handle);
            this.timer.handle = setTimeout(() => this.silenceTimeout(), TIMEOUT_SILENCE);
        } else {
            this.detector.write(chunk, encoding, callback);
        }

        this.timer.silenceCalled = false;
    }

    public _final(callback: (error?: Error | null) => void) {
        this.detector.end();
        if (this.sttStream) { this.sttStream.end(); }
        callback();
    }

    private silenceTimeout() {
        if (!this.writable) {
            return;
        }
        this.timer.count++;

        // if we have a match and enough words to execute a command -> time out fast
        if (this.match && this.timer.count * TIMEOUT_SILENCE >= TIMEOUT_AFTER_MIN) {
            this.endTranscribing(false);
        } else {
            this.timer.silenceCalled = true;
            this.write(SILENCE_BUFFER_250MS);
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
        setTimeout(() => {
            if (!this.match) {
                this.endTranscribing(false);
            }
        }, TIMEOUT_NO_MATCH);
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
                if (!this.match) {
                    this.endTranscribing(true);
                    return;
                }
            } else if (result.stability >= 0.5) {
                const interimResult = this.sttResult + result.alternatives[0].transcript.toLowerCase();
                console.log(`interim result(${result.stability.toFixed(3)}):`, interimResult);
                this.checkTranscript(interimResult);
                if (!this.match) {
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
            if (wordCount >= cmd.minWords && transcript.startsWith(cmd.command)) {
                this.match = cmd;
                if (wordCount >= cmd.maxWords) {
                    this.sttResult = transcript;
                    this.endTranscribing(true);
                }
            }
        }
        return null;
    }

    private endTranscribing(destroy: boolean) {
        clearTimeout(this.timer.handle);

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
        clearTimeout(this.timer.handle);

        if (!this.match) {
            this.emit("bad-command", "none", "");
        }
        if (this.match) {
            this.emit("command", this.match.command, this.sttResult.slice(this.match.command.length + 1));
        }

        this.sttResult = "";
        this.sttStream = null;
        this.match = null;
        this.emit("transcribe-end");
    }

    private handleSttError(error: any) {
        clearTimeout(this.timer.handle);
        console.error(error);
        this.sttResult = "";
        this.sttStream = null;
        this.match = null;
        this.emit("transcribe-error", error);
    }

    private handleDetectorError(error: any) {
        console.dir(error);
    }
}
