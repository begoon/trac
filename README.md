# TRAC interpreter

[<img src="trac.jpg">](trac.jpg)

The repository contains a TRAC interpreter described in the book [Etudes for Programmers](https://dl.acm.org/doi/10.5555/1096892) (1978) by Charles Wetherell.

The interpreter is written in JavaScript and implements what is called the original TRAC-64 definition of the language.

To run the interpreter, you need either `node` (24+), `bun` or `deno`.

The interpreter also implements additional functions and an ability to call forms as functions by name, suggested by Charles Wetherell as an extension of the etude.

All functions are covered by unit tests.

NOTE: However, there are a few unimplemented functions: external stream I/O (`ai`, `ao`, `sp`, `rp`) and external block I/O (`sb`, `fb`, `eb`).

## Examples

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

### Hanoi puzze solver

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

### Run code directly

It is possible to run TRAC programs directly from the command line by prefixing command line arguments with `@`.

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

Then you can type TRAC code interactively.

## Testing

### Prerequisites

- [Bun](https://bun.sh/)

### Run tests

```sh
bun test
```
