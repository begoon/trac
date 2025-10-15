import { expect, test } from "bun:test";
import { TRAC } from "./trac.ts";

const multiline = `
    #(cl,Factorial,5
    #(ds,Factorial,(
    #(eq,X,1,
    1,
    (#(ml,X,#(cl,Factorial,#(su,X,1)))))))
    #(ss,Factorial,X))'
  `;

const cases = [
    ["abc'xyz", "abc"],
    ["#(ps,(ABC))'", "ABC"],
    ["#(ps,ABC)'x", "ABC"],
    ["#(ps,] )#(ps,#(rs))'XYZ'", "] XYZ"],
    ["((3+4))*9 = #(ml,#(ad,3,4),9)'", "(3+4)*9 = 63"],
    [
        [
            "#(ds,Factorial,(#(eq,X,1,1,(#(ml,X,#(cl,Factorial,#(su,X,1)))))))'",
            "#(ss,Factorial,X)'",
            "#(cl,Factorial,50)'",
        ].join(""),
        "30414093201713378043612608166064768844377641568960512000000000000",
    ],
    [multiline + "#(ps,#(ln,(,)))'", "            120Factorial  "],
    ["#(ds,AA,Cat)'#(ds,BB,(#(cl,AA)))'#(ps,##(ln,(,)))'", "AA,BB"],
    ["#(ps,(#(cl,bb)))'", "#(cl,bb)"],
    ["#(ps,##(cl,BB))'", ""],
    ["#(ps,#(cl,BB))'", ""],
    ["##(qm)'", "'"],
    ["##(sl,12345)'", "5"],
    ["##(cd,X)'", "88"],
    ["##(dc,111)'", "o"],
    ["##(cr,F,9,3FFF)'", "16383"],
    ["##(cr,9,F,1025)'", "401"],
    ["#(ps,##(cr,9,F,1025))'", "401"],
    ["#(cm,`)'#(qm)`", "`"],
    ["#(ad,123,456)'", "579"],
    ["#(su,123,456)'", "-333"],
    ["#(ml,123,456)'", "56088"],
    ["#(dv,1234567,456)'", "2707"],
    ["#(eq,123,123,T,F)'", "T"],
    ["#(eq,123,456,T,F)'", "F"],
    ["#(gr,123,123,T,F)'", "F"],
    ["#(gr,456,123,T,F)'", "T"],
    ["#(gr,123,456,T,F)'", "F"],
    //
    ["#(ds,AA,aa)'#(ds,BB,bb)'#(ps,##(ln,(,)))'#(da)'#(ps,##(ln,(,)))'", "AA,BB"],
    ["#(ds,AA,aa)'#(ds,BB,bb)'#(ps,##(ln,(,)))'#(dd,BB)'#(ps,##(ln,(,)))'", "AA,BBAA"],
];

// --- cs ------------------------------------------------------------
// form: ab X cd Y ef (X and Y become segment markers)
cases.push([
    [
        "#(ds,F,abXcdYef)'",
        "#(ss,F,X,Y)'",
        "#(ps,#(cl,F,<111>,<222>))'",
        "#(ps,(|))'",
        "#(ps,#(cs,F,(?)))'", // -> "ab"
        "#(ps,#(cs,F,(!)))'", // -> "cd"
        "#(ps,#(cs,F,($)))'", // -> "ef"
        "##(cs,F,#(ps,ZZ))'", // end; Z returned in ACTIVE mode -> prints "ZZ"
    ].join(""),
    "ab<111>cd<222>ef|abcdefZZ",
]);

// --- cc ------------------------------------------------------------
// Form: a X b Y c
cases.push([
    [
        "#(ds,G,aXbYc)'",
        "#(ss,G,X,Y)'",
        "#(ps,#(cl,G,<x>,<y>))'",
        "#(ps,(|))'",
        "#(ps,#(cc,G,END))'", // -> "a"
        "#(ps,#(cc,G,END))'", // -> "b"
        "#(ps,#(cc,G,END))'", // -> "c"
        "##(cc,G,END)'", // end; Z returned in ACTIVE mode -> prints "END"
    ].join(""),
    "a<x>b<y>c|abcEND",
]);

// --- cn (positive, then overflow to the right) ---------------------
// Form: ab X cd Y ef
cases.push([
    [
        "#(ds,H,abXcdYef)'",
        "#(ss,H,X,Y)'",
        "#(ps,#(cn,H,3,ZZ))'", // -> "abc" (ptr=3)
        "#(ps,#(cn,H,2,ZZ))'", // -> "de"  (ptr=5)
        "##(cn,H,10,ZZ)'", // would move past end -> Z ACTIVE -> "ZZ"
    ].join(""),
    "abcdeZZ",
]);

// --- cn (negative, then overflow to the left) ----------------------
// Form: ab X cd Y ef
cases.push([
    [
        "#(ds,J,abXcdYef)'",
        "#(ss,J,X,Y)'",
        "#(ps,#(cn,J,4,ZZ))'", // -> "abcd" (ptr=4)
        "#(ps,#(cn,J,-3,ZZ))'", // -> "bcd"  (ptr=1)
        "##(cn,J,-2,ZZ)'", // would move before start -> Z ACTIVE -> "ZZ"
    ].join(""),
    "abcdbcdZZ",
]);

// -------------------------------------------------------------------

// --- in: basic match; value is pre-match, pointer advances to end of match
cases.push([
    [
        "#(ds,F,abXcdYef)'",
        "#(ss,F,X,Y)'",
        "#(ps,#(in,F,cd,NO))'", // match "cd" that sits between markers
    ].join(""),
    "ab",
]);

// --- in: no match because the candidate would cross a marker; Z returned in ACTIVE mode
cases.push([
    [
        "#(ds,F,abXcdYef)'",
        "#(ss,F,X,Y)'",
        "##(in,F,bc,#(ps,NOMATCH))'", // "bc" crosses marker at pos 2 -> no match
    ].join(""),
    "NOMATCH",
]);

// --- in: match later; returned value drops markers; pointer moves to end of match
cases.push([
    [
        "#(ds,F,abXcdYef)'",
        "#(ss,F,X,Y)'",
        "#(ps,#(in,F,ef,NO))'", // match "ef"; value is "abcd" (markers dropped)
    ].join(""),
    "abcd",
]);

// --- in: empty X matches immediately and returns empty; pointer unchanged
cases.push([
    [
        "#(ds,F,abXcd)'",
        "#(ss,F,X)'",
        "#(ps,#(in,F,,NO))'", // X is empty -> immediate match -> prints empty
        "#(ps,#(cc,F,END))'", // prove pointer unchanged: should print first char "a"
    ].join(""),
    "a",
]);

// --- in: demonstrate pointer stationary on no-match, by attempting a character read after
cases.push([
    [
        "#(ds,F,abXcd)'",
        "#(ss,F,X)'",
        "##(in,F,zz,NO)'", // no match -> prints "NO" in ACTIVE mode, pointer stays at 0
        "#(ps,#(cc,F,END))'", // now read next char -> "a"
    ].join(""),
    "NOa",
]);

// -------------------------------------------------------------------
// --- Call Restore basic: read one char, restore, read again -> same first char twice
cases.push([
    [
        "#(ds,F,abXcd)'",
        "#(ss,F,X)'",
        "#(ps,#(cc,F,END))'", // "a" (ptr=1)
        "#(cr,F)'", // restore (ptr=0)
        "#(ps,#(cc,F,END))'", // "a" again
    ].join(""),
    "aa",
]);

// --- Call Restore is null-valued (no output)
// The neutral call produces no characters; then a read shows pointer back at start
cases.push([
    [
        "#(ds,G,HelloYWorld)'",
        "#(ss,G,Y)'",
        "##(cc,G,END)'", // prints "H" (ptr=1)
        "##(cr,G)'", // null-valued, no output, ptr->0
        "##(cc,G,END)'", // prints "H" again
    ].join(""),
    "HH",
]);

// --- Call Restore on form not present: still null-valued, no crash, no output
cases.push(["##(cr,NoSuchForm)'", ""]);

// -------------------------------------------------------------------
// --- pf: initial pointer at start ---

cases.push([["#(ds,F,abXcdYef)'", "#(ss,F,X,Y)'", "#(pf,F)'"].join(""), "<↑>ab<1>cd<2>ef"]);

// --- pf: pointer after consuming 3 characters (ignoring markers) ---
cases.push([
    [
        "#(ds,F,abXcdYef)'",
        "#(ss,F,X,Y)'",
        "##(cn,F,3,ZZ)'", // advance pointer to 3; neutral so nothing printed
        "#(ps,|)'",
        "#(pf,F)'",
    ].join(""),
    "abc|ab<1>c<↑>d<2>ef",
]);

// --- pf: pointer at end of form ---
cases.push([
    [
        "#(ds,F,abXcdYef)'",
        "#(ss,F,X,Y)'",
        "##(cn,F,6,())'", // move pointer to end (length=6)
        "#(ps,|)'",
        "#(pf,F)'",
    ].join(""),
    "abcdef|ab<1>cd<2>ef<↑>",
]);

// -------------------------------------------------------------------
// Boolean suffix examples (from spec notes in the scan):
// abc0100 -> 0100, 1234567890 -> 0, 43210 -> 10, abc -> ""

// bu — union (left-pad shorter with zeros)
cases.push(["#(ps,##(bu,abc0100,11))'", "0111"]); // 0100 OR 0011 = 0111
cases.push(["#(ps,##(bu,abc,101))'", "101"]); // "" OR 101 = 101

// bi — intersection (truncate longer from left)
cases.push(["#(ps,##(bi,abc0100,11))'", "00"]); // last 2 bits of 0100 AND 11 = 00
cases.push(["#(ps,##(bi,xyz,1011))'", ""]); // "" AND 1011 = ""

// bc — complement (same length)
cases.push(["#(ps,##(bc,abc0100))'", "1011"]); // NOT 0100 = 1011
cases.push(["#(ps,##(bc,abc))'", ""]); // NOT "" = ""

// bs — shift (length preserved, zero-fill)
cases.push(["#(ps,##(bs,2,abc0100))'", "0000"]); // 0100 << 2 = 0000
cases.push(["#(ps,##(bs,-1,abc0100))'", "0010"]); // 0100 >> 1 = 0010
cases.push(["#(ps,##(bs,10,1011))'", "0000"]); // overshift left => all zeros
cases.push(["#(ps,##(bs,-10,1011))'", "0000"]); // overshift right => all zeros

// br — rotate (length preserved, circular)
cases.push(["#(ps,##(br,1,abc0100))'", "1000"]); // 0100 rotL 1 = 1000
cases.push(["#(ps,##(br,-2,abc0100))'", "0001"]); // 0100 rotR 2 = 0001
cases.push(["#(ps,##(br,3,1011))'", "1101"]); // 1011 rotL 3 ≡ rotL 1 = 1101
cases.push(["#(ps,##(br,-7,1011))'", "0111"]); // 0111 rotR 7 ≡ rotR 3 = 1101

// -------------------------------------------------------------------
// --- direct form call behaves like cl ---
cases.push([["#(ds,Greet,(Hello(,) #1))'", "#(ss,Greet,#1)'", "#(ps,#(Greet,Alex))'"].join(""), "Hello, Alex"]);

// --- overlay a builtin: define a form named 'eq' and ensure the form is called (forms before builtins) ---
cases.push([
    [
        "#(ds,eq,FORM)'", // define a form with name 'eq'
        "#(ps,#(eq))'", // should call the form, not the builtin
    ].join(""),
    "FORM",
]);

// --- direct form call with multiple arguments and markers ---
cases.push([["#(ds,Join,(#1-#2))'", "#(ss,Join,#1,#2)'", "#(ps,#(Join,HELLO,WORLD))'"].join(""), "HELLO-WORLD"]);

// ---------------------------
cases.push(["#(sb, A, F1, F2)'", "N/A"], ["#(fb, A)'", "N/A"], ["#(eb, A)'", "N/A"]);

// --- Run tests -------------------------------------------------------
test.each(cases)("[%s] -> [%s]", async (input, output) => {
    let out: string = "";
    const trac = new TRAC(input, (v) => (out += v));
    await trac.run();
    expect(out).toBe(output);
});
