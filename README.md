# fetch-toyota-service-manuals

Downloads PDF versions of Toyota Service Manuals from TIS.

Bought a 48-hour subscription to Toyota's Service Manuals (Tech Info) and want to save manuals permanently?
Here's the repo for you.

These manuals are copyrighted by Toyota, so don't share them!

(I've also written a Ford manual downloader, available [here](https://github.com/iamtheyammer/fetch-ford-service-manuals)).

> **📘 Full walkthrough:** Toyota's TIS login has changed since this tool was
> written, and this fork adds cookie-based authentication, helper tools to
> extract the session cookie from a HAR (`yarn extract-cookie`), refresh a
> session by logging in through 2FA (`yarn refresh-session`), and auto-discover
> a vehicle's manual codes (`yarn lookup-codes`), plus resume support and an
> archive-packaging step. For a complete, current **setup → authenticate →
> download → archive** guide (with troubleshooting and a compression-format
> comparison), see
> [`docs/downloading-and-zipping-manuals.md`](docs/downloading-and-zipping-manuals.md).

## Quick start

Once you have a TIS session cookie (see
[`docs/downloading-and-zipping-manuals.md`](docs/downloading-and-zipping-manuals.md#3-authentication-important)),
one command downloads everything for a vehicle, verifies it, and packages it:

```bash
export TIS_COOKIE='...'          # or pass --har ~/Downloads/techinfo.har
yarn fetch-vehicle --division LEXUS --model LX600 --year 2024 --bulletins --archive
```

That looks up the vehicle's publication codes itself, downloads every manual
into `manuals/lexus_lx600_2024/`, makes a second pass to pick up any pages that
timed out, fetches the TSBs/bulletins, checks every page against the table of
contents, and writes a `.tar.xz`.

Model strings must match TIS exactly (`LX600`, `FJ Cruiser`). Get one wrong and
the error lists every valid option for that division, so it is one retry rather
than guesswork.

Individual steps remain available: `yarn lookup-codes`, `yarn start`,
`yarn download-documents`, `yarn verify`, `yarn archive`.

## Table of Contents

- [Usage](#usage)
- [Results (what do I get out of this?)](#results)
- [Credits](#credits)
- [FAQ](#faq)

## Usage

### Set up Node and Yarn

If Node.js >=v24 and `yarn` are on your system, skip these steps.

1. Install Node.js 24 or newer-- you can find instructions for your OS on Google.
   Generically, Windows users should install either in WSL or via https://nodejs.org,
   Mac users should install via [Homebrew](https://brew.sh),
   and Linux users should follow instructions online for their distro.
   Node 24+ is required because this tool runs its TypeScript sources directly,
   with no build step.
2. Get Yarn 1.x working. Node bundled `corepack` through version 24, so
   `corepack enable` is enough there. **Node 25 and newer no longer ship
   corepack**-- install it from your distro, or install Yarn straight into a
   user-owned prefix (no root needed):
   `npm install -g --prefix "$HOME/.local" yarn@1.22.22`, with `~/.local/bin`
   on your `PATH`.

### Get code and dependencies

Since this project uses Playwright (a headless browser interop library), we'll need to run some special setup steps.

1. Clone this repository to your system with `git clone https://github.com/iamtheyammer/fetch-toyota-service-manuals`
2. Move into the new folder with `cd fetch-toyota-service-manuals`
3. Run `yarn` to install dependencies according to the lockfile.
4. Run `yarn playwright-setup` to download and set up Playwright (**this is important!**)

> `yarn playwright-setup` also runs `playwright install-deps`, which only
> supports Debian/Ubuntu. On other distributions run `yarn playwright install
> chromium` instead and let your package manager supply Chromium's libraries.

### Development

- `yarn test` runs the offline test suite (Node's built-in test runner; no
  network, browser, or TIS subscription needed).
- `yarn test:browser` runs tests that drive a local page in real Chromium
  (still no network or TIS session). They skip if Chromium isn't installed.
- `yarn typecheck` type-checks with `tsc`. There is no build step-- Node runs
  the TypeScript directly, so `tsc` is only a checker.
- `yarn format` formats with Prettier.

Other commands:

- `yarn verify [--dir manuals/my_car]` checks every downloaded page against its
  table of contents (and EWD figures against their title lists). Exits non-zero
  if anything is missing, so it can gate a script.
- `yarn archive --dir manuals/my_car` packages a vehicle as `.tar.xz`, choosing
  xz settings that fit available memory.

### Get your car's manual IDs

1. If you haven't, purchase a TIS subscription from [here](https://techinfo.toyota.com). The 48 hour subscription is fine.
2. Once purchased, sign in. It can take a minute or two for your login to start working after purchase.
3. Get a session cookie (see [Authentication](#authentication)).
4. Ask the tool:

```bash
yarn lookup-codes --division TOYOTA --model "FJ Cruiser" --year 2008
```

It drives the TIS catalog and prints every publication the vehicle has -- repair
manual, wiring diagrams, body/collision, new car features, wire harness -- each
with the exact `-m` flag to pass to the downloader, and lists standalone
bulletins separately.

Model strings must match TIS exactly, and they are inconsistent between
divisions (`LX600` but `FJ Cruiser`). Get one wrong and the error lists every
valid option for that division, so it takes one retry rather than guesswork.

<details>
<summary>Finding the codes by hand instead</summary>

1. Click the `TIS` tab at the top left of your screen.
2. Select your car's brand (Toyota, Scion, or Lexus), model, and year. Click Search.
3. Click the `RM` (repair manual) tab.
4. Click any document that appears.
5. In the URL of the pop-out window, copy the `RM12345`-like code.
   The full URL should be something like `https://techinfo.toyota.com/t3Portal/resources/jsp/siviewer/index.jsp?dir=rm/THIS IS THE CODE&href=xhtml/....`.
6. Close the pop-out window, and go back to TIS.
7. Click the `EWD` (electrical wiring diagram) tab.
   The full URL should be something like `https://techinfo.toyota.com/t3Portal/ewdappu/index.jsp?ewdNo=THIS IS THE CODE&model=Prius...`
8. Copy the `EM12345`-like code.
9. Repeat for each car you want.

Note that older vehicles split their content across several publications
(transmission, collision, new car features, wire harness) that this procedure
will not surface. `yarn lookup-codes` finds those.

</details>

### Decide if you only want your model year's pages

For non-electrical manuals (IDs that start with RM or BM), this tool supports only downloading pages pertaining to your model year of vehicle.
Some Toyota vehicles, like the 4th generation Prius, have the same manual ID for every single year this generation of the Prius was made.

To avoid downloading pages for a car you don't have, you can specify the model year by putting it after an @-sign.
For example, to download `RM12345` for the `2016` model year, you'd use `-m RM12345@2016`.

There is no harm in doing this for cars that don't support it (the 2015 Prius is an example). The tool will include all pages for manuals that don't support this functionality. There is also no harm in adding a year to other manual types, but it won't do anything.

And, yes, you can specify a year that the car wasn't made in-- but, if you do, the tool will exclude every page.

### Download your manuals!

```bash
export TIS_COOKIE='...'                     # see Authentication, below
yarn start -o manuals/my_car -m RM12345@2016 -m EM12345
```

`-m` may be repeated as many times as you like. The tool reads each manual's
table of contents and downloads every page, unless you specify a year-- see
[above](#decide-if-you-only-want-your-model-years-pages).

**Run it a second time when it finishes.** A handful of pages hit a navigation
timeout on any long run; they're logged and skipped. Re-running the identical
command re-fetches only what's missing, because already-downloaded files are
skipped. (`yarn fetch-vehicle` does this for you.)

**DO NOT log in to TIS while the bot is downloading.** TIS enforces a
one-session-at-a-time policy, and logging in elsewhere invalidates the session
the tool is using. The run aborts cleanly with exit code 2 rather than saving
login pages as manual content; grab a fresh cookie and re-run to resume.

**Manuals take a while.** A full vehicle can take an hour or more. A 2024 Lexus
LX600 came to 5,350 pages / 873 MB across four publications.

Check what you got:

```bash
yarn verify --dir manuals/my_car
```

#### Authentication

**Email/password login no longer works.** TIS replaced its one-shot login with
a multi-step flow (username, password, then a 2FA step), which the tool's
scripted login cannot complete. Your credentials may be perfectly valid-- the
*method* is outdated. The `-e` / `-p` flags remain only for older TIS
deployments.

Use a session cookie instead: log in with your browser, then hand the tool the
cookie your browser is using.

- **Simplest:** open DevTools > Network on a logged-in TIS page, click any
  `techinfo.toyota.com` request, and copy the `Cookie` request header. Then
  `export TIS_COOKIE='...'`.
- **From a HAR:** `yarn extract-cookie ~/Downloads/techinfo.har` prints it, or
  `yarn extract-cookie <har> tis.env` writes an owner-only file to `source`.
  Note that Chrome and Chromium browsers (including Brave) now **strip cookies
  from HAR exports by default**-- if `extract-cookie` reports no `TISESSIONID`,
  that's why. Firefox's export includes them.
- **Scripted:** `yarn refresh-session` drives the real login including the 2FA
  code.

Don't use `document.cookie` in the console: the session cookie is `httpOnly`,
so it won't appear there and you'd get a cookie string that silently lacks it.

**Close the browser once you have the cookie, before starting a download.**
Not log out -- that ends the session you just captured. Just close it.

TIS allows one session per account, and a TIS page left open keeps refreshing
and rotating the session id in the background. The tool goes on presenting the
id you captured, TIS treats that as a second login, and from then on it answers
**HTTP 200 with a "Concurrent Login Alert" page at each requested page's own
URL**. Those render to perfectly valid PDFs, so a run can appear to finish
while the pages are copies of a warning notice. The tool now detects this and
stops, and `yarn verify` finds any already on disk, but closing the browser
avoids it entirely.

The full walkthrough is in
[`docs/downloading-and-zipping-manuals.md`](docs/downloading-and-zipping-manuals.md#3-authentication-important).

### Downloading more than one vehicle

By default every publication is written straight into `manuals/`, so a second
car's manuals sit alongside the first's with nothing to say which car they
belong to. Use `-o` / `--out-dir` to give each vehicle its own folder:

```bash
yarn start -o manuals/toyota_fj_cruiser -m RM12345 -m EM12345
yarn start -o manuals/lexus_lx600_2024  -m RM3900U@2024 -m EM3900U
```

Those land in `manuals/toyota_fj_cruiser/RM12345`, and so on. The default is
unchanged, so existing commands behave exactly as before.

## Results

This bot downloads all manual IDs you specified. It supports manual IDs starting with `RM`, `EM`, and `BM`.

Electrical Wiring Diagrams (manual IDs that start with `EM`) have three directories: `routing`, `overall`, and `system`.

- `overall` contains traditional wiring diagrams (often PDFs)
- `routing` contains diagrams showing wires' locations around the car (often SVGZs)
- `system` contains traditional wiring diagrams (often SVGs) - often, these overlap with `overall`, but not always

Other manuals contain all files from the manual, in a tree-like directory structure that mimics the tree view
on the sidebar of TIS.

For example, if a manual page is at `Engine-Hybrid System -> 1AB-CDE COOLING -> COMPONENTS`, you'll find its
downloaded equivalent at `manuals/MANUALID/Engine-Hybrid System/1AB-CDE COOLING/COMPONENTS.pdf`.

For non-electrical manuals, you'll see two "toc" (table of contents) files. `toc-full.xml` contains all of the possible pages in the manual. `toc-downloaded.json` contains the _filtered_ version, if you filtered by year (if you didn't filter by year, it contains all pages). This is useful if you want to see what pages are available for your car (xml) or what the bot downloaded (json). 

`index.html` and `toc.js` files are for the [Manual Locator](#using-the-manual-locator).

## Using the Manual Locator

Sometimes, a procedure will link to another with a blue "INFO" button.

You can use the Manual Locator HTML page to find the page for that procedure:

1. Open `index.html` in your browser of choice by double-clicking it.
2. Copy the link to TechInfo from the "INFO" button. Often, you can right-click the button to see the link.
   - If you can't, try opening the PDF in Chrome-- drag it into Chrome from your file browser-- then right-click and "Copy Link Address".
3. Paste the link into the Manual Locator.
4. Press "Go" or hit enter.
5. The requested page will open in your browser.

Pages that had a double quote in their name may not work.

This will only work if `index.html` is in the same directory as `toc.js`, and those files must be at the root of your manual directory.
(If you don't move any files after downloading, this should be the case.)

## All command-line options

Run `yarn start --help`, or see below:

```
Toyota/Lexus/Scion Workshop Manual Downloader

  Download the full workshop manual for your car. Must have a valid TIS
  subscription.

Options

  --manual -m RM12345           Required. Manual ID(s) to download. Use
                                multiple times for multiple manuals. For non-
                                electrical manuals, add @YEAR to the end to
                                only download pages for that year.
  --cookie-string -c abc1234    Required. Your TIS session cookie (or set
                                TIS_COOKIE). Copy the Cookie request header
                                from a logged-in TIS page, or use yarn extract-
                                cookie.
  --email -e me@example.com     Legacy, no longer works. TIS replaced its one-
                                shot login with a multi-step flow, so this
                                cannot authenticate. Use --cookie-string.
  --password -p abc1234         Legacy, no longer works. See --email.
  --headed -h                   Run in headed mode (show the emulated browser).
  --out-dir -o manuals/my_car   Directory to download into (default: manuals).
                                Give each vehicle its own folder so multiple
                                cars don't mix together.
  --help                        Print this usage guide.
```

- Cookie authentication is the only method that works against current TIS-- see [Authentication](#authentication). You can also set `TIS_COOKIE` in the environment instead of passing `-c`.
  - If you're on a POSIX system, consider wrapping your cookie string in single quotes to avoid the shell interpreting it.
- Headed mode is not recommended for use. It requires the device you're using to have a display, and it's slower than headless mode.

## Credits

This tool is [Sam Nolan's](https://github.com/iamtheyammer) work
([iamtheyammer/fetch-toyota-service-manuals](https://github.com/iamtheyammer/fetch-toyota-service-manuals));
everything below builds on it.

TIS changed substantially after the original was written, and the fixes came
from several people:

- **[@maburlik](https://github.com/maburlik)** —
  [#26](https://github.com/iamtheyammer/fetch-toyota-service-manuals/pull/26):
  cookie authentication for the current multi-step TIS login, session-expiry
  detection, resume support, legacy PDF manuals, multi-publication older
  vehicles (`atm`/`cr`/`ncf`/`whr`), the `lookup-codes`, `download-documents`,
  `extract-cookie` and `refresh-session` tools, several table-of-contents
  data-loss fixes, and the download/archive guide. The bulk of what makes this
  work against current TIS.
- **[@nchen63](https://github.com/nchen63)** —
  [#13](https://github.com/iamtheyammer/fetch-toyota-service-manuals/pull/13):
  EWD parts. The downloader aborted whenever a part 404'd, which breaks
  vehicles that only publish some parts.
- **[@mrFatDZ](https://github.com/mrFatDZ)** —
  [#9](https://github.com/iamtheyammer/fetch-toyota-service-manuals/pull/9):
  body manuals moved from `bm/` to `cr/`.

Later work in this fork: dependency modernization (ESM, Node-native
TypeScript, current axios/Playwright/tough-cookie), removal of a process-wide
TLS-verification bypass, an offline test suite, per-vehicle output
directories, and the `fetch-vehicle`, `verify` and `archive` commands.

## FAQ

Questions I think someone might ask, not questions anyone has ever asked before.

### Why did Node used to spit out a certificate warning?

Older versions of this tool ran every command with
`NODE_TLS_REJECT_UNAUTHORIZED=0`, which printed:

```
(node:94450) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification.
```

Node didn't accept Toyota's SSL certificate at the time, so it was needed to
stop requests failing. **Toyota's certificate chain validates correctly now**,
so the flag has been removed -- verified against the portal, a repair-manual
table of contents, and the EWD endpoints with verification enabled.

That matters beyond tidiness: the variable disabled certificate verification
*globally* for the process, for every host, while the tool was sending your TIS
session cookie on each request.

If you ever do hit a certificate error, don't reach for that variable -- it
would mean something has changed and is worth reporting as an issue.

### Which vehicles does this work with?

Originally tested on a 2005 / 2015 / 2017 Prius and a 2021 Tacoma.

Since the TIS changes, these have been verified end to end, with every page
checked against its table of contents:

| Vehicle | Publications | Result |
| ------- | ------------ | ------ |
| 2024 Lexus LX600 | RM, EWD, collision, new car features | 5,350 files, 100% |
| 2008 Toyota FJ Cruiser | RM, EWD, collision, new car features, wire harness | 2,096 files, 100% |

The FJ Cruiser also exercises the legacy path, where each page is a thin
wrapper around a real PDF rather than HTML rendered by the browser.

### How do you avoid the one-session-at-a-time requirement when using Playwright _and_ axios?

Long question, short answer-- I copy the cookies from Axios
(which captures them using `axios-cookiejar-support` and `tough-cookie`),
then import them into Playwright when creating the browser session. See [`src/index.ts`](src/index.ts)
to see the cookie-copying code.

Since they're the same cookies, Toyota sees it as the same session.

These days you supply that cookie yourself rather than the tool logging in for you-- see [Authentication](#authentication).

### Why did you make this?

I wanted to have the manual for my car, and I bought the subscription hoping to download a PDF, so that's exactly what I did!

I saw (and took heavy inspiration from) other projects on GitHub, especially [threadproc/tis-rip](https://github.com/threadproc/tis-rip).
However, no other downloader put the manual pages in a tree-like directory structure, `tis-rip` required `chrome-driver`, which can be inconvenient.
This downloader also works fully headlessly, and you're required to manually log in when using `tis-rip`.

### The code doesn't look that great

Yeah, this was a quick weekend project. Feel free to make it better, though!

### Why do you fetch pages one-at-a-time?

Two reasons. Firstly, I don't want to DDoS Toyota. Secondly, it was easier to code synchronously
as the function for fetching and saving pages is recursive, meaning I'd actually have to think to parallelize it.

### Is this the same code as your Ford downloader?

No, but a lot of the code is shared and similar. Unlike Ford, Toyota actually seems to require session cookies
to download manual pages, so getting HTML files with non-embedded images isn't very helpful.
This downloader PDFs every page before saving.
