import process from "node:process";

type Part = string | Marker; // a chunk of literal text or a numbered marker

class Frame {
    // index in neutral where the function body begins
    begin: number;
    // "active" for "#(", "neutral" for "##("
    mode: "active" | "neutral";
    argument_slices: Array<[number, number]>;
    current_argument_start: number;

    constructor(begin: number, mode: "active" | "neutral", current_argument_start: number) {
        this.begin = begin;
        this.mode = mode;
        this.argument_slices = [];
        this.current_argument_start = current_argument_start;
    }
}

// A segment marker placed by ss(), numbered 1,2,3,...
class Marker {
    n: number;
    constructor(n: number) {
        this.n = n;
    }
}

export class TRAC {
    forms: Record<string, Part[]> = {};

    // runtime working state (reset per record)
    active: string[] = [];
    neutral: string[] = [];
    scan = 0;

    frames: Frame[] = [];
    args: string[] = [];

    initial: string; // initial program to run

    input: string[] = []; // input stream for rs/rc
    output: (v: string) => void;

    interactive: boolean = false;

    meta: string = "'";

    private _skip_chars = new Set<string>(["\t", "\n", "\r", "'"]);

    constructor(initial: string, input: string[] | string, output: (v: string) => void, interactive = false) {
        this.initial = initial;
        this.input = Array.isArray(input) ? input : [input];
        this.output = output;
        this.interactive = interactive;
    }

    async run() {
        this._reset_processor(this.initial);

        while (true) {
            // Step 2: end-of-active?
            if (this.scan >= this.active.length) {
                if (!this.interactive) break;
                this._reset_processor(this.initial);
            }

            const ch = this.active[this.scan];

            // Step 3: control chars / apostrophe = record end
            if (this._skip_chars.has(ch)) {
                this._delete_active_char();
                continue;
            }

            // Step 4: protective parentheses
            if (ch === "(") {
                if (!this._consume_balanced_parentheses_into_neutral()) {
                    this._clear_processor();
                    break;
                }
                continue;
            }

            // Step 5: comma -> argument boundary
            if (ch === ",") {
                this._delete_active_char();
                this._mark_argument_boundary();
                continue;
            }

            // Step 6/7: #( or ##(
            if (ch === "#") {
                if (this._peek("(")) {
                    // "#("
                    this._delete_active_char();
                    this._delete_active_char();
                    this._begin_function("active");
                    continue;
                }
                if (this._peek("#", "(")) {
                    // "##("
                    this._delete_active_char();
                    this._delete_active_char();
                    this._delete_active_char();
                    this._begin_function("neutral");
                    continue;
                }
                // Step 8: a lone '#'
                this._move_active_char_to_neutral();
                continue;
            }

            // Step 9: end of function
            if (ch === ")") {
                this._delete_active_char();
                await this._end_function_and_evaluate();
                continue;
            }

            // Step 10: ordinary char
            this._move_active_char_to_neutral();
        }

        return this.neutral.join("");
    }

    // --- internals ---

    private _reset_processor(program: string) {
        this.neutral.length = 0;
        this.active = Array.from(program);
        this.scan = 0;
        this.frames.length = 0;
        this.args = [];
    }

    private _clear_processor() {
        this.neutral.length = 0;
        this.active.length = 0;
        this.scan = 0;
        this.frames.length = 0;
        this.args = [];
    }

    private _delete_active_char() {
        if (this.scan < this.active.length) {
            this.active.splice(this.scan, 1);
        }
    }

    private _move_active_char_to_neutral() {
        this.neutral.push(this.active[this.scan]);
        this._delete_active_char(); // scan stays
    }

    private _peek(...expect: string[]): boolean {
        let i = this.scan + 1;
        if (i + expect.length - 1 >= this.active.length) return false;
        for (let offset = 0; offset < expect.length; offset += 1) {
            if (this.active[i + offset] !== expect[offset]) return false;
        }
        return true;
    }

    private _consume_balanced_parentheses_into_neutral(): boolean {
        this._delete_active_char(); // delete '('
        let depth = 1;
        let i = this.scan;
        while (i < this.active.length) {
            const ch = this.active[i];
            if (ch === "(") {
                depth += 1;
                this.neutral.push(ch);
                this.active.splice(i, 1);
            } else if (ch === ")") {
                depth -= 1;
                if (depth === 0) {
                    this.active.splice(i, 1); // delete matching ')'
                    return true;
                }
                this.neutral.push(ch);
                this.active.splice(i, 1);
            } else {
                this.neutral.push(ch);
                this.active.splice(i, 1);
            }
            // note: i doesn't increment because we remove from active
        }
        return false;
    }

    private _begin_function(mode: "active" | "neutral") {
        const begin = this.neutral.length;
        const frame = new Frame(begin, mode, begin);
        this.frames.push(frame);
    }

    private _mark_argument_boundary() {
        if (!this.frames.length) return;
        const frame = this.frames[this.frames.length - 1];
        const current_end = this.neutral.length;
        const current_slice: [number, number] = [frame.current_argument_start, current_end];
        frame.argument_slices.push(current_slice);
        frame.current_argument_start = this.neutral.length;
    }

    private async _end_function_and_evaluate() {
        if (!this.frames.length) {
            this._clear_processor();
            return;
        }

        const frame = this.frames.pop() as Frame;
        const final_end = this.neutral.length;
        frame.argument_slices.push([frame.current_argument_start, final_end]);

        // extract string arguments from neutral
        const body_start = frame.begin;
        const body_end = final_end;
        const args: string[] = frame.argument_slices.map(([a, b]) => this.neutral.slice(a, b).join(""));

        // remove the function body from neutral
        this.neutral.splice(body_start, body_end - body_start);

        // evaluate
        const name = args.length ? args[0] : "";
        this.args = args.slice(1);
        let value = "";

        const builtin = this[name];
        if (this[name] && typeof this[name] === "function") {
            value = await this[name]();
        } else {
            value = "";
        }

        if (frame.mode === "neutral") {
            this.neutral.push(...Array.from(value));
        } else {
            this.active = Array.from(value).concat(this.active.slice(this.scan));
            this.scan = 0;
        }

        this.args = [];
    }

    private async ds() {
        // #(ds,N,B) -> define/replace form N with body B.
        // store as a list<Part> with a single literal chunk initially.
        const name = this._arg(0);
        const body = this._arg(1);
        if (!name) return "";
        this.forms[name] = [body]; // literal body, no markers yet
        console.log(`Defined form ${name} {${body}}`);
        return "";
    }

    private async ss() {
        /**
         * #(ss,N,P1,P2,...) -> create ordinal segment markers in form N.
         * Each non-null Pi is searched L->R and each occurrence (that does not cross
         * an existing marker) is replaced by Marker(i).
         */
        const name = this._arg(0);
        if (!(name in this.forms)) return "";
        let parts = this.forms[name]; // list<Part>

        const replace_pattern_in_parts = (partsIn: Part[], pattern: string, num: number): Part[] => {
            if (pattern === "") return partsIn;

            const out: Part[] = [];
            for (const part of partsIn) {
                if (part instanceof Marker) {
                    out.push(part);
                    continue;
                }
                const s = part;
                let i = 0;
                const L = pattern.length;
                while (true) {
                    const j = s.indexOf(pattern, i);
                    if (j === -1) {
                        out.push(s.slice(i));
                        break;
                    }
                    out.push(s.slice(i, j)); // prefix
                    out.push(new Marker(num)); // marker
                    i = j + L; // continue after match
                }
            }

            //         // merge adjacent strings for cleanliness
            const merged: Part[] = [];
            for (const item of out) {
                if (merged.length && typeof merged[merged.length - 1] === "string" && typeof item === "string") {
                    merged[merged.length - 1] = (merged[merged.length - 1] as string) + item;
                } else {
                    merged.push(item);
                }
            }
            return merged;
        };

        // NOTE: this.args currently contains only parameters after the function name,
        // so for ss: this.args = [N, P1, P2, ...]
        // Markers are numbered by the ordinal position of Pi (1-based).
        this.args.slice(1).forEach((pattern, idx) => {
            if (pattern !== "") {
                parts = replace_pattern_in_parts(parts, pattern, idx + 1);
            }
        });

        this.forms[name] = parts;
        return "";
    }

    private async cl() {
        /**
         * #(cl,N,A1,A2,...) -> return the body of form N with markers filled:
         * all #1 -> A1, #2 -> A2, ... (missing -> "", excess ignored)
         */
        const name = this._arg(0);
        if (!(name in this.forms)) return "";
        const parts = this.forms[name];

        // Build replacement map 1->A1, 2->A2, ...
        const replacement = new Map<number, string>();
        for (let i = 0; i < this.args.length; i++) {
            // this.args[0] is N
            const ai = this.args[i + 1] ?? "";
            replacement.set(i + 1, ai);
        }

        const chunks: string[] = [];
        for (const part of parts) {
            if (part instanceof Marker) {
                chunks.push(replacement.get(part.n) ?? "");
            } else {
                chunks.push(part);
            }
        }
        return chunks.join("");
    }

    private async eq() {
        // #(eq,A,B,T,F) -> T if A==B else F (missing args -> "")
        const A = this._arg(0);
        const B = this._arg(1);
        const T = this._arg(2);
        const F = this._arg(3);
        return A === B ? T : F;
    }

    // // Arithmetic built-ins using BigInt to match Python's arbitrary precision
    private async ml() {
        const a = this._bigintArg(0);
        const b = this._bigintArg(1);
        return (a * b).toString();
    }

    private async ad() {
        const a = this._bigintArg(0);
        const b = this._bigintArg(1);
        return (a + b).toString();
    }

    private async su() {
        const a = this._bigintArg(0);
        const b = this._bigintArg(1);
        return (a - b).toString();
    }

    private async ln() {
        /**
         * #(ln,S) -> return all form names, separated by S.
         */
        const sep = this._arg(0);
        const names = Object.keys(this.forms);
        console.log(`Listing forms: ${names.join(sep)}`);
        return names.join(sep);
    }

    private async dd() {
        /**
         * #(dd,N1,N2,...) -> delete the forms N1, N2, ...
         * Returns null string.
         */
        for (let i = 0; i < this.args.length; i++) {
            const name = this._arg(i);
            if (name in this.forms) {
                delete this.forms[name];
            }
        }
        return "";
    }

    private async ps() {
        const x = this._arg(0);
        if (x !== undefined && x !== null) {
            this.output(String(x));
        }
        return "";
    }

    private async rc() {
        // in non-interactive mode, return undefined if no input left
        if (!this.interactive && this.input.length === 0) return undefined;

        while (this.input.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return this.input.shift() || "";
    }

    private async rs() {
        let result = "";

        while (true) {
            const ch = await this.rc();
            if (ch === undefined) break; // end of input in non-interactive mode
            if (ch === this.meta) break;
            result += ch;
        }
        return result;
    }

    //     rs,
    //     rc,
    //     //
    //     ps,
    //     // cm
    //     ds,
    //     ss,
    //     cl,
    //     // cs
    //     // cc
    //     // cn
    //     // in
    //     // cr
    //     dd,
    //     // da
    //     ad,
    //     su,
    //     ml,
    //     // dv
    //     // bu
    //     // bi
    //     // bc
    //     // bs
    //     // br
    //     eq,
    //     // gr
    //     // sb
    //     // fb
    //     // eb
    //     ln,
    //     // pf
    //     // tn
    //     // tf
    private async qm() {
        // query meta character
        return this.meta;
    }

    private async sl() {
        // string length
        const arg = this._arg(0);
        return `${arg.length}`;
    }

    private async cd() {
        // character to decimal
        const arg = this._arg(0);
        if (arg.length === 0) return "0";
        return `${arg.codePointAt(0) ?? 0}`;
    }

    private async dc() {
        // decimal to character
        const n = this._bigintArg(0);
        if (n < 0n || n > 0x10ffffn) return "";
        return String.fromCodePoint(Number(n));
    }

    //     // sr

    private async cr() {
        // change radix of V from R1 to R2, where V can be represented
        // by 0, 1, ..., 9, A, B, ..., Z.
        // radixes are from 1 to Z
        // (for example, 1 for binary, 9 for decimal, F for hexadecimal, Z for base 36)
        const V = this._arg(2).toUpperCase();
        const R1s = this._arg(0).toUpperCase();
        const R2s = this._arg(1).toUpperCase();

        const RADIXES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const R1 = RADIXES.indexOf(R1s) + 1;
        const R2 = RADIXES.indexOf(R2s) + 1;
        // console.log(`Convert ${V} from base ${R1} to base ${R2}`);
        if (R1 < 1 || R1 > 36 || R2 < 1 || R2 > 36) return "";

        // Convert V from base R1 to an integer
        let intValue = 0n;
        for (let i = 0; i < V.length; i++) {
            const digit = RADIXES.indexOf(V[i]);
            if (digit < 0 || digit >= R1) return ""; // invalid digit for base R1
            intValue = intValue * BigInt(R1) + BigInt(digit);
        }

        // Special case for zero
        if (intValue === 0n) return "0";

        // Convert integer to base R2
        let result = "";
        while (intValue > 0n) {
            const remainder = Number(intValue % BigInt(R2));
            result = RADIXES[remainder] + result;
            intValue = intValue / BigInt(R2);
        }
        return result;
    }
    //     // cr
    //     // hl
    private async hl() {
        process.exit(0);
    }
    //     // ai
    //     // ao
    //     // sp
    //     // rp
    //     // rs 2

    private _arg(i: number): string {
        return i < this.args.length ? this.args[i] : "";
    }

    private _bigintArg(i: number): bigint {
        const s = this._arg(i) || "0";
        // Support optional leading '+' and decimal representation
        // BigInt doesn't like plus signs, so normalize.
        const norm = s.trim().replace(/^\+/, "") || "0";
        try {
            return BigInt(norm);
        } catch {
            // Fallback if not a valid integer string
            return 0n;
        }
    }
}

if (import.meta.main) {
    if (process.argv.length < 3) {
        console.log("TRAC interpreter (CTRL-C or #(hl)' to exit)");
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");

        const input: string[] = [];

        process.stdin.on("data", (key: string) => {
            if (key === "\u0003") process.exit();
            if (key === "\r") key = "\n";
            process.stdout.write(key);
            input.push(key);
        });

        function output(v: string) {
            process.stdout.write(v);
        }

        const trac = new TRAC("#(ps,] )#(ps,#(rs))", input, output, true);
        const v = await trac.run();
        console.log(`=> ${v}`);
    } else {
        const program = process.argv[2];
        console.log(`program: [${program}]`);
        const input = process.argv[3] || "";
        console.log(`input: [${input}]`);

        const trac = new TRAC(program, input, output);
        const v = await trac.run();
        console.log();
        console.log(`=> ${v}`);

        function output(v: string) {
            process.stdout.write(v);
        }
    }
}
