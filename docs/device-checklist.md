# Device checklist

Run each item on a real phone. Record the result, the device, and the date.
Status values: `not tested`, `passed`, `known issue` (add a note).

M8 status: no item was run. The build had no real phone (2026-10-22). The M8 acceptance rule ("every item is passed or a known issue") is **not met** until someone runs the table below.

Build to test: M7 class runner. Open `#/run/program/<id>` or `#/run/plan/<id>` on the phone.
Run the server and the web app on the same network, or use a built copy.

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | 45-minute class with the screen locked. Audio keeps playing and cuts stay on time. | not tested | |
| 2 | Incoming call during class. After the call, `resync()` brings audio back to the schedule. | not tested | |
| 3 | Switch to another app and return. Class time and audio agree after return. | not tested | |
| 4 | Connect and disconnect a Bluetooth speaker during class. | not tested | |
| 5 | Low-power mode on. Timers and audio still keep the schedule. | not tested | |
| 6 | `AudioContext` resumes inside the Start Class tap on iOS Safari and Android Chrome. | not tested | |
| 7 | A cut with crossfade has no click. A cut with glitch is audible. | not tested | |
| 8 | The screen stays on for a full class. The runner shows no "cannot keep the screen on" notice. | not tested | |
| 9 | Lock the screen, then unlock. The runner asks for the wake lock again and the screen stays on. | not tested | |
| 10 | A plan of three songs. Each song starts without a gap you can hear, on the shared `AudioContext`. | not tested | |
| 11 | A 15-minute song plays on a low-memory phone. The whole song is decoded in memory (about 300 MB). | not tested | |
| 12 | The text on the runner is readable at arm's length in a dark room and in a bright room, in all four tiers. | not tested | |
