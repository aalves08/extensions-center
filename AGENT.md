# Agent instructions

## Unit tests: do not write them unless asked

**Never add, create or extend unit tests in this project unless I have explicitly
asked you to in that message.** This is not a preference to weigh against other
considerations — it is a hard rule.

This applies to everything test-shaped: new `__tests__` files, new `*.test.ts`
files, new `describe`/`it` blocks in a file that already exists, and extra cases
bolted onto a test I asked you to change for some other reason.

It applies no matter how much the situation seems to call for tests. Writing a
new util, refactoring something risky, noticing an uncovered branch, finishing a
feature, or being part-way through a task where tests look like the natural next
step are all situations where the answer is still no.

### What to do instead

Finish the code. Run `yarn lint` and `yarn typecheck`, and run the existing test
suite to check nothing broke. Then, once the code is actually written and in
front of me, **ask** — something like "want unit tests for this?" — and stop
there.

**Wait for my answer. Do not implement in the same turn.** An unanswered
question is a no.

If I say yes, write them, and verify they have zero lint errors and zero
TypeScript errors before showing me.

## Commands

Node 24 is required. Prefix commands with:

```sh
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
```

| Command | What it does |
| --- | --- |
| `yarn test` | Runs the Jest suite |
| `yarn lint` | ESLint over `.js`, `.ts`, `.vue` — must be free of errors *and* warnings |
| `yarn lint --fix` | Fixes the formatting rules this repo trips over most |
| `yarn typecheck` | `tsc --noEmit` |

Running the test suite is always fine — that is checking existing tests, not
writing new ones.

## Source control

Never commit and never push. Present changes as a diff for me to review.
