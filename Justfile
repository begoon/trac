default: test

test:
    bun test

test-watch:
    bun test --watch

build:
    bunx tsc -p tsconfig.build.json

publish: test build
    npm version patch --no-git-tag-version
    npm publish

clean:
    rm -rf dist

factorial:
    bun trac.ts "@#(ps,50!=)'" examples/factorial.trac

ci: test
