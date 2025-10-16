import fs from "node:fs";

type Part = string | Marker; // a chunk of literal text or a numbered marker

class Halt extends Error {}

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

// A segment marker placed by ss(), numbered 1, 2, 3, ...
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

    initial: string; // initial program to run: "#(ps,#(rs))" by default

    // interpreter I/O
    input: string[] = []; // input stream for rs/rc
    output: (v: string) => void;

    interactive: boolean = false;

    meta: string = "'";

    tracing: boolean = false;
    newline: boolean = true; // whether the last output ended with a newline

    private _skip_chars = new Set<string>(["\t", "\n", "\r", "'"]);

    formPointers: Record<string, number> = {}; // per-form pointers (character index, ignoring markers)
    private _forceActiveInsert: string | null = null; // request to force-active deliver a value from a builtin

    constructor(
        input: string[] | string,
        output: (v: string) => void,
        { initial, interactive }: { initial?: string; interactive: boolean } = { interactive: false }
    ) {
        this.initial = initial ?? "#(ps,#(rs))";
        this.input = Array.isArray(input) ? input : Array.from(input);
        this.output = output;
        this.interactive = interactive;
        this.tracing = false;
    }

    async run() {
        this._reset_processor(this.initial);

        while (true) {
            // Step 2: end-of-active?
            if (this.scan >= this.active.length) {
                // if (!this.interactive) break;
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
                try {
                    await this._end_function_and_evaluate();
                } catch (e) {
                    if (e instanceof Halt) break;
                    throw e;
                }
                continue;
            }

            // Step 10: ordinary char
            this._move_active_char_to_neutral();
        }

        return this.neutral.join("");
    }

    private _clear_processor() {
        this.neutral.length = 0;
        this.active.length = 0;
        this.scan = 0;
        this.frames.length = 0;
        this.args = [];
    }

    private _reset_processor(program: string) {
        this._clear_processor();
        this.active = Array.from(program);
    }

    private _delete_active_char() {
        if (this.scan < this.active.length) {
            this.active.splice(this.scan, 1);
        }
    }

    private _move_active_char_to_neutral() {
        this.neutral.push(this.active[this.scan]);
        this._delete_active_char();
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
            // note: "i" doesn't increment because we remove from active
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

        if (this.tracing) {
            if (!this.newline) this.output("\n");
            const printable = (s: string) => s.replace(/\n/g, "<10>").replace(/\r/g, "<13>").replace(/\t/g, "<09>");
            this.output(`CALL "${name}" [${this.args.map((v) => printable(v))}]\n`);
            this.newline = true;
            if (this.interactive) {
                this.output("continue? (Y/n) ");
                const yn = await this.rc();
                if (yn !== "\n" && yn !== "\r") this.output("\n");
                if (yn != null && yn.toLowerCase().startsWith("n")) {
                    this._reset_processor(this.initial);
                    return;
                }
            }
        }

        // 1. if a form with this name exists, treat it as #(cl,name, A1, A2, ...)
        if (Object.prototype.hasOwnProperty.call(this.forms, name)) {
            const parts = this.forms[name];

            // build replacement map: 1 -> A1, 2 -> A2, ...
            const replacement = new Map<number, string>();
            for (let i = 0; i < this.args.length; i++) {
                replacement.set(i + 1, this.args[i] ?? "");
            }

            const chunks: string[] = [];
            for (const part of parts) {
                if (part instanceof Marker) {
                    chunks.push(replacement.get(part.n) ?? "");
                } else {
                    chunks.push(part);
                }
            }
            value = chunks.join("");
        } else if (hasFunction(this, name)) {
            // 2. else fall back to a builtin of that name (if any)
            value = await this[name]();
        } else {
            // 3. otherwise, undefined form/function -> null string by convention
            value = "";
        }

        if (this._forceActiveInsert !== null) {
            const v = this._forceActiveInsert;
            this._forceActiveInsert = null;
            // deliver as ACTIVE regardless of frame.mode
            this.active = Array.from(v).concat(this.active.slice(this.scan));
            this.scan = 0;
            this.args = [];
            return; // skip the normal delivery below
        }

        if (frame.mode === "neutral") {
            this.neutral.push(...Array.from(value));
        } else {
            this.active = Array.from(value).concat(this.active.slice(this.scan));
            this.scan = 0;
        }

        this.args = [];
    }

    private _ensurePointer(name: string) {
        if (!(name in this.formPointers)) this.formPointers[name] = 0;
    }

    private _formLength(name: string): number {
        if (!(name in this.forms)) return 0;
        let v = 0;
        for (const part of this.forms[name]) {
            if (typeof part === "string") v += part.length;
        }
        return v;
    }

    private _formSlice(name: string, start: number, end: number): string {
        // Slice [start, end) by counting only literal characters, skipping Markers
        if (!(name in this.forms)) return "";

        if (start < 0) start = 0;
        const formLength = this._formLength(name);
        if (end > formLength) end = formLength;
        if (start >= end) return "";

        let v = "";
        let i = 0; // character index among literal chars
        for (const part of this.forms[name]) {
            if (part instanceof Marker) continue;
            const advance = i + part.length;
            // overlap of [i, advance) with [start, end)
            const a = Math.max(start, i);
            const b = Math.min(end, advance);
            if (b > a) v += part.slice(a - i, b - i);
            i = advance;
            if (i >= end) break;
        }
        return v;
    }

    private _markerBoundaries(name: string): number[] {
        // Return the list of character positions (ignoring markers) where a Marker sits,
        // i.e., boundary immediately to the *right* of the characters encountered so far.
        // Also append the end-of-body as a boundary.
        const bounds: number[] = [];
        if (!(name in this.forms)) return [0];

        let i = 0;
        for (const part of this.forms[name]) {
            if (part instanceof Marker) {
                bounds.push(i);
            } else {
                i += part.length;
            }
        }
        bounds.push(i); // end of body counts as a boundary
        return bounds;
    }

    private async ds() {
        const name = this._arg(0);
        const body = this._arg(1);
        if (!name) return "";
        this.forms[name] = [body]; // literal body, no markers yet
        this.formPointers[name] = 0; // reset pointer when (re)defining a form
        return "";
    }

    private async ss() {
        const name = this._arg(0);
        if (!(name in this.forms)) return "";
        let parts = this.forms[name];

        const replace_pattern_in_parts = (partsIn: Part[], pattern: string, index: number): Part[] => {
            if (pattern === "") return partsIn;

            const rebuilt: Part[] = [];
            for (const part of partsIn) {
                if (part instanceof Marker) {
                    rebuilt.push(part);
                    continue;
                }
                let i = 0;
                const advance = pattern.length;
                while (true) {
                    const j = part.indexOf(pattern, i);
                    if (j === -1) {
                        rebuilt.push(part.slice(i));
                        break;
                    }
                    rebuilt.push(part.slice(i, j)); // prefix
                    rebuilt.push(new Marker(index)); // marker
                    i = j + advance; // continue after match
                }
            }

            // merge adjacent strings for cleanliness
            const merged: Part[] = [];
            for (const part of rebuilt) {
                if (merged.length && typeof merged[merged.length - 1] === "string" && typeof part === "string") {
                    merged[merged.length - 1] = merged[merged.length - 1] + part;
                } else {
                    merged.push(part);
                }
            }
            return merged;
        };

        // NOTE: this.args currently contains only parameters after the function name,
        // so for ss: this.args = [N, P1, P2, ...].
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
        const name = this._arg(0);
        if (!(name in this.forms)) return "";
        const parts = this.forms[name];

        // build replacement map 1->A1, 2->A2, ...
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

    private async cs() {
        const name = this._arg(0);
        const Z = this._arg(1);
        if (!(name in this.forms)) return "";

        this._ensurePointer(name);
        const formLength = this._formLength(name);
        let pointer = this.formPointers[name];

        if (pointer >= formLength) {
            // return Z in ACTIVE mode regardless of call mode
            this._forceActiveInsert = Z;
            return "";
        }

        // next boundary strictly to the right of p, end-of-body counts as boundary
        const bounds = this._markerBoundaries(name);
        let end = formLength;
        for (const x of bounds) {
            if (x > pointer) {
                end = x;
                break;
            }
        }

        const v = this._formSlice(name, pointer, end);
        this.formPointers[name] = end; // pointer left just before the char right of marker
        return v;
    }

    private async cc() {
        const name = this._arg(0);
        const Z = this._arg(1);
        if (!(name in this.forms)) return "";

        this._ensurePointer(name);
        const formLength = this._formLength(name);
        let pointer = this.formPointers[name];

        if (pointer >= formLength) {
            this._forceActiveInsert = Z; // active-mode return
            return "";
        }

        const v = this._formSlice(name, pointer, pointer + 1);
        this.formPointers[name] = pointer + 1; // advance just beyond selected character
        return v;
    }

    private async cn() {
        const name = this._arg(0);
        const D_ = this._bigintArg(1);
        const Z = this._arg(2);
        if (!(name in this.forms)) return "";

        const D = Number(D_); // D can be negative; we only use small ranges in practice
        this._ensurePointer(name);
        const formLength = this._formLength(name);
        let pointer = this.formPointers[name];

        if (D === 0) return ""; // null string, pointer does not move

        if (D > 0) {
            const end = pointer + D;
            if (end > formLength) {
                this._forceActiveInsert = Z; // would move off right end
                return "";
            }
            const v = this._formSlice(name, pointer, end);
            this.formPointers[name] = end;
            return v;
        } else {
            // D < 0, read to the left, return in normal order, move pointer left
            const start = pointer + D; // D negative
            if (start < 0) {
                this._forceActiveInsert = Z; // would move off left end
                return "";
            }
            const v = this._formSlice(name, start, pointer);
            this.formPointers[name] = start;
            return v;
        }
    }

    private async ["in"]() {
        const name = this._arg(0);
        const X = this._arg(1);
        const Z = this._arg(2);

        if (!(name in this.forms)) return "";

        this._ensurePointer(name);
        const formLength = this._formLength(name);
        const pointer = this.formPointers[name];

        const lenX = X.length;
        // Empty X matches immediately at pointer (returns empty, pointer unchanged).
        if (lenX === 0) return "";

        // Marker boundaries (positions in the marker-free coordinate space).
        // We consider a candidate match [i, i+lenX) valid iff there is no boundary b with i < b < i+lenX.
        const bounds = this._markerBoundaries(name);

        const hasBoundaryInside = (i: number, j: number): boolean => {
            for (const b of bounds) {
                if (b > i && b < j) return true;
            }
            return false;
        };

        // Search forward from p0 for the first valid match
        let foundAt: number | null = null;
        for (let i = pointer; i + lenX <= formLength; i++) {
            if (hasBoundaryInside(i, i + lenX)) continue;
            const slice = this._formSlice(name, i, i + lenX);
            if (slice === X) {
                foundAt = i;
                break;
            }
        }

        if (foundAt === null) {
            // No match: return Z in ACTIVE mode regardless of call mode.
            this._forceActiveInsert = Z;
            return "";
        }

        // Value: substring from original pointer to char immediately preceding the match
        const value = this._formSlice(name, pointer, foundAt);

        // Move pointer to just before the char immediately following the matching substring
        this.formPointers[name] = foundAt + lenX;

        return value;
    }

    private async eq() {
        const A = this._arg(0);
        const B = this._arg(1);
        const T = this._arg(2);
        const F = this._arg(3);
        return A === B ? T : F;
    }

    private async gr() {
        const A = this._bigintArg(0);
        const B = this._bigintArg(1);
        const T = this._arg(2);
        const F = this._arg(3);
        return A > B ? T : F;
    }

    private async ml() {
        const a = this._bigintArg(0);
        const b = this._bigintArg(1);
        return (a * b).toString();
    }

    private async dv() {
        const a = this._bigintArg(0);
        const b = this._bigintArg(1);
        if (b === 0n) return "0";
        return (a / b).toString();
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

    private _boolSuffix(s: string): string {
        let i = s.length - 1;
        while (i >= 0 && (s[i] === "0" || s[i] === "1")) i--;
        return s.slice(i + 1); // "" if last char wasn’t 0/1
    }

    private _padLeftWithZeros(s: string, len: number): string {
        if (s.length >= len) return s;
        return "0".repeat(len - s.length) + s;
    }

    private _takeRight(s: string, len: number): string {
        if (len <= 0) return "";
        return s.length <= len ? s : s.slice(s.length - len);
    }

    private async bu() {
        // Boolean Union (bitwise OR), left-pad shorter with zeros
        const A = this._boolSuffix(this._arg(0));
        const B = this._boolSuffix(this._arg(1));
        const L = Math.max(A.length, B.length);
        if (L === 0) return "";
        const a = this._padLeftWithZeros(A, L);
        const b = this._padLeftWithZeros(B, L);
        let v = "";
        for (let i = 0; i < L; i++) v += a[i] === "1" || b[i] === "1" ? "1" : "0";
        return v;
    }

    private async bi() {
        // Boolean Intersection (bitwise AND), truncate longer from the left
        const A = this._boolSuffix(this._arg(0));
        const B = this._boolSuffix(this._arg(1));
        const L = Math.min(A.length, B.length);
        if (L === 0) return "";
        const a = this._takeRight(A, L);
        const b = this._takeRight(B, L);
        let v = "";
        for (let i = 0; i < L; i++) v += a[i] === "1" && b[i] === "1" ? "1" : "0";
        return v;
    }

    private async bc() {
        // Boolean Complement (bitwise NOT), same length as Boolean value
        const A = this._boolSuffix(this._arg(0));
        let v = "";
        for (let i = 0; i < A.length; i++) v += A[i] === "1" ? "0" : "1";
        return v;
    }

    private async bs() {
        // Boolean Shift: S>0 left, S<0 right, zero-fill, length preserved
        const S = Number(this._bigintArg(0));
        const A = this._boolSuffix(this._arg(1));
        const L = A.length;
        if (L === 0) return "";
        if (S === 0) return A;

        if (S > 0) {
            const k = Math.min(S, L);
            return this._takeRight(A, L - k) + "0".repeat(k); // drop k leftmost, zeros on right
        } else {
            const k = Math.min(-S, L);
            return "0".repeat(k) + A.slice(0, L - k); // zeros on left, drop k rightmost
        }
    }

    private async br() {
        // Boolean Rotate: S>0 left, S<0 right, circular, length preserved
        let S = Number(this._bigintArg(0));
        const A = this._boolSuffix(this._arg(1));
        const L = A.length;
        if (L === 0) return "";
        S %= L; // normalize
        if (S === 0) return A;
        if (S > 0) {
            // left rotate
            return A.slice(S) + A.slice(0, S);
        } else {
            // right rotate
            const k = -S;
            return A.slice(L - k) + A.slice(0, L - k);
        }
    }

    private async ln() {
        const separator = this._arg(0);
        const names = Object.keys(this.forms);
        return names.join(separator);
    }

    private async da() {
        this.forms = {};
        this.formPointers = {};
        return "";
    }

    private async dd() {
        for (let i = 0; i < this.args.length; i++) {
            const name = this._arg(i);
            if (name in this.forms) delete this.forms[name];
            if (name in this.formPointers) delete this.formPointers[name];
        }
        return "";
    }

    private async ps() {
        const x = this._arg(0);
        if (x !== undefined && x !== null) {
            const v = String(x);
            this.output(v);
            this.newline = v.length === 0 || v.at(-1) === "\n";
        }
        return "";
    }

    private async rc() {
        if (!this.interactive && this.input.length === 0) throw new Halt();

        while (this.input.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return this.input.shift();
    }

    private async rs() {
        let result = "";

        while (true) {
            const ch = await this.rc();
            if (ch === this.meta) break;
            if (ch === undefined) return "";
            result += ch;
        }
        return result;
    }

    private async cm() {
        // change meta character
        const m = this._arg(0);
        if (m.length > 0) this.meta = m[0];
        return "";
    }

    private async pf() {
        // pointer is shown as "<↑>".
        // segment markers are shown as "<i>" (i = ordinal)
        const name = this._arg(0);
        if (!(name in this.forms)) return "";

        this._ensurePointer(name);
        const pointer = this.formPointers[name];
        const MARK = "<↑>";

        let v = "";
        let i = 0; // character index among literal chars (markers ignored)
        let pointerPrinted = false;

        const maybePrintPointerAt = (p: number) => {
            if (!pointerPrinted && pointer === p) {
                v += MARK;
                pointerPrinted = true;
            }
        };

        for (const part of this.forms[name]) {
            if (part instanceof Marker) {
                maybePrintPointerAt(i);
                v += `<${part.n}>`;
                continue;
            }
            // literal string
            const s = part as string;
            const L = s.length;

            // If pointer falls inside this literal chunk, split once.
            if (!pointerPrinted && pointer >= i && pointer <= i + L) {
                const k = pointer - i; // 0..L
                v += s.slice(0, k) + MARK + s.slice(k);
                pointerPrinted = true;
            } else {
                v += s;
            }
            i += L;
        }

        // Pointer at end of form
        maybePrintPointerAt(i);

        this.output(v);
        this.newline = v.length === 0 || v.at(-1) === "\n";
        return "";
    }

    private async sb() {
        // store block: A, F1, F2, ...
        return "N/A";
    }

    private async fb() {
        // fetch block: A
        return "N/A";
    }

    private async eb() {
        // erase block: A
        return "N/A";
    }

    private async tn() {
        this.tracing = true;
        return "";
    }

    private async tf() {
        this.tracing = false;
        return "";
    }

    private async qm() {
        return this.meta;
    }

    private async sl() {
        const arg = this._arg(0);
        return `${arg.length}`;
    }

    private async cd() {
        const arg = this._arg(0);
        if (arg.length === 0) return "0";
        return `${arg.codePointAt(0) ?? 0}`;
    }

    private async dc() {
        const n = this._bigintArg(0);
        if (n < 0n || n > 0x10ffffn) return "";
        return String.fromCodePoint(Number(n));
    }

    private async sr() {
        const name = this._arg(0);
        if (!(name in this.forms)) return "0";

        const parts = this.forms[name];
        const seen = new Set<number>();
        let max = 0;

        for (const part of parts) {
            if (part instanceof Marker) {
                seen.add(part.n);
                if (part.n > max) max = part.n;
            }
        }

        if (max === 0) return "0"; // no markers -> no gaps

        // if any 1..max missing -> return max, else 0
        for (let i = 1; i <= max; i++) {
            if (!seen.has(i)) return String(max);
        }
        return "0";
    }

    private async cr() {
        // #(cr,N)  -> Call Restore (null-valued)
        // #(cr,R1,R2,V)  -> Change radix (existing)

        if (this.args.length === 1) {
            const name = this._arg(0);
            if (name in this.forms) {
                this._ensurePointer(name);
                this.formPointers[name] = 0; // reset to just before the first character
            }
            return "";
        }

        const V = this._arg(2).toUpperCase();
        const r1 = this._arg(0).toUpperCase();
        const r2 = this._arg(1).toUpperCase();

        const RADIXES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const R1 = RADIXES.indexOf(r1) + 1;
        const R2 = RADIXES.indexOf(r2) + 1;
        if (R1 < 1 || R1 > 36 || R2 < 1 || R2 > 36) return "";

        // convert V from base R1 to an integer
        let v = 0n;
        for (let i = 0; i < V.length; i++) {
            const digit = RADIXES.indexOf(V[i]);
            if (digit < 0 || digit >= R1) return "";
            v = v * BigInt(R1) + BigInt(digit);
        }

        if (v === 0n) return "0";

        // convert integer to base R2
        let result = "";
        while (v > 0n) {
            const remainder = Number(v % BigInt(R2));
            result = RADIXES[remainder] + result;
            v = v / BigInt(R2);
        }
        return result;
    }

    private async hl() {
        throw new Halt();
    }

    private async ai() {
        return "N/A";
    }

    private async ao() {
        return "N/A";
    }

    private async sp() {
        return "N/A";
    }

    private async rp() {
        return "N/A";
    }

    private _arg(i: number): string {
        return i < this.args.length ? this.args[i] : "";
    }

    private _bigintArg(i: number): bigint {
        const s = this._arg(i) || "0";
        // Support optional leading '+' and decimal representation.
        // BigInt doesn't like plus signs, so normalize.
        const norm = s.trim().replace(/^\+/, "") || "0";
        try {
            return BigInt(norm);
        } catch {
            // fallback if not a valid integer string
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

        const trac = new TRAC(input, output, {
            initial: "#(ps,##(dc,13)##(dc,10)TRAC> )#(ps,#(rs))",
            interactive: true,
        });
        await trac.run();
        process.exit();
    } else {
        const files = process.argv.slice(2);

        const input: string[] = [];
        for (const file of files) {
            const data = file.at(0) == "@" ? file.slice(1) : fs.readFileSync(file, "utf-8");
            input.push(data);
        }

        const trac = new TRAC(input.join("\n"), (v) => process.stdout.write(v));
        await trac.run();
        console.log();
    }
}

function hasFunction<T extends object>(
    obj: T,
    key: PropertyKey
): obj is T & Record<typeof key, (...args: any[]) => any> {
    return typeof (obj as any)[key] === "function";
}
