import { Transform } from "stream";
import { TransformCallbackFunc } from "../../docs";

class StreamLinesParser extends Transform {
    #_leftover = '';

    constructor() {
        super({ readableObjectMode: true, decodeStrings: false });
    }

    _transform(chunk: Buffer, _enc: BufferEncoding, callback: TransformCallbackFunc) {
        const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const lines = (this.#_leftover + data).split(/\r?\n/);
        this.#_leftover = lines.pop()!; // last item may be an incomplete line

        for (const line of lines) {
            // console.log(`${'='.repeat(20)} Line START ${'='.repeat(20)}`);
            // console.log(line);
            // console.log(`${'='.repeat(20)} Line END ${'='.repeat(20)}`);
            this.push(line); // push as string line
        }

        callback();
    }

    _flush(callback: TransformCallbackFunc): void {
        if (this.#_leftover) {
            this.push(this.#_leftover); // push remaining partial line
            this.#_leftover = '';
        }

        callback();
    }
}

// class StreamLinesParser extends Transform {
//     #_leftover = '';

//     constructor() {
//         super({ readableObjectMode: true, decodeStrings: false });
//     }

//     _transform(chunk: Buffer, _enc: BufferEncoding, callback: TransformCallbackFunc) {
//         const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
//         const lines = (this.#_leftover + data).split(/\r?\n/);
//         this.#_leftover = lines.pop()!; // last item may be an incomplete line

//         for (const line of lines) {
//             this.push(line); // push as string line
//         }

//         callback();
//     }

//     _flush(callback: TransformCallbackFunc): void {
//         if (this.#_leftover) {
//             this.push(this.#_leftover); // push remaining partial line
//             this.#_leftover = '';
//         }

//         callback();
//     }
// }

export default StreamLinesParser;