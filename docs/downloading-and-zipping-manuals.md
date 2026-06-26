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
- **Node.js ≥ 16.3** with `corepack` available, and `git`, `unzip`, and `zip`.

```bash
node -v                # must be >= 16.3
sudo apt-get install -y git unzip zip
```

---

## 2. One-time setup

### 2.1 Get the code and dependencies

This project's lockfile is **Yarn Classic (v1)** format, so the install must use
Yarn 1.x. The `packageManager` field in `package.json` pins `yarn@1.22.22`, so
`corepack` will select it automatically.

```bash
git clone https://github.com/iamtheyammer/fetch-toyota-service-manuals
cd fetch-toyota-service-manuals
corepack enable
yarn install --frozen-lockfile
```

### 2.2 Install the Playwright browser (Chromium)

```bash
yarn playwright install chromium
```

Then install Chromium's system libraries. On **Ubuntu 24.04+** several libraries
were renamed with a `t64` suffix, which the pinned Playwright's bundled list
does not know about. If `playwright install-deps chromium` fails with
`Package 'libasound2' has no installation candidate`, install the renamed set
directly:

```bash
sudo apt-get install -y --no-install-recommends \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 \
  libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 \
  libpango-1.0-0 libwayland-client0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
  libxext6 libxfixes3 libxkbcommon0 libxrandr2 xvfb libfontconfig1 libfreetype6 \
  fonts-liberation fonts-noto-color-emoji fonts-unifont
```

### 2.3 Known issue: incomplete Chromium extraction on newer Node

The pinned Playwright's bundled unzip can silently extract only a few files of
the Chromium archive on Node ≥ 24, leaving the browser broken (the `chrome`
binary missing). Symptom: `browserType.launch: Executable doesn't exist`.

**Fix** — extract the already-downloaded archive with the system `unzip`:

```bash
# The download succeeds; only the extraction is broken. The zip is left in /tmp.
DEST=~/.cache/ms-playwright/chromium-1055
rm -rf "$DEST" && mkdir -p "$DEST"
unzip -q /tmp/playwright-download-chromium-*-1055.zip -d "$DEST"
touch "$DEST/INSTALLATION_COMPLETE"
```

Verify the browser launches:

```bash
node -e "require('playwright').chromium.launch().then(b=>b.close()).then(()=>console.log('OK'))"
```

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
- Do **not** keep extra TIS tabs open that might refresh and create a competing
  session.

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
- The `start` script sets `NODE_TLS_REJECT_UNAUTHORIZED=0` because Node rejects
  Toyota's TLS certificate; this is expected and required.

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

## 6. Verifying completeness

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

### Recommended: tar.xz (smallest)

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
| `Executable doesn't exist` (Chromium) | Incomplete browser extraction on newer Node — see [§2.3](#23-known-issue-incomplete-chromium-extraction-on-newer-node). |
| `Package 'libasound2' has no installation candidate` | Ubuntu 24.04+ `t64` library rename — see [§2.2](#22-install-the-playwright-browser-chromium). |
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
