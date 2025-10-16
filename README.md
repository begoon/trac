# TRAC interpreter

[<img src="trac.jpg">](trac.jpg)

The repository contains a TRAC interpreter described in the book [Etudes for Programmers](https://dl.acm.org/doi/10.5555/1096892) (1978) by Charles Wetherell.

The interpreter is written in JavaScript and implements what is called the original TRAC-64 definition of the languages.

The interpreter also implements additional functions and an ability to call forms as functions by name, suggested by Charles Wetherell as an extension of the etude.

All functions are covered unit tests.

NOTE: However, there are a few unimplemented functions: external stream I/O (`ai`, `ao`, `sp`, `rp`) and external block I/O (`sb`, `fb`, `eb`).

## Examples

### calculate "e" constant

```sh
node trac.ts examples/e.trac
```

### Calculate "pi"

```sh
node trac.ts examples/pi.trac
```

### Calculate factorial (of `50!`)

```sh
node trac.ts examples/factorial.trac
```

### Solve Hanoi puzze recursively

```sh
node trac.ts examples/hanoi.trac
```

## Testing

### Prerequisites

- bun.sh

### Run tests

```sh
bun test
```
