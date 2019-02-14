// @ts-ignore
import * as Ds from "deepspeech";
// @ts-ignore
import MemoryStream from "memory-stream";
// @ts-ignore
import { Detector, Models } from "snowboy";
import { Writable, WritableOptions } from "stream";

const RECORD_TIMEOUT = 1500;

const DS_PATH = "models/";
const MODEL_PATH = DS_PATH + "output_graph.rounded.pbmm";
const ALPHABET_PATH = DS_PATH + "alphabet.txt";
const LM_PATH = DS_PATH + "lm.binary";
const TRIE_PATH = DS_PATH + "trie";

// Beam width used in the CTC decoder when building candidate transcriptions
const BEAM_WIDTH = 500;
// The alpha hyperparameter of the CTC decoder. Language Model weight
const LM_ALPHA = 0.75;
// The beta hyperparameter of the CTC decoder. Word insertion bonus.
const LM_BETA = 1.85;

// These constants are tied to the shape of the graph used (changing them changes
// the geometry of the first layer), so make sure you use the same constants that
// were used during training

// Number of MFCC features to use
const N_FEATURES = 26;
// Size of the context window used for producing timesteps in the input vector
const N_CONTEXT = 9;

export { WritableOptions } from "stream";

export class SpeechRecognizer extends Writable {

    private detector: any;
    private sttClient: any;
    private commands: string[];
    private sttStream: any | null = null;
    private timer?: NodeJS.Timeout;

    constructor(detectorModels: any[], commands: string[], streamOptions?: WritableOptions) {
        super(streamOptions);
        const models = new Models();
        detectorModels.forEach((model) => models.add(model));
        this.detector = new Detector({
            applyFrontend: false,
            audioGain: 1.0,
            models,
            resource: "node_modules/snowboy/resources/common.res",
        })
            .on("hotword", this.onDetectorHotword.bind(this))
            .on("error", console.error)
            .on("silence", this.onDetectorSilence.bind(this));
        // .on('sound', this.onDetectorSound.bind(this))
        this.commands = commands;

        this.sttClient = new Ds.Model(MODEL_PATH, N_FEATURES, N_CONTEXT, ALPHABET_PATH, BEAM_WIDTH);
        this.sttClient.enableDecoderWithLM(ALPHABET_PATH, LM_PATH, TRIE_PATH, LM_ALPHA, LM_BETA);
    }

    // onDetectorSound(buffer) {
    // 	// <buffer> contains the last chunk of the audio that triggers the "sound"
    // 	// event. It could be written to a wav Stream.
    // 	console.debug('sound');
    // }

    public isTranscribing() {
        return this.sttStream;
    }

    public _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
        if (this.sttStream) {
            this.sttStream.write(chunk, encoding, callback);
            if (this.timer) { clearTimeout(this.timer); }
            this.timer = setTimeout(this.onTimeout.bind(this), RECORD_TIMEOUT);
        } else {
            this.detector.write(chunk, encoding, callback);
        }
    }

    public _final(callback: (error?: Error | null) => void) {
        this.detector.end();
        if (this.sttStream) { this.sttStream.end(); }
        callback();
    }

    private onTimeout() {
        if (this.sttStream && this.sttStream.writable) {
            this.sttStream.end();
            this.transcribe();
        }
        // make _write calls go to hotword detection again
        this.sttStream = null;
    }

    private onDetectorHotword(index: number, hotword: string, buffer: Buffer) {
        // <buffer> contains the last chunk of the audio that triggers the "hotword"
        // event. It could be written to a wav Stream. You will have to use it
        // together with the <buffer> in the "sound" event if you want to get audio
        // data after the hotword.
        console.debug("hotword", index, hotword);
        this.emit("hotword");

        this.timer = setTimeout(this.onTimeout.bind(this), 3000);
        this.emit("transcribe-start");

        this.sttStream = new MemoryStream();
    }

    private onDetectorSilence() {
        console.debug("silence");
    }

    private transcribe() {
        if (!this.sttStream) {
            return;
        }

        // transcribe
        const audioBuffer = this.sttStream.toBuffer();
        const result = this.sttClient.stt(audioBuffer.slice(0, audioBuffer.length / 2), 16000);
        console.debug("transcript:", result);

        // check for matching commands
        for (const cmd of this.commands) {
            if (result.toLowerCase().startsWith(cmd)) {
                this.emit("command", cmd, cmd.slice(cmd.length + 1));
                return;
            }
        }

        // we dont listen to that command -> emit event 'bad-command'
        const command = result.replace(/ .*/, "");
        const rest = result.slice(command.length + 1);
        this.emit("bad-command", command, rest);
    }
}
