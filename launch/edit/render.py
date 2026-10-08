"""
Cuts the captured frames into the launch video.

Every shot is a crop of the 1440x900 @2x capture that frames only the part of
the screen doing the work, and the camera moves between crops with
easeInOutCubic. Shots meet in short crossfades. On top: the numbered chapter
pill, a drawn cursor (headless captures have none) and a coral ripple on each
click. The end card closes it.

The timing is written against the capture's marks (capture.mjs prints and
saves them), not frame numbers, so a new capture cuts the same way.

    python3 launch/edit/render.py 16x9     -> launch/.work/video-16x9.mp4 + events
    python3 launch/edit/render.py 4x5      -> launch/.work/video-4x5.mp4 + events

sound.py then scores each one and run.sh muxes the final files.
"""
import json
import math
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
WORK = HERE.parent / ".work"
FRAMES = WORK / "frames"
OVERLAYS = WORK / "overlays"
FPS = 30
FADE = 7  # crossfade between shots, in frames
CORAL = (239, 97, 72)

FORMATS = {"16x9": (1920, 1080), "4x5": (1080, 1350)}


def ease(x):
    x = max(0.0, min(1.0, x))
    return 4 * x * x * x if x < 0.5 else 1 - math.pow(-2 * x + 2, 3) / 2


@dataclass
class Clip:
    """One shot. `parts` are (mark, first, last, out_frames): source frames
    mark+first .. mark+last, played over out_frames. `cam` maps an aspect to
    keyframes (frame, cx, cy, width), all in CSS pixels of the capture."""
    name: str
    chapter: str | None
    parts: list
    cam: dict
    viewport: tuple = (1440, 900)
    pill_in: int | None = None  # first clip: frame the pill starts to slide in
    pill_out: int | None = None  # frame the pill starts to fade out (it never returns)
    pill_corner: dict = field(default_factory=dict)  # aspect -> "bottom" to sit bottom-left instead
    sounds: list = field(default_factory=list)  # (frame, kind) extra sound cues
    segment_by_format: dict = field(default_factory=dict)  # aspect -> replacement parts


# --- the cut -------------------------------------------------------------------

PREPARE = ["Reading your topic", "Researching sources", "Planning the article", "Starting the draft"]

CLIPS = [
    Clip(
        "create", "1",
        parts=[("create:start", 0, 134, 112)],
        pill_in=22,  # after the push-in, so the pill never sits on the app's logo
        cam={
            "16x9": [(0, 720, 450, 1440), (8, 720, 450, 1440), (28, 470, 690, 640), (80, 470, 690, 640),
                     (98, 770, 612, 1040), (111, 770, 612, 1040)],
            # 4:5 has no wide opening: any crop tall enough for the screen would cut the ideas chips.
            "4x5": [(0, 433, 688, 336), (40, 433, 688, 336),
                    (78, 520, 688, 336), (86, 520, 688, 336), (99, 1080, 688, 336), (111, 1080, 688, 336)],
        },
    ),
    Clip(
        "prepare", "2",
        parts=[(f"prepare:{label}", 0, 45, 36) for label in PREPARE],
        cam={
            "16x9": [(0, 760, 440, 860), (143, 760, 445, 800)],
            "4x5": [(0, 760, 450, 640), (143, 760, 450, 600)],
        },
        sounds=[(36, "step"), (72, "step"), (108, "step")],
    ),
    Clip(
        "draft", "2",
        parts=[("draft:open", 0, 122, 84)],
        cam={
            "16x9": [(0, 588, 330, 840), (83, 588, 318, 800)],
            "4x5": [(0, 510, 450, 660), (83, 510, 440, 620)],
        },
    ),
    Clip(
        "image", "3",
        parts=[
            ("image:start", 0, 20, 16),
            ("image-prompt:Reading the article", 0, 40, 28),
            ("image-prompt:Writing the prompt", 0, 45, 30),
            ("image:prompt", 0, 53, 38),
            ("image-generate:Painting the image", 0, 45, 28),
            ("image:cover", 0, 50, 42),
        ],
        cam={
            "16x9": [(0, 560, 600, 960), (10, 560, 600, 960), (22, 588, 420, 700), (68, 588, 420, 700),
                     (82, 568, 640, 960), (108, 568, 640, 960), (118, 588, 420, 700), (136, 588, 420, 700),
                     (152, 530, 381, 900), (181, 530, 384, 880)],
            "4x5": [(0, 680, 640, 560), (10, 680, 640, 560), (22, 588, 418, 460), (68, 588, 418, 460),
                    (82, 480, 640, 600), (96, 480, 640, 600), (108, 680, 640, 560), (110, 680, 640, 560),
                    (118, 588, 418, 460), (136, 588, 418, 460), (152, 588, 515, 616), (181, 588, 515, 616)],
        },
        sounds=[(44, "step"), (74, "pop"), (112, "step"), (140, "reveal")],
    ),
    # Two shots joined by a crossfade, not one camera move: a pan from the wide
    # view to the panel would drag the preview's headline across the frame edge.
    Clip(
        "publish-wide", "4",
        parts=[("publish:start", 10, 56, 40)],
        cam={
            "16x9": [(0, 850, 380, 1180), (39, 845, 378, 1166)],  # left edge stays at x <= 262, before the headline
            "4x5": [(0, 1192, 330, 400), (39, 1192, 330, 400)],
        },
    ),
    Clip(
        "publish", "4",
        parts=[
            ("publish:Preparing the article", 0, 45, 32),
            ("publish:Uploading the cover", 0, 45, 32),
            ("publish:done", 0, 45, 36),
        ],
        cam={
            "16x9": [(0, 1100, 290, 680), (99, 1110, 290, 650)],
            "4x5": [(0, 1192, 330, 400), (99, 1192, 330, 390)],
        },
        sounds=[(32, "step"), (64, "success")],
    ),
    Clip(
        "hub", "live",
        parts=[("hub:start", 0, 15, 15), ("hub:start", 15, 175, 92)],
        pill_out=20,
        pill_corner={"4x5": "bottom"},
        cam={
            "16x9": [(0, 720, 487, 1440), (106, 720, 483, 1400)],
            "4x5": [(0, 360, 450, 720), (106, 360, 450, 720)],
        },
        segment_by_format={"4x5": [("hub-narrow:start", 0, 15, 15), ("hub-narrow:start", 15, 175, 92)]},
    ),
    Clip("end", None, parts=[], cam={}),
]
END_FRAMES = 140  # long enough for the closing line of the voice-over


# --- frames --------------------------------------------------------------------

class Source:
    def __init__(self):
        self.manifest = json.loads((FRAMES / "manifest.json").read_text())
        self.frames = self.manifest["frames"]
        self.marks = self.manifest["marks"]
        self.cache = {}

    def image(self, index):
        if index not in self.cache:
            if len(self.cache) > 6:
                self.cache.pop(next(iter(self.cache)))
            self.cache[index] = Image.open(FRAMES / self.frames[index]["file"]).convert("RGB")
        return self.cache[index]


def timeline(clip, source, aspect):
    """The source frame index behind each output frame of a clip."""
    parts = clip.segment_by_format.get(aspect, clip.parts)
    out = []
    for mark, first, last, count in parts:
        base = source.marks[mark]
        for i in range(count):
            out.append(base + first + int(i * (last - first) / count))
    return out


def camera(keys, frame, viewport, aspect_ratio):
    """The crop box (x0, y0, x1, y1) in CSS pixels at `frame`."""
    if frame <= keys[0][0]:
        _, cx, cy, w = keys[0]
    elif frame >= keys[-1][0]:
        _, cx, cy, w = keys[-1]
    else:
        for (f0, *a), (f1, *b) in zip(keys, keys[1:]):
            if f0 <= frame <= f1:
                k = ease((frame - f0) / (f1 - f0)) if f1 > f0 else 1
                cx, cy, w = (a[i] + (b[i] - a[i]) * k for i in range(3))
                break
    vw, vh = viewport
    w = min(w, vw, vh * aspect_ratio)
    h = w / aspect_ratio
    cx = min(max(cx, w / 2), vw - w / 2)
    cy = min(max(cy, h / 2), vh - h / 2)
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


# --- overlays ------------------------------------------------------------------

class Overlays:
    def __init__(self):
        self.pills = {p.stem.split("-", 1)[1]: Image.open(p).convert("RGBA") for p in OVERLAYS.glob("pill-*.png")}
        self.cursor = Image.open(OVERLAYS / "cursor.png").convert("RGBA")
        self.cursor_tip = (16, 16)  # where the arrow's point sits in cursor.png

    def pill(self, canvas, chapter, appear, bottom=False):
        """`appear` 0..1 slides and fades the pill in (or out)."""
        if not chapter or appear <= 0:
            return
        pill = self.pills[chapter]
        y = canvas.height - pill.height - 16 if bottom else 16
        if appear < 1:
            k = ease(appear)
            faded = pill.copy()
            faded.putalpha(faded.getchannel("A").point(lambda a: int(a * k)))
            canvas.alpha_composite(faded, (16, int(y - 14 * (1 - k))))
        else:
            canvas.alpha_composite(pill, (16, y))

    def draw_cursor(self, canvas, at, scale):
        size = (int(self.cursor.width * scale), int(self.cursor.height * scale))
        sprite = self.cursor.resize(size, Image.LANCZOS)
        tip = (int(at[0] - self.cursor_tip[0] * scale), int(at[1] - self.cursor_tip[1] * scale))
        canvas.paste(sprite, tip, sprite)  # paste, not alpha_composite: it clips at the edges

    @staticmethod
    def ripple(canvas, at, age, scale):
        """A coral ring that spreads and fades over 16 frames."""
        k = age / 16
        if k >= 1:
            return
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        r = (10 + 34 * ease(k)) * scale
        alpha = int(230 * (1 - k))
        draw.ellipse([at[0] - r, at[1] - r, at[0] + r, at[1] + r], outline=CORAL + (alpha,), width=max(2, int(4 * scale)))
        inner = r * 0.55
        draw.ellipse([at[0] - inner, at[1] - inner, at[0] + inner, at[1] + inner], fill=CORAL + (int(alpha * 0.28),))
        canvas.alpha_composite(layer)


# --- rendering -----------------------------------------------------------------

def render_clip(clip, source, aspect, overlays):
    """Yields (frame, sound events) for each output frame of one clip."""
    width, height = FORMATS[aspect]
    ratio = width / height
    if clip.name == "end":
        card = Image.open(OVERLAYS / f"end-{aspect}.png").convert("RGB")
        for i in range(END_FRAMES):
            zoom = 1.04 - 0.04 * ease(i / (END_FRAMES - 1))
            w, h = width / zoom, height / zoom
            box = ((width - w) / 2, (height - h) / 2, (width + w) / 2, (height + h) / 2)
            yield card.resize((width, height), Image.LANCZOS, box=box), ([(0, "end")] if i == 0 else [])
        return

    order = timeline(clip, source, aspect)
    viewport = (720, 900) if clip.segment_by_format.get(aspect) else clip.viewport
    keys = clip.cam[aspect]
    ripples = []
    previous = None
    for i, index in enumerate(order):
        sounds = [(0, kind) for f, kind in clip.sounds if f == i]
        x0, y0, x1, y1 = camera(keys, i, viewport, ratio)
        image = source.image(index)
        scale = image.width / viewport[0]
        frame = image.resize((width, height), Image.LANCZOS, box=(x0 * scale, y0 * scale, x1 * scale, y1 * scale))
        canvas = frame.convert("RGBA")
        zoom = width / (x1 - x0)  # output pixels per CSS pixel

        def project(point):
            return ((point[0] - x0) * zoom, (point[1] - y0) * zoom)

        # Everything that happened between the last frame shown and this one.
        span = range(index, index + 1) if previous is None or index <= previous else range(previous + 1, index + 1)
        for j in span:
            for event in source.frames[j]["events"]:
                if event["type"] == "click":
                    ripples.append([event["at"], 0])
                    sounds.append((0, "click"))
                elif event["type"] == "key":
                    sounds.append((0, "key"))
        previous = index

        ui_scale = min(1.25, max(0.7, zoom / 1.6))
        for ripple in ripples:
            overlays.ripple(canvas, project(ripple[0]), ripple[1], ui_scale)
            ripple[1] += 1
        ripples = [r for r in ripples if r[1] < 16]

        cursor = source.frames[index]["cursor"]
        if cursor:
            overlays.draw_cursor(canvas, project(cursor), 0.42 * ui_scale)

        appear = 1.0
        if clip.pill_in is not None:
            appear = min(appear, (i - clip.pill_in) / 10)
        if clip.pill_out is not None:
            appear = min(appear, 1 - (i - clip.pill_out) / 8)
        overlays.pill(canvas, clip.chapter, appear, bottom=clip.pill_corner.get(aspect) == "bottom")
        yield canvas.convert("RGB"), sounds


def main():
    aspect = sys.argv[1] if len(sys.argv) > 1 else "16x9"
    width, height = FORMATS[aspect]
    source = Source()
    overlays = Overlays()

    # Clips laid end to end. A clip's last FADE frames are not written: they
    # blend into the next clip's first FADE frames instead.
    out_path = WORK / f"video-{aspect}.mp4"
    encoder = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
         "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(out_path)],
        stdin=subprocess.PIPE,
    )
    events = []
    cursor_frame = 0
    tail = []  # the previous clip's last FADE frames, waiting to blend
    for c, clip in enumerate(CLIPS):
        frames = list(render_clip(clip, source, aspect, overlays))
        start = cursor_frame
        events.append({"frame": start, "kind": "clip", "name": clip.name})  # anchors the voice-over
        if c:
            events.append({"frame": start, "kind": "whoosh"})
        for i, (frame, sounds) in enumerate(frames):
            for _, kind in sounds:
                events.append({"frame": start + i, "kind": kind})
            if i < len(tail):
                frame = Image.blend(tail[i], frame, (i + 1) / (len(tail) + 1))
            if i < len(frames) - FADE or c == len(CLIPS) - 1:
                encoder.stdin.write(frame.tobytes())
                cursor_frame += 1
        # Hold back this clip's last FADE frames to blend with the next one.
        tail = [f for f, _ in frames[-FADE:]] if c < len(CLIPS) - 1 else []
        print(f"{clip.name}: {len(frames)} frames, now at {cursor_frame / FPS:.2f}s", flush=True)
    encoder.stdin.close()
    encoder.wait()
    meta = {"aspect": aspect, "frames": cursor_frame, "fps": FPS, "events": events}
    (WORK / f"events-{aspect}.json").write_text(json.dumps(meta, indent=1))
    print(f"{out_path}: {cursor_frame} frames, {cursor_frame / FPS:.2f}s")


if __name__ == "__main__":
    main()
