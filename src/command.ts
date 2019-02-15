export class Command {
    public readonly command: string;
    public readonly minWords: number;
    public readonly maxWords: number;

    constructor(command: string, minWords: number, maxWords: number) {
        this.command = command;
        this.minWords = minWords;
        this.maxWords = maxWords;
    }
}
