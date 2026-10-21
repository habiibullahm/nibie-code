# A line becomes a room

A 15 second motion reel for Nibie: 1920x1080, 60 fps, 900 frames, 120 BPM (30 beats of 0.5 s), 48 kHz stereo. The last frame is the same image as the first, so it loops.

Final file: `nibie-line-becomes-a-room.mp4`.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole piece. `window.seek(t)` draws the frame at time `t` from `t` alone. `window.renderAudio()` synthesises the soundtrack. |
| `Syne-700.ttf` | Syne Bold (700), the only typeface. Its glyph outlines are embedded in `index.html` as path data. |
| `audio.wav` | 15.000 s, 48 kHz, 16-bit stereo, rendered by `OfflineAudioContext`. No samples are used. |
| `beats/` | The 31 beat frames (t = 0.00, 0.50 … 15.00) used for review. |
| `render.mjs` | Serves the folder over http and drives headless Chromium. It renders the beat frames, the 900 frames or the audio. |

## How it is built

- **Time.** Every value comes from keyframes that land exactly on a beat. Moves use closed-form exponential easing or a critically damped spring. Nothing overshoots, and nothing holds still for longer than 0.5 s.
- **Camera.** The camera is orthographic. The Z dolly is a uniform scale about the frame centre: it eases in from 1.0 to 1.3 between 0 s and 12 s, then back to 1.0 between 12 s and 15 s. Only the room object turns axonometric.
- **Motion blur.** Each frame averages eight samples over the last half frame, inside `seek`. Moving shapes leave a straight streak along their own path. Still shapes stay sharp.
- **Palette.** Only `#F4F1EA`, `#141414`, `#1B3A4B`, `#E24E1B` and `#D6D1C7`, as flat fills.
- **Audio.**
  - A kick on every beat.
  - Hits at 0, 3, 6, 9, 12 and 14 s, with 12 s the strongest: a sub drop, a noise crack and a filtered saw stab.
  - A noise and saw riser from 10 s that cuts at 12 s.

## Re-render

You need Node 18+, ffmpeg, Python 3 (for the http server), `playwright-core`, and a Chromium binary.

```sh
npm i --prefix /tmp/pw playwright-core
export PW_NODE_MODULES=/tmp/pw/node_modules CHROMIUM=/path/to/chromium
node render.mjs audio                 # audio.wav
node render.mjs beats                 # beats/
node render.mjs frames /tmp/frames    # 900 PNGs
ffmpeg -framerate 60 -i /tmp/frames/f%04d.png -i audio.wav \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 256k -t 15 -movflags +faststart nibie-line-becomes-a-room.mp4
```

The glyph data in `index.html` was extracted from `Syne-700.ttf` with fontTools: a `SVGPathPen` per glyph, y flipped, plus the advance width and bounds.
