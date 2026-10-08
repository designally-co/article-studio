# Launch video

The LinkedIn launch video for Article Studio, and the scripts that make it.

- `article-studio-launch.mp4`: 1920×1080, 30 fps, H.264 + AAC, for posts and comments.
- `article-studio-launch-4x5.mp4`: 1080×1350, the same shots cropped for the feed.

It follows one article, *How variable fonts are changing brand identity systems*,
through the app: typing the topic, research and writing, the cover image,
publishing, and the live page on the Knowledge Hub.

## Make it again

```bash
launch/run.sh            # capture, then edit (about 10 minutes)
launch/run.sh capture    # only film the app
launch/run.sh edit       # only cut the video from the last capture
MUSIC=track.mp3 launch/run.sh edit   # use your own music instead of the built-in bed
```

You need Node 22, Python 3 with Pillow and NumPy, ffmpeg, Chromium (set
`CHROME_PATH` if it is not at `/opt/pw-browsers/...`), and the
`designally-knowledge-hub` repository beside this one with its `cms/`
dependencies installed (or set `HUB_DIR`).

`run.sh` resets `./data`, the app's local database. It refuses to run if
`./data` exists and was not made by an earlier run of this script.

## How it works

**Nothing leaves this machine.** Article Studio runs as a production build on
its embedded PGlite database. The Knowledge Hub runs from its own repository on
a throwaway SQLite file in `launch/.work`. No real key is set anywhere.

- `mock/server.mjs` answers the Claude Messages API (the app finds it through
  `ANTHROPIC_BASE_URL`) and Fal.ai. The answers come from `story.mjs`, which
  holds the one article: its topic, plan, sources, draft text, image prompt and
  dek.
- `mock/preload.mjs` is loaded into the app's server. It sends Fal.ai calls to
  the mock and blocks every other request to the internet, so no source page,
  Unsplash or Openverse photo can appear in the video.
- **Gates.** Each mock answer waits at a gate the capture script controls. The
  script films a progress card, then releases the gate. This is what keeps every
  step label on screen long enough to read. The draft stream passes its gate
  three words at a time, one release per frame.

**The page clock is the script's.** `capture/capture.mjs` uses Playwright's
clock and pauses every CSS animation, then moves time forward exactly 1/30 s
before each 2× screenshot. Animations come out smooth however slow the
screenshots are. Long waits are jumped: the script films about 1.5 s after each
step change, then moves the clock to just before the next one.

**The edit** (`edit/`):

- `overlays.mjs` draws the chapter pills, cursor and end cards in the browser,
  with the app's fonts (Zalando Sans, Poppins) and colours.
- `render.py` cuts the frames. Each shot is a crop of the 1440×900 capture,
  with easeInOutCubic camera moves, 7-frame crossfades, the pill, the drawn
  cursor and a coral ripple on each click. Timing is written against the
  capture's named marks, so a new capture cuts the same way.
- `sound.py` builds the soundtrack: typing, clicks, whooshes, soft step ticks,
  a chime on "Published" and a calm music bed, all synthesised.

## Voice-over

The script is `voiceover.json`: one line per shot, each starting a little after
its shot begins. To add the voice, put one recording of all the lines, in
order with a short pause between them, at `assets/voiceover.wav` (or `.mp3`,
`.m4a`), then run `launch/run.sh edit`. `edit/sound.py` splits the take at the
pauses that best match each line's length, places each line on its shot, dips
the music under the voice, and writes `article-studio-launch.srt` with the same
timings. Upload that file as captions on LinkedIn, where most people watch
with the sound off.

## Changing it

- **The article:** edit `story.mjs`. If the title changes, the image prompt
  should still describe `assets/cover.png`.
- **The cover:** replace `assets/cover.png`. Until it exists, the mock uses
  `assets/cover-placeholder.png`.
- **Shot length or framing:** edit `CLIPS` in `edit/render.py`. Camera keyframes
  are `(frame, centre x, centre y, width)` in CSS pixels of the 1440×900 page.
  Then run `launch/run.sh edit`.
