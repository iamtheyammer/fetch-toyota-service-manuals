# fetch-toyota-service-manusls

Downloads PDF versions of Toyota Service Manuals from TIS.

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
   The full URL should be something like `https://techinfo.toyota.com/t3Portal/resources/jsp/siviewer/index.jsp?dir=rm/THIS IS THE CODE&href=xhtml/....`.
8. Save this code for later-- you'll need it!
9. Close the pop-out window, and go back to TIS.
10. Click the `EWD` (electrical wiring diagram) tab.
    The full URL should be something like `https://techinfo.toyota.com/t3Portal/ewdappu/index.jsp?ewdNo=THIS IS THE CODE&model=Prius...`
11. In the URL of the pop-out window, copy the `EM12345`-like code.
12. Save the code for later.
13. If you want diagrams for more cars, repeat those steps for each car.

### Decide if you only want your model year's pages

For non-electrical manuals (IDs that start with RM or BM), this tool supports only downloading pages pertaining to your model year of vehicle.
Some Toyota vehicles, like the 4th generation Prius, have the same manual ID for every single year this generation of the Prius was made.

To avoid downloading pages for a car you don't have, you can specify the model year by putting it after an @-sign.
For example, to download `RM12345` for the `2016` model year, you'd use `-m RM12345@2016`.

There is no harm in doing this for cars that don't support it (the 2015 Prius is an example). The tool will include all pages for manuals that don't support this functionality. There is also no harm in adding a year to other manual types, but it won't do anything.

And, yes, you can specify a year that the car wasn't made in-- but, if you do, the tool will exclude every page.

### Download your manuals!

To download manuals, run `yarn start -e YOUREMAIL -p YOURPASSWORD -m MANUALID -m ANOTHERMANUALID -m ...` with
the manual IDs replaced with yours. You can use `-m` an unlimited number of times.

The script will automatically log in as you, read each manual's Table of Contents, and download every page unless you specify a year-- see [above](#decide-if-you-only-want-your-model-years-pages).

**DO NOT log in to TIS while the bot is downloading.** TIS enforces a one-session-at-a-time policy, and if
you log in while it's downloading you'll have to start over. If you know what you're doing, you can use your browser Cookie to log in instead of your email and password. See [the command-line options](#all-command-line-options) for more info.

**Manuals take a while.** It can take upwards of an hour to download manuals for a single car. If you're downloading multiple manuals, it can take a long time. Be patient. Stay connected to the internet.

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

For non-electrical manuals, you'll see two "toc" (table of contents) files. `toc-full.xml` contains all of the possible pages in the manual. `toc-downloaded.json` contains the _filtered_ version, if you filtered by year (if you didn't filter by year, it contains all pages). This is useful if you want to see what pages are available for your car (xml) or what the bot downloaded (json).

## All command-line options

Run `yarn start --help`, or see below:

```
Toyota/Lexus/Scion Workshop Manual Downloader

  Download the full workshop manual for your car. Must have a valid TIS
  subscription.

Options

  --manual -m RM12345          Required. Manual ID(s) to download. Use multiple times for multiple manuals.
                               For non-electrical manuals, add @YEAR to the end to only download pages for
                               that year.
  --email -e me@example.com    Required. Your TIS email.
  --password -p abc1234        Required. Your TIS password.
  --cookie-string -c abc1234   Your TIS cookie string. If you don't know what this is, don't use it.
  --headed -h                  Run in headed mode (show the emulated browser).
  --help                       Print this usage guide.
```

- To use cookie-based authentication, copy the value of your Cookie header when visiting a manual page. If you're not sure what this is or how to do it, just use the email/password authentication method. When using cookie-based authentication, you don't need to specify an email or password, and your session will be preserved on the browser, so you can use TIS while the bot downloads manuals.
  - If you're on a POSIX system, consider wrapping your cookie string in single quotes to avoid the shell interpreting it.
- Headed mode is not recommended for use. It requires the device you're using to have a display, and it's slower than headless mode.

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
