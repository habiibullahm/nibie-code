# A line becomes a room

A 21 second motion reel for Nibie: 1920x1080, 60 fps, 1260 frames, 120 BPM (42 beats of 0.5 s), 48 kHz stereo. The last frame is the same image as the first, so it loops.

Final file: `nibie-line-becomes-a-room.mp4`.

## Story

| Time | What happens |
| --- | --- |
| 0 to 5 s | A line writes NIBIE, then CHAT, THINKING, ROOMS and CONTEXT. The line closes into a room plan. |
| 5 to 8.5 s | The room splits into three bays (Brief, Pins, Threads) and three pins drop in. It extrudes into the FAST, BALANCED and HIGH steps, then turns into a screen. |
| 8.5 to 17.5 s | Real use, drawn from Nibie's dark UI. The website hero scrolls into the app. A Room called "Launch plan" fills in its brief and three pins. A new thread is typed and sent. Nibie shows "Using Room brief · 3 pins · Memory" and streams a reply that recalls the pins. The mode menu opens and High is picked. Remember saves the launch date to Memory. |
| 17.5 to 21 s | The screen squashes into stems, which become the full-bleed NIBIE wordmark, then collapse back to the opening line. |

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole piece. `window.seek(t)` draws the frame at time `t` from `t` alone. `window.renderAudio()` synthesises the soundtrack. |
| `Syne-700.ttf` | Syne Bold (700), the reel's typeface. Its glyph outlines are embedded in `index.html` as path data. |
| `BricolageGrotesque-600.ttf`, `Onest-400.ttf`, `Onest-500.ttf` | Nibie's own UI fonts, used only inside the app screens. They load through `FontFace` before the first frame. |
| `audio.wav` | 21.000 s, 48 kHz, 16-bit stereo, rendered by `OfflineAudioContext`. No samples are used. |
| `beats/` | The 43 beat frames (t = 0.00, 0.50 … 21.00) used for review. |
| `render.mjs` | Serves the folder over http and drives headless Chromium. It renders the beat frames, every frame, one frame, or the audio. |

## How it is built

- **Time.** Every value comes from keyframes that land on a beat or on a UI event. Moves use closed-form exponential easing or a critically damped spring. Nothing overshoots.
- **Camera.** The camera is orthographic. The Z dolly is a uniform scale about the frame centre. It eases in from 1.0 to 1.3, then back to 1.0 at the end. Story time runs slower during the app section, so the dolly stays continuous. Only the room object turns axonometric.
- **Screens.** The app is drawn on a virtual 1600x900 display. Inside the panel it is mapped onto the glass with an affine transform. From 8.5 s it fills the frame. The colours, copy and layout follow the real app: sidebar, Room page, composer, the General / Balanced / Off menus and the Fast / Balanced / High mode menu.
- **Motion blur.** Each frame averages eight samples over the last half frame, inside `seek`. Moving shapes leave a straight streak along their own path. Still shapes stay sharp.
- **Palette.** The reel uses only `#F4F1EA`, `#141414`, `#1B3A4B`, `#E24E1B` and `#D6D1C7`. The app screens use Nibie's dark UI greys, with `#E24E1B` for pins, highlights and the picked mode.
- **Audio.**
  - A kick on every beat.
  - Hits at 0, 3, 6, 9, 12, 15, 18 and 20 s. The 18 s hit, where NIBIE goes full-bleed, is the strongest: a sub drop, a noise crack and a filtered saw stab.
  - A noise and saw riser from 16 s that cuts at 18 s.
  - UI sounds on the app events:
    - a whoosh as the site scrolls
    - clicks
    - a blip per pin
    - a key tick per typed character and on Enter
    - a send whoosh
    - context blips
    - a soft blip per streamed word, brighter on recalled words
    - menu whooshes
    - chimes for High and for "Saved to Memory"

## Re-render

You need Node 18+, ffmpeg, Python 3 (for the http server), `playwright-core`, and a Chromium binary.

```sh
npm i --prefix /tmp/pw playwright-core
export PW_NODE_MODULES=/tmp/pw/node_modules CHROMIUM=/path/to/chromium
node render.mjs audio                 # audio.wav
node render.mjs beats                 # beats/
node render.mjs frames /tmp/frames    # 1260 PNGs
node render.mjs at 12.5 /tmp/one.png  # a single frame
ffmpeg -framerate 60 -i /tmp/frames/f%04d.png -i audio.wav \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 60 \
  -c:a aac -b:a 256k -t 21 -movflags +faststart nibie-line-becomes-a-room.mp4
```

The glyph data in `index.html` was extracted from `Syne-700.ttf` with fontTools: a `SVGPathPen` per glyph, y flipped, plus the advance width and bounds.
