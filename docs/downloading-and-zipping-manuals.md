# Downloading Toyota Service Manuals and Producing a Compressed Archive

A practical, end-to-end guide for downloading the full service-manual set for a
vehicle from Toyota TIS (TechInfo) and packaging it into a single zip archive.

It documents the **cookie/HAR authentication path**, which is the method that
works against the *current* TIS login. The original tool's email/password login
no longer completes (see [Authentication](#3-authentication-important) below).

> ⚠️ **Copyright.** These manuals are copyrighted by Toyota. Download only
> manuals you are entitled to under your own TIS subscription, and do not
> redistribute them.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [One-time setup](#2-one-time-setup)
3. [Authentication (important)](#3-authentication-important)
4. [Finding your manual IDs](#4-finding-your-manual-ids)
5. [Running the download](#5-running-the-download)
6. [Verifying completeness](#6-verifying-completeness)
7. [Producing the output archive](#7-producing-the-output-archive)
8. [Troubleshooting](#8-troubleshooting)
9. [Worked example: 2022 Toyota Highlander](#9-worked-example-2022-toyota-highlander)

---

## 1. Prerequisites

- **A valid TIS subscription** — purchase from <https://techinfo.toyota.com>.
  The 48-hour subscription is sufficient.
- **A Debian-based Linux host** (Ubuntu, etc.). Commands below assume `apt`.
- **Node.js ≥ 24**, plus `git`, `unzip`, and `zip`. The tool runs its
  TypeScript sources directly, which needs Node's unflagged type stripping
  (Node ≥ 23.6); there is no build step.
- **Yarn 1.x** — see [§2.1](#21-get-the-code-and-dependencies).

```bash
node -v                # must be >= 24
sudo apt-get install -y git unzip zip
```

---

## 2. One-time setup

### 2.1 Get the code and dependencies

This project's lockfile is **Yarn Classic (v1)** format, so the install must use
Yarn 1.x. The `packageManager` field in `package.json` pins `yarn@1.22.22`.

Node bundled `corepack` up to version 24, and it selects that pinned Yarn
automatically:

```bash
git clone https://github.com/iamtheyammer/fetch-toyota-service-manuals
cd fetch-toyota-service-manuals
corepack enable
yarn install --frozen-lockfile
```

**Node 25 and newer no longer ship corepack.** Install it from your
distribution (Arch: `pacman -S corepack`; Debian/Ubuntu: `npm i -g corepack`),
or skip corepack and install Yarn 1 directly into a user-owned prefix, which
needs no root:

```bash
npm install -g --prefix "$HOME/.local" yarn@1.22.22   # ~/.local/bin must be on PATH
yarn install --frozen-lockfile
```

### 2.2 Install the Playwright browser (Chromium)

```bash
yarn playwright-setup     # downloads Chromium and its system libraries
```

That runs `playwright install chromium && playwright install-deps chromium`.
Current Playwright knows Ubuntu 24.04's `t64` library names, so the manual
`apt-get` list that older versions needed is no longer required.

`playwright install-deps` only supports Debian/Ubuntu. On other distributions
run just the browser download and let your package manager provide Chromium's
libraries:

```bash
yarn playwright install chromium
```

### 2.3 Verify the browser

```bash
node --input-type=module -e "import {chromium} from 'playwright'; const b = await chromium.launch(); console.log('OK', b.version()); await b.close();"
```

> Older pinned Playwright releases silently extracted only part of the Chromium
> archive on Node ≥ 24, leaving no `chrome` binary and a
> `browserType.launch: Executable doesn't exist` failure that had to be
> unpacked by hand. Current Playwright is unaffected.

---

## 3. Authentication (important)

> **Email/password login no longer works with this tool.** Toyota replaced the
> old one-shot OpenAM login with a multi-step ForgeRock journey
> (username → password → choice → …). The 2022 tool's single header-based login
> cannot complete it, so the portal bounces to the SSO login page and nothing
> downloads. Your credentials may be perfectly valid — the *method* is outdated.

Use the **cookie method** instead. Your browser performs the full login
(including any extra steps / MFA), and you hand the tool the resulting session
cookie. The tool reuses that exact session.

### 3.1 One session at a time

TIS enforces **one active session per account**. While the tool is downloading:

- Do **not** log in to TIS from another tab/device.
- **Close the browser you captured the cookie from before starting a download.**
  Simply leaving a TIS tab open is enough: the portal keeps rotating the
  session id, the tool's browser context goes on presenting the id it captured,
  and TIS treats that as a second login.
- Do not log *out* -- that ends the session you just captured. Close the tab.

This matters more than it sounds. When TIS decides there is a concurrent login
it does not fail the request: it answers **HTTP 200 with a "Concurrent Login
Alert" page at the requested page's own URL**, which renders to a perfectly
valid PDF. A run in that state saves the same warning page over and over while
appearing to succeed -- one real download produced 1,914 of them in a single
manual. The tool now detects this and aborts, and `yarn verify` detects any
already on disk (see [§6](#6-verifying-completeness)).

A concurrent login invalidates the tool's session and you'll see the run abort
(`concurrentLoginFailure.html`). Re-running resumes (see
[§5.3](#53-resume-and-session-expiry)), so this is recoverable, but it wastes
time — keep a single session.

### 3.2 Getting your cookie string

1. Log in to <https://techinfo.toyota.com> in your browser and open any manual
   page so you are fully inside the portal.
2. Open **DevTools → Network**.
3. Reload the page (or click a manual link), then click any request whose domain
   is **`techinfo.toyota.com`**.
4. Under **Request Headers**, copy the entire value of the **`Cookie:`** header.
   It must contain `TISESSIONID=…` (and usually `iPlanetDirectoryPro=…`).

### 3.3 Handing credentials to the tool securely

This fork reads credentials from environment variables, so they never appear in
the process list (`ps`) or shell history:

| Variable       | Purpose                                  |
| -------------- | ---------------------------------------- |
| `TIS_COOKIE`   | Cookie string (recommended)              |
| `TIS_EMAIL`    | TIS email (legacy login — see warning)   |
| `TIS_PASSWORD` | TIS password (legacy login — see warning)|

Store the cookie in a private file rather than typing it on the command line:

```bash
# mktemp creates a fresh owner-only (0600) file; write the cookie into it.
TIS_ENV="$(mktemp)"
printf "TIS_COOKIE='%s'\n" 'PASTE_YOUR_COOKIE_STRING_HERE' > "$TIS_ENV"
set -a; . "$TIS_ENV"; set +a
rm -f "$TIS_ENV"          # the value now lives only in this shell's environment
```

The `-c "<cookie>"` / `-e` / `-p` CLI flags from the upstream tool still work if
you prefer them.

### 3.4 Extracting the cookie from a HAR (`extract-cookie`)

Pulling the `Cookie:` header by hand is fiddly. If you instead export a **HAR**
of a logged-in TIS session (DevTools → Network → right-click → *Save all as
HAR*), the bundled tool extracts the session cookie for you:

```bash
# Print TIS_COOKIE='...' to stdout:
yarn extract-cookie ~/Downloads/techinfo.toyota.com.har

# Or write it to an owner-only (0600) file and source it:
TIS_ENV="$(mktemp -u)"   # a fresh path; the tool creates it 0600 and refuses to overwrite an existing file
yarn extract-cookie ~/Downloads/techinfo.toyota.com.har "$TIS_ENV"
set -a; . "$TIS_ENV"; set +a; rm -f "$TIS_ENV"
```

It errors if the HAR has no `TISESSIONID` (i.e. it isn't a logged-in capture).

### 3.5 Refreshing the session by logging in (`refresh-session`)

If you'd rather not export a HAR, this tool logs in for you and emits a fresh
cookie. Because TIS enforces **two-factor authentication**, it can't be fully
unattended — it triggers a one-time code to your phone/email and prompts you to
type it in:

```bash
export TIS_EMAIL='you@example.com' TIS_PASSWORD='...'
TIS_ENV="$(mktemp -u)"
yarn refresh-session --method text --out "$TIS_ENV"
# -> "Enter the OTP code sent to your device:"  (type the texted code)
set -a; . "$TIS_ENV"; set +a; rm -f "$TIS_ENV"
```

- `--method text|email` chooses where the code is sent (default `text`).
- `--out <file>` writes a `0600` `TIS_COOKIE='...'` file; omit it to print to stdout.
- `--otp-file <path>` reads the code from a file instead of prompting (lets an
  orchestrator drop the code in for automation).
- `--headed` shows the browser (for debugging).

> **Heads-up:** this is a *portal* login, so it rotates the server-side session
> and supersedes any cookie you captured earlier. Use the resulting cookie for
> the run you need it for; running `lookup-codes` afterward will rotate it again.

---

## 4. Finding your manual IDs

The tool downloads explicit manual IDs; it has no "list all manuals for a car"
feature. There are three ID types:

| Prefix | Meaning                          |
| ------ | -------------------------------- |
| `RM…`  | Repair Manual                    |
| `EM…`  | Electrical Wiring Diagram (EWD)  |
| `BM…`  | Body Manual                      |

To find them, while logged in to TIS:

1. Click the **TIS** tab, select your **Brand / Model / Year**, and **Search**.
2. Click the **RM** tab, open any document, and read the `RM…` code from the
   pop-out URL: `…?dir=rm/`**`RM36Q0U`**`&href=…`.
3. Click the **EWD** tab, open any document, and read the `EM…` code:
   `…?ewdNo=`**`EM36Q0U`**`&model=…`.

A typical vehicle has **one RM and one EM** (sometimes a BM).

### Auto-discovering codes (`lookup-codes`)

Instead of clicking through TIS by hand, the bundled tool drives the catalog for
you — it selects the division/model/year, runs the repair search, visits each
document-type tab (EWD, etc.), and prints every code with the exact `-m` flag to
pass to the downloader:

```bash
# Cookie via a logged-in HAR (or set TIS_COOKIE in the environment):
yarn lookup-codes --model RAV4 --year 2020 --har ~/Downloads/techinfo.toyota.com.har
```

```
Codes for TOYOTA RAV4 2020:
  Repair Manual                RM3510U      -m RM3510U@2020
  Wiring Diagram (modern EWD)  EM3510U      -m EM3510U

Download all:
  yarn start -m RM3510U@2020 -m EM3510U
```

Model names with spaces must be quoted (e.g. `--model "RAV4 HV"`); `--division`
defaults to `TOYOTA`. The tool fails fast with a clear message if the session is
expired or has been bumped by a concurrent login (capture a fresh HAR).

### Year filtering

For `RM`/`BM` manuals you can append `@YEAR` to download only pages applicable to
your model year (e.g. `RM36Q0U@2022`). Many Toyota manuals cover a whole
generation, so this trims pages for other years. It is harmless on manuals that
don't support it, and has no effect on `EM` (EWD) IDs.

### Older manuals and the `type:` prefix

Older vehicles (e.g. a 2002 Highlander) use **legacy IDs that don't start with
`RM`/`EM`/`BM`** — such as `OTH021U` (a repair/diagnostic manual) or `EWD470U`
(a wiring diagram served under the generic `ewd/` path rather than the modern
`ewdappu` one). They also tend to **split their service information across
several standalone publications** beyond the repair manual and wiring diagram.
For any ID, give it an explicit **`type:` prefix** so the tool knows how to
fetch it:

| Syntax | Meaning |
| ------ | ------- |
| `rm:OTH021U` | repair manual under the `rm/` path |
| `bm:<id>` | body manual under the `bm/` path |
| `ewd:EWD470U` | older wiring diagram under the `ewd/` path |
| `em:EM36Q0U` | modern EWD (the `ewdappu` format) |
| `atm:RM836U` | automatic-transmission manual under the `atm/` path |
| `cr:BRM103U` | collision/body repair manual under the `cr/` path |
| `ncf:NCF214U` | new car features under the `ncf/` path |
| `whr:RM1022Ea` | wire-harness repair manual under the `whr/` path |

```bash
yarn start -m rm:OTH021U -m ewd:EWD470U -m atm:RM836U \
  -m cr:BRM103U -m ncf:NCF214U -m whr:RM1022Ea
```

`lookup-codes` (above) lists **every** publication a vehicle has, including these
extra ones — always check it so you don't miss the transmission, body, or
wire-harness manuals. Note that some legacy IDs are **case-sensitive** (e.g.
`RM1022Ea` has a lowercase revision suffix); pass them exactly as `lookup-codes`
prints them.

The tool auto-detects whether each manual is the **modern HTML format** (pages
rendered to PDF with Playwright) or the **legacy format** (each page is a thin
xhtml wrapper around a real PDF, downloaded directly over HTTP — no browser),
and handles both. IDs that already start with `RM`/`EM`/`BM` don't need a
prefix.

### TSBs, recalls, and other bulletins (`download-documents`)

`lookup-codes` also surfaces a vehicle's **standalone documents** — Service
Bulletins (TSBs), recall/campaign info (`crib`), diagnostic analysis info
(`ai`), Quick Training Guides (`qtg`), and more. These are **not** multi-page
manuals (they have no ToC); each is a single PDF. The main `yarn start`
downloader only handles manuals, so fetch these with the dedicated tool:

```bash
# Downloads every standalone document for the vehicle into
# ./manuals/_documents/<objType>/<publicationNumber>.pdf
yarn download-documents --model Highlander --year 2002
# (reads TIS_COOKIE from the environment, or pass --har <path>)
```

It reuses the same catalog lookup, automatically **skips** the multi-page manual
publications (download those with `yarn start`), and reports
`saved/skipped/no-pdf/failed` counts. Re-running is safe — already-downloaded
PDFs are skipped.

---

## 5. Running the download

### 5.1 The command

With `TIS_COOKIE` exported (see [§3.3](#33-handing-credentials-to-the-tool-securely)):

```bash
yarn start -m RM36Q0U@2022 -m EM36Q0U
```

- `-m` may be repeated for multiple manuals.
- TLS verification is on. Earlier versions ran with
  `NODE_TLS_REJECT_UNAUTHORIZED=0` because Node rejected Toyota's certificate;
  the chain validates correctly now, so that (process-wide, all-hosts) bypass
  has been removed.

For a long, unattended run, log to a file and run it detached:

```bash
nohup yarn start -m RM36Q0U@2022 -m EM36Q0U > download.log 2>&1 &
```

### 5.2 What you get

Output is written under `manuals/<raw-id>/` (the raw id includes any `@YEAR`):

```
manuals/
├── RM36Q0U@2022/                 # repair manual
│   ├── <tree of folders>/*.pdf   # one PDF per manual page, mirroring the TIS sidebar
│   ├── toc-full.xml              # every available page
│   ├── toc-downloaded.json       # the (year-filtered) set actually downloaded
│   ├── toc.js                    # data for the Manual Locator
│   └── index.html                # Manual Locator (open in a browser)
└── EM36Q0U/                      # wiring diagrams
    ├── system/  (svgz/pdf + title.xml/json)
    ├── routing/ (svgz/pdf + title.xml/json)
    └── overall/ (pdf + title.xml/json)
```

Pages are fetched one at a time (to avoid hammering TIS), so a full repair manual
of several thousand pages can take **a few hours**. The EWD downloads first and
is comparatively quick.

### 5.3 Resume and session expiry

This fork adds two robustness behaviors for large runs:

- **Resume (skip-existing).** Re-running the *same* command skips any page whose
  output file already exists, so an interrupted run continues where it left off
  instead of starting over.
- **Session-expiry detection.** If the session stops being valid mid-run, TIS
  returns HTTP 200 with a login page rather than an error. The tool detects this
  and **aborts cleanly with exit code `2`** instead of silently saving login
  pages as "manual" content. Grab a fresh cookie and re-run; resume picks up the
  remaining files.

A handful of individual pages may hit a 30 s navigation timeout; these are logged
(`Error saving page …`) and skipped. Simply re-run the same command once at the
end — resume re-fetches only those missing pages.

---

### 5.4 Downloading more than one vehicle

Everything lands in `manuals/` by default, which mixes publications together
once you download a second car. `-o` / `--out-dir` gives each vehicle its own
folder:

```bash
yarn start -o manuals/toyota_fj_cruiser -m RM12345 -m EM12345
```

The verification and archive steps below then operate on that per-vehicle
directory rather than on `manuals/` as a whole.

---

## 6. Verifying completeness

Use the built-in checker, which walks every publication under a directory,
compares it against its own table of contents (and EWD figures against their
title lists), and flags both missing pages and files too small to be real:

```bash
yarn verify --dir manuals/lexus_lx600_2024
```

It exits non-zero when anything is missing, so it can gate an archive step.

It also looks for saved **interstitials** -- copies of TIS's "Concurrent Login
Alert" that were rendered to PDF instead of real pages. These pass every
existence and size check, so they are found by a different route: every copy
renders to an identical byte size, and genuine manual pages vary. Any group of
20 or more identically sized pages is reported, then confirmed by reading the
text with `pdftotext` (from poppler-utils) where available, so real content is
never mistaken for an error page.

To clear confirmed ones and refetch them:

```bash
yarn verify --dir manuals/my_car --delete-interstitials
yarn start -o manuals/my_car -m ...     # resume refetches only what is missing
```

Only content-confirmed files are deleted; a size coincidence alone is never
enough.

<details>
<summary>Equivalent by hand</summary>

Confirm every page in the (filtered) table of contents has a corresponding file:

```bash
node -e '
const fs=require("fs"), path=require("path");
const base=process.argv[1];
const toc=JSON.parse(fs.readFileSync(base+"/toc-downloaded.json","utf8"));
let leaves=0; const missing=[];
(function walk(o,dir){for(const[k,v] of Object.entries(o)){const n=k.replace(/\//g,"-");
  if(typeof v==="string"){leaves++;const fp=path.join(dir,n+".pdf");if(!fs.existsSync(fp))missing.push(fp);}
  else walk(v,path.join(dir,n));}})(toc,base);
console.log("toc leaves:",leaves,"| present:",leaves-missing.length,"| missing:",missing.length);
missing.forEach(m=>console.log("  MISSING:",m));
' "manuals/RM36Q0U@2022"
```

Also sanity-check that no file is a tiny login-page stub:

```bash
find manuals -type f ! -name index.html ! -name 'toc*' ! -name 'title.*' -size -512c
# (no output = good)
```

</details>

---

## 7. Producing the output archive

Package the manuals into a single archive whose **name has no spaces and
includes the vehicle**.

### Which format? Pick the smallest

The set is dominated by repair-manual PDFs. These are Chromium-generated and
contain a lot of weakly-compressed text, so a strong compressor helps a lot.
Measured on this corpus (~1.3 GB on disk):

| Format | Compressor | Size | Notes |
| ------ | ---------- | ---- | ----- |
| `.tar.gz` | `gzip -9` | ~831 MB | Most portable; weakest ratio |
| `.zip` | `zip -1` | ~855 MB | Convenient on Windows; weak ratio |
| **`.tar.xz`** | **`xz -9e`** | **~587 MB** | **Smallest (~31% smaller than zip/gzip)** |
| `.tar.zst` | `zstd --ultra -22` | ~600 MB | Nearly as small as xz, faster |

**Use `tar.xz` for the smallest footprint.** `xz -9e -T0` parallelizes across
all cores; on a 24-core host the full set compresses in ~5 minutes.

### Recommended: `yarn archive`

```bash
yarn archive --dir manuals/lexus_lx600_2024 --out ~/Documents/2024_Lexus_LX600.tar.xz
```

It streams the directory through xz, names the archive's top-level folder after
the vehicle, and verifies the result with `xz -t`.

Compression settings are chosen from free memory rather than hard-coded:
`xz -9e -T0` wants roughly 700 MB per thread, so on a many-core machine it
reaches for several gigabytes and will thrash or be OOM-killed on a busy
desktop. Manual pages are already-compressed PDFs, so the stronger preset saves
very little -- a real 873 MB vehicle packed to 612 MB at preset 6.

<details>
<summary>Equivalent by hand</summary>

### tar.xz (smallest)

`tar --transform` rewrites the stored top-level path, so no directory renaming is
needed:

```bash
cd fetch-toyota-service-manuals

NAME=2022_Toyota_Highlander_Service_Manuals
OUT="$HOME/Documents/$NAME.tar.xz"

tar -cf - --transform="s,^manuals,$NAME," manuals | xz -9e -T0 -c > "$OUT"

ls -lh "$OUT"
```

Verify integrity and that every file is present:

```bash
xz -t "$OUT" && echo "tar.xz OK"
echo "archive: $(tar -tJf "$OUT" | grep -vc '/$')   disk: $(find manuals -type f | wc -l)"
tar -tJf "$OUT" | head -1            # -> 2022_Toyota_Highlander_Service_Manuals/
```

</details>

### Alternatives

```bash
# tar.gz (most portable; parallel gzip)
tar -cf - --transform="s,^manuals,$NAME," manuals | pigz -9 > "$HOME/Documents/$NAME.tar.gz"

# zip (Windows-friendly; -1 because the PDFs barely deflate)
( cd manuals && zip -r -1 -q "$HOME/Documents/$NAME.zip" . )   # note: no wrapper folder
```

The archive contains a single descriptive top-level folder:

```
2022_Toyota_Highlander_Service_Manuals/
├── RM36Q0U@2022/
└── EM36Q0U/
```

---

## 8. Troubleshooting

| Symptom | Cause / Fix |
| ------- | ----------- |
| `Doesn't appear we're logged into TIS … custom-login-response` | Email/password login is dead on current TIS. Use the cookie method ([§3](#3-authentication-important)). |
| `… concurrentLoginFailure.html` | Another TIS session is active. Close other TIS tabs/devices, grab a fresh cookie, and re-run (resume continues). |
| Exit code `2`, "TIS session appears to have expired" | The cookie timed out mid-run. Capture a fresh cookie and re-run the same command; resume re-fetches only what's missing. |
| `Executable doesn't exist` (Chromium) | The browser was never downloaded — run `yarn playwright-setup` ([§2.2](#22-install-the-playwright-browser-chromium)). |
| A few `Error saving page …: TimeoutError` lines | Transient per-page timeouts. Re-run the same command once; resume grabs the missing pages. |
| `Manual … doesn't appear to exist` | Wrong ID, or the cookie isn't authenticating. Re-check the `RM…`/`EM…` code and that `TIS_COOKIE` contains a valid `TISESSIONID`. |

---

## 9. Worked example: 2022 Toyota Highlander

IDs: `RM36Q0U` (repair manual), `EM36Q0U` (wiring diagrams).

```bash
# 1. Authenticate (cookie captured from the browser per §3.2)
TIS_ENV="$(mktemp)"
printf "TIS_COOKIE='%s'\n" 'PASTE_COOKIE_HERE' > "$TIS_ENV"
set -a; . "$TIS_ENV"; set +a; rm -f "$TIS_ENV"

# 2. Download (repair manual filtered to 2022 + full wiring diagrams)
nohup yarn start -m RM36Q0U@2022 -m EM36Q0U > download.log 2>&1 &

# 3. When finished, re-run once to catch any timed-out pages (resume is automatic)
yarn start -m RM36Q0U@2022 -m EM36Q0U

# 4. Package as the smallest archive (tar.xz)
NAME=2022_Toyota_Highlander_Service_Manuals
OUT="$HOME/Documents/$NAME.tar.xz"
tar -cf - --transform="s,^manuals,$NAME," manuals | xz -9e -T0 -c > "$OUT"
xz -t "$OUT" && echo "tar.xz OK ($(du -h "$OUT" | cut -f1))"
```

Result: a verified `2022_Toyota_Highlander_Service_Manuals.tar.xz` (~587 MB)
containing the full repair manual (year-filtered to 2022) and the complete
electrical wiring diagram set.
