# GRADE

GRADE helps a cycling instructor plan the music of a class. You import a song. The server finds the
sections of the song. You mark each section as easy, moderate, hard or all out. You put the blocks in
class order. The runner then plays the class and shows the cue for each block.

The plan for the build is in `architecture.md`. The state of the build is in `docs/progress.md`.

## What you need

- Node.js 20 or later
- `pnpm` (install it with `corepack enable` or `npm install -g pnpm`)
- Python 3.11 or later and `uv`
- `ffmpeg` on the `PATH`

## Set up

1. Install the web packages: `pnpm install`
2. Install the server packages: `cd apps/server && uv sync`

## Run the app

Use two terminals.

1. Start the server: `cd apps/server && uv run uvicorn api.app:create_app --factory`
2. Start the web app: `pnpm --filter @grade/web dev`
3. Open the address that Vite prints (usually `http://localhost:5173`).

Vite sends every `/api` request to the server at `127.0.0.1:8000`.

### Run from one address

The server can also serve the built web app. Then you need one process and one address.

1. Build the web app: `pnpm --filter @grade/web build`
2. Start the server: `cd apps/server && uv run uvicorn api.app:create_app --factory --host 0.0.0.0`
3. Open `http://localhost:8000`.

The server serves `apps/web/dist` when the folder exists. Set `GRADE_WEB_DIR` to use another folder.
Run the build again after each change to the web app.

### Use a phone

Start the server as shown above and open its network address on the phone.
The wake lock and the service worker need a secure page. A plain `http://` address on the network is
not secure, so use `https://`, or a tunnel to `localhost`. Without a secure page, the runner shows a
notice that it cannot keep the screen on.

## Settings of the server

The server reads these environment variables.

| Name                    | Meaning                                                           | Default |
| ----------------------- | ----------------------------------------------------------------- | ------- |
| `GRADE_DATA_DIR`        | The folder for stored audio, analyses and the cache.              | `data`  |
| `GRADE_ALLOWED_ORIGINS` | Web addresses that may call the API, separated by commas (CORS).  | none    |
| `GRADE_WEB_DIR`         | The folder of the built web app that the server serves at `/`.    | `apps/web/dist` |
| `GRADE_MAX_ACTIVE_JOBS` | Maximum analysis jobs queued or running; also sets worker count.  | `2`     |

Set `GRADE_ALLOWED_ORIGINS` when the web app and the server use different addresses.
`GRADE_MAX_ACTIVE_JOBS` must be an integer from 1 to 32. The server refuses to start when it is invalid.
Use `1` on a small shared host so a second distinct analysis receives `too_many_jobs`; a repeated
request for the analysis already in progress still returns that job.

## Update yt-dlp

YouTube changes often, so an old yt-dlp fails with the error code `blocked` or `download_failed`.
Run `make update-ytdlp` in `apps/server`. Then restart the server.

## Check the code

Run `bash scripts/ci.sh`. It installs the packages, then runs lint, type checks and all tests.
The tests do not use the network. To test against real YouTube, run `uv run pytest -m live` in
`apps/server`.

## Use the app

- **Library**: lists the programs and class plans. Open **Settings** for the theme and the glitch effect.
- **New program**: paste a YouTube link (one video, 15 minutes or less) or add an audio file.
- **Editor**: tap a section to select it, pick its tier, drag the dividers, and order the blocks.
  Use **Start class** to open the runner.
- **Class plan**: a list of programs that play one after the other.
- **Export**: a program can be saved as a JSON file and imported again.
- **Runner**: shows the cue, the block title and the countdown on the color of the tier.
  It asks the device to keep the screen on.

Each screen has an address in the part after `#`. For example, `#/run/program/<id>` opens the runner.

## Settings of the app

Open **Settings** from the library. The app saves the choices in the browser.

- **Theme**: same as the device, light, or dark.
- **Glitch effect**: plays a short glitch sound before each cut. It works only with the local audio
  player, not with songs that play from YouTube. The default is off.

## How the analyzer makes sections

The analyzer cuts a song where the sound changes (chords, instruments, texture and energy).
It does not cut where the tier changes. The app then gives each section a tier from its mean energy.
The thresholds are `0.28`, `0.44` and `0.62`.

Because of this, two sections next to each other can have the same tier. For example, a verse and a
chorus can sound different but have the same energy. This is not a fault. The app does not join
sections that have the same tier, except in the fallback path, which runs when the analyzer finds
fewer than 2 sections. To join two sections, use the merge button in the block list.

The first program is only a draft. Check the cuts and the tiers, and change them where you want.

## Error messages

The app shows its own text for each error code of the server. The text says what to do next.
The text is in `apps/web/src/app/errors.ts`. A test checks that every code has a text.

| Code                                       | What to do                                                  |
| ------------------------------------------ | ----------------------------------------------------------- |
| `invalid_url`, `unsupported_host`          | Paste the link of one YouTube video, or add an audio file.  |
| `playlist_not_supported`                   | Paste the link of one video, not a playlist.                |
| `too_long`                                 | Use a song of 15 minutes or less.                           |
| `video_unavailable`, `age_restricted`      | Try another link, or add an audio file.                     |
| `blocked`, `download_failed`               | Wait and try again. If it keeps failing, update yt-dlp.     |
| `analysis_failed`, `unsupported_audio`     | Try another file or link.                                   |
| `too_many_jobs`                            | Wait one minute. The server runs at most 2 jobs at a time.  |
| `not_found`                                | Import the song again.                                      |
| `bad_request`, `range_not_satisfiable`     | Reload the page and try again.                              |
| `forbidden`                                | Open the app from the address of the server.                |
| `network_error`                            | Check that the server runs and that the network works.      |
| `bad_response`                             | Update the app and the server together.                     |

## Install on a phone

The app has a manifest and a service worker, so a phone can add it to the home screen.
The service worker keeps the app files only. It never keeps `/api` answers, so audio always comes from
the server. The page must be secure (`https://` or `localhost`).

## Known limits

- **Device checks are open.** No one has run `docs/device-checklist.md` on a real phone. Playback in
  the background (screen locked) is not verified.
- **No one has seen the layout in a real browser** for the editor drag handles and the canvas drawing.
- **Memory:** the app keeps a whole decoded song in memory. A 15-minute song can need about 300 MB.
  A class plan holds up to two songs at once.
- **Audio storage:** the app gets audio from the server in each session. The `audioBlobs` store is not
  used. The server has no size limit or clean-up for stored audio.
- **Offline:** without the server, a song that is not in memory cannot play.
- **Listen mode** (microphone import) is not built.
- **Icon:** the app icon is one SVG. Some phones may not accept it as a home-screen icon.
- **Data:** job state is in memory, so a server restart forgets job numbers. Stored songs stay.
- **Repo:** the git repository has no remote.
- **Test songs** are synthetic. Real tracks with labels would test the analyzer better.

## More documents

- `architecture.md`: the plan and the data model.
- `docs/progress.md`: what is done and what comes next.
- `docs/decisions.md`: small decisions made during the build.
- `docs/device-checklist.md`: the manual checks for a real phone.
