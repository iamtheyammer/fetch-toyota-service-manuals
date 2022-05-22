# fetch-toyota-service-manusls
 Downloads HTML and PDF versions of Toyota Service Manuals from TIS.

Bought a 48-hour subscription to Toyota's Service Manuals (Tech Info) and want to save manuals permanently?
Here's the repo for you.

These manuals are copyrighted by Toyota, so don't share them!

(I've also written a Ford manual downloader, available [here](https://github.com/iamtheyammer/fetch-ford-service-manuals)).

## Table of Contents

- [Usage](#usage)
- [Results (what do I get out of this?)](#results)
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
The full URL should be something like `https://techinfo.toyota.com/t3Portal/document/rm/THIS IS THE CODE/...`.
8. Save this code for later-- you'll need it!
9. Close the pop-out window, and go back to TIS.
10. Click the `EWD` (electrical wiring diagram) tab.
11. In the URL of the pop-out window, copy the `EM12345`-like code.
12. Save the code for later.
13. If you want diagrams for more cars, repeat those steps for each car.

### Download your manuals!

To download manuals, run `yarn start -e YOUREMAIL -p YOURPASSWORD -m MANUALID -m ANOTHERMANUALID -m ...` with
the manual IDs replaced with yours. You can use `-m` an unlimited number of times.

The script will automatically log in as you, read each manual's Table of Contents, and download every page.

**DO NOT log in to TIS while the bot is downloading.** TIS enforces a one-session-at-a-time policy, and if
you log in while it's downloading you'll have to start over.

You can find your downloaded manuals at `manuals/MANUALID`.

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
The script automatically removes the `YEAR MY MODEL [00/0000 -      ]` text from the end of page names.

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
- 2021 Tacoma

All worked flawlessly!

### How do you avoid the one-session-at-a-time requirement when using Playwright _and_ axios?

Long question, short answer-- I copy the cookies from Axios
(which captures them using `axios-cookiejar-support` and `tough-cookie`),
then import them into Playwright when creating the browser session. See [`src/index.ts`](src/index.ts)
to see the cookie-copying code.

Since they're the same cookies, Toyota sees it as the same session.

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
