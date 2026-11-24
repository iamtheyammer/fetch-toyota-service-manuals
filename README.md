# fetch-toyota-service-manuals

Downloads PDF versions of Toyota Service Manuals from TIS.

Bought a 48-hour subscription to Toyota's Service Manuals (Tech Info) and want to save manuals permanently?
Here's the repo for you.

These manuals are copyrighted by Toyota, so don't share them!

(I've also written a Ford manual downloader, available [here](https://github.com/iamtheyammer/fetch-ford-service-manuals)).

> **This is a patched fork.** It adds cookie-based login for TIS's new MFA, `CR` manual support, a
> `type/id` path override, Windows-safe filenames, and resumable downloads. See
> [Changes in this fork](#changes-in-this-fork) for the full list.

## Table of Contents

- [Usage](#usage)
- [Results (what do I get out of this?)](#results)
- [Changes in this fork](#changes-in-this-fork)
- [FAQ](#faq)

## Usage

### Set up Node and Yarn

If Node.js >v16.3 and `yarn` are on your system, skip these steps.

1. Install Node.js 16.3 or newer (with corepack)-- you can find instructions for your OS on Google.
   Generically, Windows users should install either in WSL or via https://nodejs.org,
   Mac users should install via [Homebrew](https://brew.sh),
   and Linux users should follow instructions online for their distro.
2. Run `corepack enable`-- this gets Yarn working.

### Get code and dependencies

Since this project uses Playwright (a headless browser interop library), we'll need to run some special setup steps.

1. Clone this repository to your system with `git clone https://github.com/iamtheyammer/fetch-toyota-service-manuals`
2. Move into the new folder with `cd fetch-toyota-service-manuals`
3. Run `yarn` to install dependencies according to the lockfile.
4. Run `yarn playwright-setup` to download and set up Playwright (**this is important!**)

### Get your car's manual IDs

1. If you haven't, purchase a TIS subscription from [here](https://techinfo.toyota.com). The 48 hour subscription is fine.
2. Once purchased, sign in. It can take a minute or two for your login to start working after purchase.
3. Click the `TIS` tab at the top left of your screen.
4. Select your car's brand (Toyota, Scion, or Lexus), model, and year. Click Search.
5. Click the `RM` (repair manual) tab.
6. Click any document that appears.
7. In the URL of the pop-out window, copy the `RM12345`-like code.
   The full URL should be something like `https://techinfo.toyota.com/t3Portal/resources/jsp/siviewer/index.jsp?dir=rm/THIS IS THE CODE&href=xhtml/....`.
8. Save this code for later-- you'll need it!
9. Close the pop-out window, and go back to TIS.
10. Click the `EWD` (electrical wiring diagram) tab.
    The full URL should be something like `https://techinfo.toyota.com/t3Portal/ewdappu/index.jsp?ewdNo=THIS IS THE CODE&model=Prius...`
11. In the URL of the pop-out window, copy the `EM12345`-like code.
12. Save the code for later.
13. If you want diagrams for more cars, repeat those steps for each car.

### Decide if you only want your model year's pages

For non-electrical manuals (IDs that start with RM, BM, or CR), this tool supports only downloading pages pertaining to your model year of vehicle.
Some Toyota vehicles, like the 4th generation Prius, have the same manual ID for every single year this generation of the Prius was made.

To avoid downloading pages for a car you don't have, you can specify the model year by putting it after an @-sign.
For example, to download `RM12345` for the `2016` model year, you'd use `-m RM12345@2016`.

There is no harm in doing this for cars that don't support it (the 2015 Prius is an example). The tool will include all pages for manuals that don't support this functionality. There is also no harm in adding a year to other manual types, but it won't do anything.

And, yes, you can specify a year that the car wasn't made in-- but, if you do, the tool will exclude every page.

### Logging in (cookie method)

> **Heads up:** as of **August 2025, TIS requires multi-factor authentication (MFA)**. The tool's
> automated email/password login (`-e`/`-p`) can't complete the one-time-passcode step, so it fails with
> `Doesn't appear we're logged into TIS`. Log in with the **cookie method** below instead.

You log in through your own browser (completing MFA there), then hand the tool your already-authenticated
session via the `-c` option, so it never has to log in itself.

1. In your browser, go to <https://techinfo.toyota.com> and sign in, completing the MFA prompt.
2. Open an actual manual page so you're on a `techinfo.toyota.com` page.
3. Open developer tools (**F12**) and select the **Network** tab.
4. Click any request to `techinfo.toyota.com` whose **Size** is a real value (not `(memory cache)` /
   `(disk cache)`).
5. In the **Headers** tab, scroll to **Request Headers**, find the **`Cookie`** line, and copy its entire
   value. Copying the full `Cookie:` header is more reliable than the console `document.cookie` trick,
   because it includes the HttpOnly session cookie (`iPlanetDirectoryPro`) that the tool needs.
6. Pass that whole string to `-c`, wrapped in single quotes — see [Download your manuals!](#download-your-manuals) below.

Your TIS session cookie is good for roughly a day. **Treat it like a password.** Because it's your browser
session, you can keep using TIS in that browser, but don't sign in to TIS a second time elsewhere while the
bot is running (TIS allows only one session at a time).

### Download your manuals!

Run the tool with your cookie string (from [Logging in](#logging-in-cookie-method)) and one or more manual
IDs. You can use `-m` an unlimited number of times.

**macOS / Linux:**

```
yarn start -c 'YOUR_COOKIE_STRING' -m MANUALID -m ANOTHERMANUALID -m ...
```

**Windows (PowerShell)** — the `yarn start` script uses Unix-style inline environment variables that
PowerShell doesn't understand, so set the variable first and run `ts-node` directly:

```
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"; yarn ts-node src/index.ts -c 'YOUR_COOKIE_STRING' -m MANUALID -m ...
```

The script will read each manual's Table of Contents and download every page unless you specify a year-- see [above](#decide-if-you-only-want-your-model-years-pages).

**DO NOT log in to TIS while the bot is downloading.** TIS enforces a one-session-at-a-time policy, and if
you log in while it's downloading you'll have to start over. If you know what you're doing, you can use your browser Cookie to log in instead of your email and password. See [the command-line options](#all-command-line-options) for more info.

**Manuals take a while.** It can take upwards of an hour to download manuals for a single car. If you're downloading multiple manuals, it can take a long time. Be patient. Stay connected to the internet.

**Re-running is safe and resumable.** The tool skips any page it has already saved, so if a download is
interrupted, your cookie expires partway through, or some pages error out, just run the exact same command
again (with a fresh cookie if needed) and it will fetch only the pages that are still missing.

You can find your downloaded manuals at `manuals/MANUALID`.

## Results

This bot downloads all manual IDs you specified. It supports manual IDs starting with `RM`, `EM`, `BM`, and `CR` (`CR` is Toyota's newer prefix for body/collision repair manuals, handled the same way as `BM`).

Electrical Wiring Diagrams (manual IDs that start with `EM`) have three directories: `routing`, `overall`, and `system`.

- `overall` contains traditional wiring diagrams (often PDFs)
- `routing` contains diagrams showing wires' locations around the car (often SVGZs)
- `system` contains traditional wiring diagrams (often SVGs) - often, these overlap with `overall`, but not always

Other manuals contain all files from the manual, in a tree-like directory structure that mimics the tree view
on the sidebar of TIS.

For example, if a manual page is at `Engine-Hybrid System -> 1AB-CDE COOLING -> COMPONENTS`, you'll find its
downloaded equivalent at `manuals/MANUALID/Engine-Hybrid System/1AB-CDE COOLING/COMPONENTS.pdf`.

For non-electrical manuals, you'll see two "toc" (table of contents) files. `toc-full.xml` contains all of the possible pages in the manual. `toc-downloaded.json` contains the _filtered_ version, if you filtered by year (if you didn't filter by year, it contains all pages). This is useful if you want to see what pages are available for your car (xml) or what the bot downloaded (json). 

Each manual folder also gets an `index.html` — the [offline manual browser](#offline-manual-browser) — along
with `search-index.js` (the extracted full-text search data it loads) and `.search-cache.json` (a cache that
makes `yarn build-index` re-runs fast). `toc.js` is also written, for reference.

## Offline manual browser

Every download produces a self-contained `index.html` at the root of each manual folder — a two-pane
**offline** browser (no internet, no server). Just **double-click it** to open it in your browser:

- **Left:** the manual's full section tree (collapsible), plus a **search box that searches the text
  _inside_ the documents** (not just page names). Matching pages are listed with a snippet of the hit;
  click one to open it.
- **Right:** click any page and its PDF — or, for wiring diagrams, the SVG — opens right there. There's an
  "open in new tab" link too.

There's also a master `manuals/index.html` that links every manual you've downloaded, so you can jump
between cars from one page.

The pages are generated from the data on disk, so links always point at the real files — including pages
whose names contain quotes or slashes. Electrical wiring diagrams are stored as SVGZ, which browsers won't
render straight from a local file, so the generator writes a plain `.svg` copy next to each one.

**In-document search** works by extracting each PDF's text at build time into a `search-index.js` next to
the browser (loaded locally, still no internet). The first build of a large manual takes a few minutes
while it reads every PDF; the text is cached (`.search-cache.json`), so later `yarn build-index` runs only
re-read new or changed pages. Wiring diagrams (SVG) are searchable by title only, not by their internal
text.

### Rebuilding the browser (e.g. for older downloads)

If you downloaded manuals before this feature existed, or just want to regenerate the pages, run:

```
yarn build-index
```

It scans your `manuals/` folder and regenerates every `index.html` (and the master index) with no cookie or
internet needed. It also reports any page listed in a manual's table of contents that isn't on disk (for
example, a page that errored out mid-download) — re-run that manual's download to fetch the few that are
missing.

## All command-line options

Run `yarn start --help`, or see below:

```
Toyota/Lexus/Scion Workshop Manual Downloader

  Download the full workshop manual for your car. Must have a valid TIS
  subscription.

Options

  --manual -m RM12345          Required. Manual ID(s) to download. Use multiple times for multiple manuals.
                               For non-electrical manuals, add @YEAR to the end to only download pages for
                               that year. If a manual's TIS URL uses a directory that doesn't match its ID
                               prefix (e.g. dir=cr/BM3150U), pass it as type/id, e.g. cr/BM3150U.
  --email -e me@example.com    Required. Your TIS email.
  --password -p abc1234        Required. Your TIS password.
  --cookie-string -c abc1234   Your TIS cookie string. If you don't know what this is, don't use it.
  --headed -h                  Run in headed mode (show the emulated browser).
  --help                       Print this usage guide.
```

- **If you get `Manual <ID> doesn't appear to exist` but you can clearly see the document on TIS:** the publication's ID prefix probably doesn't match the directory Toyota serves it from. Open the document on TIS and look at its URL -- the `dir=` segment is the real path, e.g. `dir=cr/BM3150U` (a `BM`-numbered body manual that actually lives under `cr`). Pass that whole thing to `-m` as `type/id`, e.g. `-m cr/BM3150U@2016`. The part before the `/` becomes the directory the tool fetches, overriding the prefix-based default.
- To use cookie-based authentication, copy the value of your Cookie header when visiting a manual page (step-by-step in [Logging in](#logging-in-cookie-method)). **Because TIS now requires MFA, this is the method that works** -- the email/password method can no longer log in. When using cookie-based authentication, you don't need to specify an email or password, and your session is preserved in the browser, so you can keep using TIS while the bot downloads manuals.
  - If you're on a POSIX system, consider wrapping your cookie string in single quotes to avoid the shell interpreting it.
- Headed mode is not recommended for use. It requires the device you're using to have a display, and it's slower than headless mode.

## Changes in this fork

This fork keeps the original tool working against today's TIS and fixes cross-platform issues. Changes
versus [upstream](https://github.com/iamtheyammer/fetch-toyota-service-manuals):

- **Cookie login for TIS's MFA.** As of August 2025, TIS requires multi-factor authentication, so the
  automated email/password login (`-e`/`-p`) can no longer complete sign-in (it fails with
  `Doesn't appear we're logged into TIS`). Log in through your browser and hand the tool your session via
  `-c` instead — see [Logging in (cookie method)](#logging-in-cookie-method). _(Documentation only; the `-c`
  option already existed.)_
- **`CR` manual support.** Added `CR` — Toyota's newer prefix for body/collision-repair manuals — alongside
  `RM`/`EM`/`BM`. It's downloaded the same way as other non-electrical manuals. _(`src/index.ts`)_
- **`type/id` path override.** Toyota sometimes serves a publication from a directory that doesn't match its
  ID's prefix — for example `BM3150U` lives under `cr`, shown as `dir=cr/BM3150U` in the TIS URL. You can now
  pass `-m cr/BM3150U` (optionally `-m cr/BM3150U@2016`) to set the directory explicitly; the part before the
  `/` becomes the fetch path. Plain prefix IDs are unchanged. _(`src/index.ts`, `src/processCLIArgs.ts`)_
- **Windows-safe filenames.** Page names containing characters Windows forbids in filenames
  (`< > : " \ | ? *` and control characters) now have them replaced with `-`. Previously the tool only
  stripped `/`, so pages like `Camshaft Position "A" Actuator Circuit` silently failed to save on Windows.
  The same rule is used by the offline browser generator when it builds links.
  _(`src/sanitizeFilename.ts`, `src/genericManual/index.ts`, `src/ewd/index.ts`, `src/buildIndex/`)_
- **Resumable downloads.** Each run skips pages already present on disk, so an interrupted or partially
  failed download can be completed by re-running the same command — only the missing pages are fetched.
  _(`src/genericManual/index.ts`, `src/ewd/index.ts`)_
- **Offline manual browser with full-text search.** Each download now generates a self-contained, two-pane
  [offline browser](#offline-manual-browser) (`index.html`) per manual — a section tree plus a search box
  that searches the **text inside the PDFs** (not just page names) on the left, the selected PDF/diagram on
  the right — plus a master `manuals/index.html` linking them all. It replaces the old URL-based Manual
  Locator (which needed a live TIS link, defeating offline use). The search index is built by extracting PDF
  text at build time (cached for fast rebuilds) into a local `search-index.js`. Regenerate for existing
  downloads with `yarn build-index`. Wiring-diagram SVGZ files are written out as `.svg` so they render from
  `file://`. _(`src/buildIndex/`, `src/index.ts`, adds the `pdf-parse` dependency, replaces `accessor/`)_

## FAQ

Questions I think someone might ask, not questions anyone has ever asked before.

### Why does Node spit out a certificate warning?

You might see a warning like the following print out after `Logging into TIS...`:

```
(node:94450) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification.
(Use `node --trace-warnings ...` to show where the warning was created)
```

Node.js doesn't seem to accept Toyota's SSL certificate, so this is required to stop Axios
(which is used for login and downloading EWDs) from failing every request.

### Which vehicles does this work with?

All the ones I've tested. Just for fun, I tried:

- 2005 Prius
- 2015 Prius
- 2017 Prius
- 2021 Tacoma

All worked flawlessly!

### How do you avoid the one-session-at-a-time requirement when using Playwright _and_ axios?

Long question, short answer-- I copy the cookies from Axios
(which captures them using `axios-cookiejar-support` and `tough-cookie`),
then import them into Playwright when creating the browser session. See [`src/index.ts`](src/index.ts)
to see the cookie-copying code.

Since they're the same cookies, Toyota sees it as the same session.

You can use your browser's Cookie header to log in instead of your email and password, but only do that if you know what that means. See [the command-line options](#all-command-line-options) for more info.

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
