abc:

factorial:
    bun trac.ts "@#(ps,50!=)'" examples/factorial.trac

test-watch:
    bun test --watch

ci:
    bun test
