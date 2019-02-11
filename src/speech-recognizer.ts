
// tslint:disable-next-line
const Stt = require("@google-cloud/speech");
// tslint:disable-next-line
const { Detector, Models } = require("snowboy");
import { Writable, WritableOptions } from "stream";

const SPEECH_REQUEST = {
    config: {
        alternativeLanguageCodes: ["en-US"],
        encoding: "LINEAR16",
        languageCode: "de-DE",
        maxAlternatives: 5,
        sampleRateHertz: 16000,
        speechContexts: [{
            phrases: [] as string[],
        }],
    },
    interimResults: false, // If you want interim results, set this to true
};
const RECORD_TIMEOUT = 1500;

export { WritableOptions } from "stream";

export class SpeechRecognizer extends Writable {

    private detector: any;
    private sttClient: any;
    private commands: string[];
    private sttStream: Writable | null = null;
    private timer?: NodeJS.Timeout;
    private sttResult: boolean = false;

    constructor(detectorModels: any[], googleKeysPath: string, commands: string[], streamOptions?: WritableOptions) {
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
            .on("error", this.handleDetectorError.bind(this));
        // .on('silence', this.handleDetectorSilence.bind(this))
        // .on('sound', this.handleDetectorSound.bind(this))
        this.sttClient = new Stt.SpeechClient({ keyFilename: googleKeysPath });
        this.commands = commands;
        SPEECH_REQUEST.config.speechContexts[0].phrases = this.commands;
    }

    // handleDetectorSilence() {
    // 	console.debug('silence');
    // }

    // handleDetectorSound(buffer) {
    // 	// <buffer> contains the last chunk of the audio that triggers the "sound"
    // 	// event. It could be written to a wav Stream.
    // 	console.debug('sound');
    // }

    public isTranscribing() {
        return this.sttStream;
    }

    public endTranscribing() {
        if (this.sttStream && this.sttStream.writable) {
            this.sttStream.end();
        }
        this.sttStream = null;
    }

    public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
        if (this.sttStream) {
            this.sttStream.write(chunk, encoding, callback);
            if (this.timer) { clearTimeout(this.timer); }
            this.timer = setTimeout(this.endTranscribing.bind(this), RECORD_TIMEOUT);
        } else {
            this.detector.write(chunk, encoding, callback);
        }
    }

    public _final(callback: (error?: Error | null) => void) {
        this.detector.end();
        if (this.sttStream) { this.sttStream.end(); }
        callback();
    }

    private handleDetectorHotword(index: number, hotword: string, buffer: Buffer) {
        // <buffer> contains the last chunk of the audio that triggers the "hotword"
        // event. It could be written to a wav Stream. You will have to use it
        // together with the <buffer> in the "sound" event if you want to get audio
        // data after the hotword.
        console.debug("hotword", index, hotword);
        this.emit("hotword");

        this.sttStream = this.sttClient.streamingRecognize(SPEECH_REQUEST)
            // .on('start', this.handleSttStart.bind(this))
            .on("data", this.handleSttData.bind(this))
            .on("error", this.handleSttError.bind(this))
            .on("end", this.handleSttEnd.bind(this));
        this.timer = setTimeout(this.endTranscribing.bind(this), RECORD_TIMEOUT);
        this.emit("transcribe-start");
    }

    private handleSttData(data: any) {
        this.sttResult = true;
        if (data.error) {
            this.handleSttError(data.error);
            return;
        }
        if (!data.results.length || !data.results[0].alternatives) {
            return;
        }
        const alternatives = data.results[0].alternatives;
        // if any transcript starts with a command emit an appropriate event
        for (let i = 0; i < alternatives.length; i++) {
            console.debug(`transcript (${i}/${alternatives.length}):`, alternatives[i].transcript);
            for (const command of this.commands) {
                if (alternatives[i].transcript.toLowerCase().startsWith(command)) {
                    this.emit("command", command, alternatives[i].transcript.slice(command.length + 1));
                    return;
                }
            }
        }
        const text: string = alternatives[0].transcript;
        const command = text.substr(0, text.indexOf(" ") || text.length);
        const rest = text.slice(command.length + 1);
        this.emit("bad-command", command, rest);
    }

    private handleSttEnd() {
        if (!this.sttResult) {
            this.emit("bad-command", "none", "");
        }

        this.sttResult = false;
        this.sttStream = null;
        this.emit("transcribe-end");
    }

    private handleSttError(error: any) {
        console.error(error);
        this.sttStream = null;
        this.emit("transcribe-error", error);
    }

    private handleDetectorError(error: any) {
        console.dir(error);
    }
}
