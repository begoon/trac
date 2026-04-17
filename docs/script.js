import { TRAC } from "./trac.js";

// Inlined copies of ../examples/*.trac. If you edit a program there,
// update it here too.
const EXAMPLES = {
    hello: `#(ps,(Hello, world!))'
`,

    factorial: `#(ds,Factorial,(#(eq,X,1,1,(#(ml,X,#(cl,Factorial,#(su,X,1)))))))'
#(ss,Factorial,X)'
#(cl,Factorial,50)'
`,

    e: `#(ds,Factorial,(#(eq,X,1,1,(#(ml,X,#(cl,Factorial,#(su,X,1)))))))'
#(ss,Factorial,X)'

#(ds,pow10,(#(eq,P,0,1,(#(ml,10,#(cl,pow10,#(su,P,1)))))))'
#(ss,pow10,P)'

#(ds,zeros,(#(eq,K,0,,(0#(cl,zeros,#(su,K,1))))))'
#(ss,zeros,K)'

#(ds,padfrac,(#(cl,zeros,#(su,P,#(sl,S)))S))'
#(ss,padfrac,P,S)'

#(ds,esum,(#(eq,N,0,#(ad,A,#(dv,S,1)),(#(cl,esum,#(su,N,1),#(ad,A,#(dv,S,#(cl,Factorial,N))),S)))))'
#(ss,esum,N,A,S)'

#(ds,N,15)'
#(ds,P,10)'

#(ds,S,#(cl,pow10,#(cl,P)))'
#(ds,T,#(cl,esum,#(cl,N),0,#(cl,S)))'

#(ps,#(dv,#(cl,T),#(cl,S)).#(cl,padfrac,#(cl,P),(#(su,#(cl,T),#(ml,#(dv,#(cl,T),#(cl,S)),#(cl,S))))))'
`,

    pi: `#(ds,pow10,(#(eq,P,0,1,(#(ml,10,#(cl,pow10,#(su,P,1)))))))'
#(ss,pow10,P)'

#(ds,pow,(#(eq,E,0,1,(#(ml,Q,#(cl,pow,Q,#(su,E,1)))))))'
#(ss,pow,Q,E)'

#(ds,padfrac,(#(gr,P,#(sl,S),(#(cl,padfrac,P,(0S))),S)))'
#(ss,padfrac,P,S)'

#(ds,denominator,(#(ml,#(ad,#(ml,2,K),1),#(cl,pow,Q,#(ad,#(ml,2,K),1)))))'
#(ss,denominator,K,Q)'

#(ds,term,(#(dv,scale,#(cl,denominator,K,Q))))'
#(ss,term,scale,K,Q)'

#(ds,atan,(#(eq,K,#(ad,N,1),A,(#(cl,atan,#(ad,K,1),N,Q,scale,#(su,0,sign),#(ad,A,#(ml,sign,#(cl,term,scale,K,Q))))))) )'
#(ss,atan,K,N,Q,scale,sign,A)'

#(ds,P,10)'
#(ds,N5,14)'
#(ds,N239,8)'

#(ds,S,#(cl,pow10,#(cl,P)))'

#(ds,T5,#(cl,atan,0,#(cl,N5),5,#(ml,16,#(cl,S)),1,0))'
#(ds,T239,#(cl,atan,0,#(cl,N239),239,#(ml,4,#(cl,S)),1,0))'
#(ds,T,#(su,#(cl,T5),#(cl,T239)))'

#(ps,#(dv,#(cl,T),#(cl,S)).#(cl,padfrac,#(cl,P),(#(su,#(cl,T),#(ml,#(dv,#(cl,T),#(cl,S)),#(cl,S))))))'
`,

    hanoi: `#(ds,other,(#(su,6,#(ad,this,that))))'
#(ss,other,this,that)'

#(ds,hanoi,(#(gr,N,1,
(#(cl,hanoi,this,#(cl,other,this,that),#(su,N,1))#(ps,from this to that##(dc,10))#(cl,hanoi,#(cl,other,this,that),that,#(su,N,1))),
(#(ps,from this to that##(dc,10)))
)))'
#(ss,hanoi,this,that,N)'

#(hanoi,1,3,3)'
`,

    rule_110: `#(ds,dots,(#(ds,T,(A))#(ss,T,0,1)#(cl,T,.,1)))'
#(ss,dots,A)'

#(ds,r110,(#(bu,#(bu,#(bi,#(bc,#(bs,-1,A)),A),#(bi,#(bs,1,A),#(bc,A))),#(bi,#(bi,#(bs,-1,A),A),#(bc,#(bs,1,A))))))'
#(ss,r110,A)'

#(ds,rep,(#(gr,N,0,(S#(cl,rep,S,#(su,N,1))),)))'
#(ss,rep,S,N)'

#(ds,seed,(#(cl,rep,0,L)1#(cl,rep,0,L)))'
#(ss,seed,L)'

#(ds,run,(#(ps,#(cl,dots,A))#(ps,##(dc,10))#(gr,N,0,(#(cl,run,#(cl,r110,A),#(su,N,1))),)))'
#(ss,run,A,N)'

#(ds,L,15)'#(ds,STEPS,10)'#(cl,run,#(cl,seed,#(cl,L)),#(cl,STEPS))'
`,
};

const STORAGE_KEY = "trac-playground.code";
const LAST_EXAMPLE_KEY = "trac-playground.example";

const codeEl = document.getElementById("code");
const outputEl = document.getElementById("output");
const runBtn = document.getElementById("run");
const resetBtn = document.getElementById("reset");
const exampleSel = document.getElementById("examples");
const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.className = isError ? "err" : "";
}

function loadInitial() {
    const savedCode = localStorage.getItem(STORAGE_KEY);
    const savedExample = localStorage.getItem(LAST_EXAMPLE_KEY);
    if (savedExample && EXAMPLES[savedExample]) exampleSel.value = savedExample;
    codeEl.value = savedCode ?? EXAMPLES[exampleSel.value] ?? EXAMPLES.hello;
}

function saveCode() {
    localStorage.setItem(STORAGE_KEY, codeEl.value);
}

function loadExample(name) {
    const src = EXAMPLES[name];
    if (src === undefined) return;
    codeEl.value = src;
    localStorage.setItem(LAST_EXAMPLE_KEY, name);
    saveCode();
}

async function run() {
    const code = codeEl.value;
    const chunks = [];
    const trac = new TRAC(code, (v) => chunks.push(v));
    outputEl.textContent = "";
    setStatus("running…");
    const started = performance.now();
    try {
        await trac.run();
        outputEl.textContent = chunks.join("");
        const ms = (performance.now() - started).toFixed(0);
        setStatus(`done (${ms} ms)`);
    } catch (e) {
        outputEl.textContent = chunks.join("");
        setStatus(e?.message || String(e), true);
    }
}

exampleSel.addEventListener("change", () => loadExample(exampleSel.value));
codeEl.addEventListener("input", saveCode);
runBtn.addEventListener("click", run);
resetBtn.addEventListener("click", () => loadExample(exampleSel.value));
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
    }
});

loadInitial();
