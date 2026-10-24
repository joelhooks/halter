# halter

halter is a small language for whole email and web campaigns. It describes who enters a campaign, what each send is for, when it goes out, and when someone leaves.

The source of truth is facts, in a Datomic-style log, not a list of jobs to run. halter checks a campaign before it runs and refuses the ones that would hurt someone. One example is a fake deadline. It also shows who got what, and why.

This is a sketch. Every person, product and address in it is made up. The editor is a mock, and no app runs halter in production.

- **The site:** <https://halter.wzrrd.sh/>
- **The language:** [`LANGUAGE.md`](LANGUAGE.md). It's the canonical definition, and the site renders it.

## Run it

It needs Node 24.18 and pnpm 11.3 (`.nvmrc` and `packageManager` pin them).

```sh
pnpm install
pnpm build               # build the site into dist/
pnpm test                # the checks, property tests, editor scenes and stories
pnpm check               # type-check
pnpm smoke               # the built site: links, rat.css pin, fake data, the tracked tree
pnpm layout              # every page at 375px and 1440px in a browser (needs agent-browser)
```

The copy gate and part of smoke need private inputs: `HALTER_SKILLS_SNAPSHOT` (the skills checkout the skill pages are compared against) and `HALTER_DENY_FILE` (private terms, one per line). Without them the build and smoke say what they skipped. `pnpm wzrrd` refuses to publish unless both are set and every check passes.

## Credits

The ideas come from the people listed on the [bibliography](https://halter.wzrrd.sh/bibliography/) page. Each citation is a footnote that points at an original public source. The base stylesheet `site/rat.css` is copied from [rat-stack](https://github.com/joelhooks/rat-stack) under the MIT licence.
