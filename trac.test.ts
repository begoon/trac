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
    { code: "abc'xyz", input: "", output: "", active: "abcxyz" },
    { code: "#(abc)'xyz", input: "", output: "", active: "xyz" },
    { code: "#(ps,ABC)'x", input: "", output: "ABC", active: "x" },
    { code: "#(ps,] )#(ps,#(rs))'", input: "XYZ", output: "] XYZ", active: "" },
    { code: "((3+4))*9 = #(ml,#(ad,3,4),9)'", input: "", output: "", active: "(3+4)*9 = 63" },
    {
        code: [
            "#(ds,Factorial,(#(eq,X,1,1,(#(ml,X,#(cl,Factorial,#(su,X,1)))))))'",
            "#(ss,Factorial,X)'",
            "#(cl,Factorial,50)'",
        ].join(""),
        input: "",
        output: "",
        active: "30414093201713378043612608166064768844377641568960512000000000000",
    },
    {
        code: multiline + "#(ps,#(ln,(,)))'",
        input: "",
        output: "Factorial",
        active: "120",
    },
    {
        code: "#(ds,AA,Cat)'#(ds,BB,(#(cl,AA)))'#(ps,##(ln,(,)))'",
        input: "",
        output: "AA,BB",
        active: "",
    },
    { code: "#(ps,(#(cl,bb)))'", input: "", output: "#(cl,bb)", active: "" },
    { code: "#(ps,##(cl,BB))'", input: "", output: "", active: "" },
    { code: "#(ps,#(cl,BB))'", input: "", output: "", active: "" },
    { code: "##(qm)'", input: "", output: "", active: "'" },
    { code: "##(sl,12345)'", input: "", output: "", active: "5" },
    { code: "##(cd,X)'", input: "", output: "", active: "88" },
    { code: "##(dc,111)'", input: "", output: "", active: "o" },
    { code: "##(cr,F,9,3FFF)'", input: "", output: "", active: "16383" },
    { code: "##(cr,9,F,1025)'", input: "", output: "", active: "401" },
    { code: "#(ps,##(cr,9,F,1025))'", input: "", output: "401", active: "" },
];

test.each(cases)("[$code][$input] -> [$output][$active]", async ({ code, input, output, active }) => {
    let out: string = "";
    const trac = new TRAC(code, input, (v) => (out += v));
    const act = await trac.run();
    expect(out).toBe(output);
    expect(act.trim()).toBe(active);
});
