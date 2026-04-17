# TRAC interpreter (`trac64i`)

[<img src="trac.jpg" alt="TRAC">](trac.jpg)

A TRAC-64 interpreter — the text-processing language invented by Calvin Mooers in 1964 and presented as an etude by Charles Wetherell in [*Etudes for Programmers*](https://dl.acm.org/doi/10.5555/1096892) (1978).

Every TRAC program is a macro expansion over a shared string: function calls are written `#(name,arg1,arg2,…)`, the innermost call is evaluated first, its result is substituted back into the containing string, and the scanner re-reads from that point. Two call modes: `#(…)` rescans the result (active), `##(…)` appends it literally (neutral).

The interpreter is written in TypeScript. It implements the full TRAC-64 primitive set from the book plus two extensions suggested there: forms can be called directly by name (`#(myform,x)` ≡ `#(cl,myform,x)`), and user-defined forms can shadow builtins.

Not implemented: external stream I/O (`ai`, `ao`, `sp`, `rp`) and external block storage (`sb`, `fb`, `eb`). These return `"N/A"`.

All functions are covered by unit tests.

## Install

Globally, as a CLI:

```sh
npm install -g trac64i

trac64i path/to/program.trac
trac64i "@#(ps,hello)'"
trac64i                    # interactive REPL
```

Or run directly from a checkout of this repository — `node` (24+), `bun`, or `deno` can all execute `trac.ts` without a build step.

## Examples

The commands below are run from a checkout of the repository; substitute `trac64i` for `node trac.ts` if you installed the CLI globally.

### "e" constant

```sh
node trac.ts examples/e.trac

2.7182818277
```

### "pi" constant

```sh
node trac.ts examples/pi.trac

3.1415926538
```

### factorial

```sh
node trac.ts examples/factorial.trac

30414093201713378043612608166064768844377641568960512000000000000
```

### Hanoi puzzle solver

```sh
node trac.ts examples/hanoi.trac

from 1 to 3
from 1 to 2
from 3 to 2
from 1 to 3
from 2 to 1
from 2 to 3
from 1 to 3
```

### Rule 110 automaton

```sh
node trac.ts examples/rule_110.trac

...............1...............
..............11...............
.............111...............
............11.1...............
...........11111...............
..........11...1...............
.........111..11...............
........11.1.111...............
.......1111111.1...............
......11.....111...............
.....111....11.1...............
```

### Run code directly

Command-line arguments prefixed with `@` are treated as inline TRAC programs instead of file paths:

```sh
node trac.ts "@#(ps,I am TRAC)'"

I am TRAC
```

### Interactive mode

```sh
node trac.ts

TRAC interpreter (CTRL-C or #(hl)' to exit)

TRAC>
```

## Language reference

Implemented primitives, grouped:

- **Forms** — `ds` (define), `ss` (segment with markers), `cl` (call), `ln` (list names), `da` (delete all), `dd` (delete).
- **Form pointer / segmentation** — `cs` (call segment), `cc` (call character), `cn` (call N chars), `in` (call-in / find), `cr` (call restore, and radix change when arity is 3), `pf` (print form), `sr` (segment-rank).
- **Arithmetic (bigint)** — `ad`, `su`, `ml`, `dv`.
- **Boolean (bit strings)** — `bu` (union), `bi` (intersection), `bc` (complement), `bs` (shift), `br` (rotate).
- **Comparison** — `eq`, `gr`.
- **I/O** — `ps` (print string), `rs` (read string), `rc` (read character).
- **Character / meta** — `cd` (char→decimal codepoint), `dc` (decimal→char), `sl` (string length), `cm` (change meta), `qm` (query meta).
- **Tracing** — `tn` (trace on), `tf` (trace off), `hl` (halt).

See `info/trac.pdf` for Wetherell's etude description and `info/cowan/` for supplementary material.

## Development

```sh
bun install

just test         # run the test suite (81 cases)
just build        # tsc -> dist/
just publish      # patch version + npm publish (maintainer only)
```

## License

MIT — see [LICENSE](LICENSE).
