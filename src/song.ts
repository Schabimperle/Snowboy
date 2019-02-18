import request = require("request");
import { Readable } from "stream";
import * as ytdl from "ytdl-core";

export class Song {
    public requestOpts: request.CoreOptions;
    public response?: any;
    public itemIndex: number = -1;
    public stream?: Readable;
    public info?: ytdl.videoInfo;

    constructor(requestOpts: request.CoreOptions) {
        this.requestOpts = requestOpts;
    }

    public get item() {
        return this.response.items[this.itemIndex];
    }

    public get videoId() {
        return this.item.id.videoId;
    }

    public get searchText() {
        return this.requestOpts.qs.q;
    }

    public get title() {
        return this.item.snippet.title;
    }
}
