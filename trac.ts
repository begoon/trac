// trac.ts

type BuiltIn = (t: TRAC) => string;

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
    builtins: Record<string, BuiltIn> = {};

    // persistent across execute() calls
    forms: Record<string, Part[]> = {};

    // runtime working state (reset per record)
    active: string[] = [];
    neutral: string[] = [];
    scan = 0;
    frames: Frame[] = [];
    args: string[] = [];

    // characters to skip at step 3 (record/whitespace)
    private _skip_chars = new Set<string>(["\t", "\n", "\r", "'"]);

    constructor(builtins?: Record<string, BuiltIn>) {
        this._register_core_builtins();
        if (builtins) {
            Object.assign(this.builtins, builtins); // allow user overrides
        }
    }

    execute(s: string): string {
        // matches Python sample's printing of the input record
        console.log(s);

        this._reset_processor_with(s);
        while (true) {
            // Step 2: end-of-active?
            if (this.scan >= this.active.length) break;

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
                this._end_function_and_evaluate();
                continue;
            }

            // Step 10: ordinary char
            this._move_active_char_to_neutral();
        }

        return this.neutral.join("");
    }

    // --- internals ---

    private _reset_processor_with(program: string) {
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
        for (let off = 0; off < expect.length; off++) {
            if (this.active[i + off] !== expect[off]) return false;
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

    private _end_function_and_evaluate() {
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
        if (Object.prototype.hasOwnProperty.call(this.builtins, name)) {
            try {
                value = this.builtins[name](this);
            } catch {
                value = "";
            }
        } else {
            value = "";
        }

        // deliver
        if (frame.mode === "neutral") {
            this.neutral.push(...Array.from(value));
        } else {
            this.active = Array.from(value).concat(this.active.slice(this.scan));
            this.scan = 0;
        }

        this.args = []; // clear after call
    }

    private _register_core_builtins() {
        const ds: BuiltIn = (t: TRAC): string => {
            // #(ds,N,B) -> define/replace form N with body B.
            // store as a list<Part> with a single literal chunk initially.
            const name = t._arg(0);
            const body = t._arg(1);
            if (!name) return "";
            t.forms[name] = [body]; // literal body, no markers yet
            return "";
        };

        const ss: BuiltIn = (t: TRAC): string => {
            /**
             * #(ss,N,P1,P2,...) -> create ordinal segment markers in form N.
             * Each non-null Pi is searched L->R and each occurrence (that does not cross
             * an existing marker) is replaced by Marker(i).
             */
            const name = t._arg(0);
            if (!(name in t.forms)) return "";
            let parts = t.forms[name]; // list<Part>

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

                // merge adjacent strings for cleanliness
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

            // NOTE: t.args currently contains only parameters after the function name,
            // so for ss: t.args = [N, P1, P2, ...]
            // Markers are numbered by the ordinal position of Pi (1-based).
            t.args.slice(1).forEach((pattern, idx) => {
                if (pattern !== "") {
                    parts = replace_pattern_in_parts(parts, pattern, idx + 1);
                }
            });

            t.forms[name] = parts;
            return "";
        };

        const cl: BuiltIn = (t: TRAC): string => {
            /**
             * #(cl,N,A1,A2,...) -> return the body of form N with markers filled:
             * all #1 -> A1, #2 -> A2, ... (missing -> "", excess ignored)
             */
            const name = t._arg(0);
            if (!(name in t.forms)) return "";
            const parts = t.forms[name];

            // Build replacement map 1->A1, 2->A2, ...
            const replacement = new Map<number, string>();
            for (let i = 0; i < t.args.length; i++) {
                // t.args[0] is N
                const ai = t.args[i + 1] ?? "";
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
        };

        const eq: BuiltIn = (t: TRAC): string => {
            // #(eq,A,B,T,F) -> T if A==B else F (missing args -> "")
            const A = t._arg(0);
            const B = t._arg(1);
            const T = t._arg(2);
            const F = t._arg(3);
            return A === B ? T : F;
        };

        // Arithmetic built-ins using BigInt to match Python's arbitrary precision
        const ml: BuiltIn = (t: TRAC): string => {
            const a = t._bigintArg(0);
            const b = t._bigintArg(1);
            return (a * b).toString();
        };

        const ad: BuiltIn = (t: TRAC): string => {
            const a = t._bigintArg(0);
            const b = t._bigintArg(1);
            return (a + b).toString();
        };

        const su: BuiltIn = (t: TRAC): string => {
            const a = t._bigintArg(0);
            const b = t._bigintArg(1);
            return (a - b).toString();
        };

        const ln: BuiltIn = (t: TRAC): string => {
            /**
             * #(ln,S) -> return all form names, separated by S.
             */
            const sep = t._arg(0);
            const names = Object.keys(t.forms);
            return names.join(sep);
        };

        const dd: BuiltIn = (t: TRAC): string => {
            /**
             * #(dd,N1,N2,...) -> delete the forms N1, N2, ...
             * Returns null string.
             */
            for (let i = 0; i < t.args.length; i++) {
                const name = t._arg(i);
                if (name in t.forms) {
                    delete t.forms[name];
                }
            }
            return "";
        };

        const ps: BuiltIn = (t: TRAC): string => {
            /**
             * #(ps,X) -> print the string X to output (stdout here).
             * Returns null string.
             */
            const x = t._arg(0);
            if (x !== undefined && x !== null) {
                process.stdout.write(String(x));
            }
            return "";
        };

        Object.assign(this.builtins, {
            ds,
            ss,
            cl,
            eq,
            ml,
            su,
            ad,
            ln,
            dd,
            ps,
        });
    }

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

// --- sample usage & assertions (mirroring the Python __main__) ---

if (require.main === module) {
    const trac = new TRAC();

    const fact = "#(ds,Factorial,(#(eq,X,1,1,(#(ml,X,#(cl,Factorial,#(su,X,1)))))))'";
    let v = trac.execute(fact);
    console.assert(v === "", `v=${v}`);

    const fact_ss = "#(ss,Factorial,X)'";
    v = trac.execute(fact_ss);
    console.assert(v === "", `v=${v}`);

    const fact_5 = "#(cl,Factorial,5)'";
    v = trac.execute(fact_5);
    console.log(v);
    console.assert(v === "120", `v=${v}`);

    const fact_50 = "#(cl,Factorial,50)'";
    v = trac.execute(fact_50);
    console.log(v);
    console.assert(v === "30414093201713378043612608166064768844377641568960512000000000000", `v=${v}`);

    const trivia = "((3+4))*9 = #(ml,#(ad,3,4),9)'";
    v = trac.execute(trivia);
    console.log(v);
    console.assert(v === "(3+4)*9 = 63", `v=${v}`);

    const fact_ = `
    #(cl,Factorial,5
    #(ds,Factorial,(
    #(eq,X,1,
    1,
    (#(ml,X,#(cl,Factorial,#(su,X,1)))))))
    #(ss,Factorial,X))'
  `;
    v = trac.execute(fact_.trim()).trim();
    console.log(v);
    console.assert(v === "120", `v=${v}`);

    v = trac.execute("#(ps,#(ln,(,)))'");
    console.log(v);
    console.assert(v === "", `v=${v}`);

    v = trac.execute("#(ds,AA,Cat)'");
    console.log(v);
    console.assert(v === "", `v=${v}`);

    v = trac.execute("#(ds,BB,(#(cl,AA)))'");
    console.log(v);
    console.assert(v === "", `v=${v}`);

    v = trac.execute("#(ps,(#(cl,bb)))'");
    console.log(v);
    console.assert(v === "", `v=${v}`);

    v = trac.execute("#(ps,##(cl,BB))'");
    console.log(v);
    console.assert(v === "", `v=${v}`);

    v = trac.execute("#(ps,#(cl,BB))'");
    console.log(v);
    console.assert(v === "", `v=${v}`);
}
