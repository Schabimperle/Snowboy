import request = require("request");
import { Readable } from "stream";
import * as ytdl from "ytdl-core";

export class Song {
    public requestOpts: request.CoreOptions;
    public response?: any;
    public itemIndex: number = -1;
    public stream?: Readable;
    public info?: ytdl.videoInfo;
    public url?: string;

    constructor(requestOpts: request.CoreOptions) {
        this.requestOpts = requestOpts;
    }

    public get item() {
        if (!this.response)
            return undefined;
        return this.response.items[this.itemIndex];
    }

    public get videoId() {
        if (!this.item)
            return undefined;
        return this.item.id.videoId;
    }

    public get searchText() {
        if (!this.requestOpts)
            return undefined;
        return this.requestOpts.qs.q;
    }

    public get title() {
        if (!this.item) 
            return undefined;
        return this.item.snippet.title;
    }
}
