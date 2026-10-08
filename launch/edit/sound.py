"""
The soundtrack: interface sounds placed on what happens in the picture, over a
quiet music bed. Everything is synthesised here, so there is no licence to
track. render.py writes the cue list (events-<aspect>.json); this turns it into
audio-<aspect>.wav.

    python3 launch/edit/sound.py 16x9 [music.wav]

Pass a music file to use it instead of the built-in bed: it is trimmed,
faded and laid under the effects at the same level.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
WORK = HERE.parent / ".work"
RATE = 48000
rng = np.random.default_rng(7)  # the same "random" every run


def seconds(n):
    return np.arange(int(n * RATE)) / RATE


def envelope(n, attack, decay):
    t = seconds(n)
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def bandpass(x, low, high):
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / RATE)
    spectrum[(freqs < low) | (freqs > high)] = 0
    return np.fft.irfft(spectrum, len(x))


# --- effects -------------------------------------------------------------------

def key():
    """A soft laptop key: a short filtered tick with a little body."""
    n = 0.05
    tick = bandpass(rng.standard_normal(int(n * RATE)), 1800, 6500) * envelope(n, 0.0005, 0.006)
    body = np.sin(2 * np.pi * rng.uniform(170, 230) * seconds(n)) * envelope(n, 0.001, 0.012)
    return (tick * 0.5 + body * 0.25) * rng.uniform(0.6, 1.0)


def click():
    n = 0.09
    tick = bandpass(rng.standard_normal(int(n * RATE)), 2500, 9000) * envelope(n, 0.0003, 0.004)
    body = np.sin(2 * np.pi * 140 * seconds(n)) * envelope(n, 0.001, 0.025)
    return tick * 0.8 + body * 0.5


def whoosh():
    n = 0.5
    t = seconds(n)
    noise = rng.standard_normal(len(t))
    out = np.zeros_like(noise)
    # A band of noise that rises through the spectrum.
    for i, (lo, hi) in enumerate([(200, 600), (400, 1200), (800, 2400), (1500, 4000)]):
        part = bandpass(noise, lo, hi)
        centre = (i + 0.5) / 4
        out += part * np.exp(-((t / n - centre) ** 2) / 0.02)
    return out * np.sin(np.pi * t / n) ** 2 * 0.35


def bell(freq, n=1.2, decay=0.35):
    t = seconds(n)
    tone = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t / 0.08)
    return tone * envelope(n, 0.002, decay)


def step():
    return bell(1318.5, 0.5, 0.09) * 0.22


def pop():
    t = seconds(0.12)
    sweep = np.sin(2 * np.pi * (520 * t + 1800 * t * t))
    return sweep * envelope(0.12, 0.002, 0.03) * 0.35


def reveal():
    return (bell(1318.5, 1.4, 0.5) * 0.5 + bell(1975.5, 1.4, 0.4) * 0.35 + bell(2637, 1.4, 0.3) * 0.2) * 0.45


def success():
    first, second = bell(1046.5, 1.2, 0.3), bell(1568, 1.6, 0.5)
    gap = int(0.11 * RATE)
    out = np.zeros(gap + len(second))
    out[: len(first)] += first * 0.5
    out[gap:] += second * 0.55
    return out * 0.6


def end_chord():
    out = np.zeros(int(2.6 * RATE))
    for f in (349.23, 440, 523.25, 659.25):  # F major 7, soft
        out[: int(2.6 * RATE)] += bell(f, 2.6, 0.9)[: len(out)] * 0.18
    return out


EFFECTS = {"key": key, "click": click, "whoosh": whoosh, "step": step, "pop": pop,
           "reveal": reveal, "success": success, "end": end_chord}
LEVEL = {"key": 0.5, "click": 0.75, "whoosh": 0.35, "step": 0.7, "pop": 0.6, "reveal": 0.7, "success": 0.8, "end": 0.7}


# --- music ---------------------------------------------------------------------

def music(length):
    """A calm bed in F: pads, a soft plucked pattern and, after the opening,
    a light pulse. 100 bpm."""
    beat = 60 / 100
    bar = beat * 4
    chords = [  # Fmaj7, Am7, Dm9, Cmaj7/E
        (174.61, 220.0, 261.63, 329.63),
        (220.0, 261.63, 329.63, 392.0),
        (146.83, 220.0, 261.63, 329.63),
        (164.81, 196.0, 246.94, 329.63),
    ]
    n = int(length * RATE)
    pad = np.zeros(n)
    pluck = np.zeros(n)
    pulse = np.zeros(n)
    bars = int(np.ceil(length / bar))
    for b in range(bars):
        chord = chords[b % 4]
        start = int(b * bar * RATE)
        size = min(int(bar * 1.5 * RATE), n - start)
        if size <= 0:
            break
        t = np.arange(size) / RATE
        shape = np.minimum(1, t / 0.6) * np.minimum(1, np.maximum(0, (bar * 1.5 - t) / 0.8))
        for f in chord:
            for detune in (-0.12, 0.0, 0.11):
                voice = sum(np.sin(2 * np.pi * f * (1 + detune / 100) * k * t) / k for k in (1, 2, 3))
                pad[start:start + size] += voice * shape * 0.035
        # Eighth-note plucks on the chord, an octave up.
        for e in range(8):
            at = start + int(e * beat / 2 * RATE)
            note = chord[[0, 2, 1, 3, 2, 1, 3, 2][e]] * 2
            m = min(int(0.6 * RATE), n - at)
            if m <= 0:
                continue
            tt = np.arange(m) / RATE
            pluck[at:at + m] += np.sin(2 * np.pi * note * tt) * np.exp(-tt / 0.18) * (0.05 if e % 2 else 0.07)
        # A soft kick on 1 and 3 and a shaker on the offbeats, after the first two bars.
        if b >= 2:
            for q in range(4):
                at = start + int(q * beat * RATE)
                m = min(int(0.25 * RATE), n - at)
                if m <= 0:
                    continue
                tt = np.arange(m) / RATE
                if q in (0, 2):
                    pulse[at:at + m] += np.sin(2 * np.pi * (55 + 90 * np.exp(-tt / 0.03)) * tt) * np.exp(-tt / 0.12) * 0.18
                off = at + int(beat / 2 * RATE)
                k = min(int(0.06 * RATE), n - off)
                if k > 0:
                    pulse[off:off + k] += bandpass(rng.standard_normal(k), 5000, 12000) * np.exp(-np.arange(k) / RATE / 0.015) * 0.05
    bed = lowpass(pad, 1400) + pluck + pulse
    return bed


def reverb(x, size=1.1, mix=0.18):
    """Convolution with a decaying noise tail: enough room to sit the sounds together."""
    tail = rng.standard_normal(int(size * RATE)) * np.exp(-np.arange(int(size * RATE)) / RATE / (size / 4))
    tail = lowpass(tail, 5000)
    tail /= np.sqrt(np.sum(tail ** 2))
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + len(tail)) * np.fft.rfft(tail, len(x) + len(tail)))[: len(x)]
    return x * (1 - mix) + wet * mix * 3


def load_music(path, length):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    track = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    track = np.pad(track, (0, max(0, int(length * RATE) - len(track))))[: int(length * RATE)]
    return track / (np.max(np.abs(track)) + 1e-9) * 0.35


def main():
    aspect = sys.argv[1] if len(sys.argv) > 1 else "16x9"
    cues = json.loads((WORK / f"events-{aspect}.json").read_text())
    length = cues["frames"] / cues["fps"]
    n = int(length * RATE)

    effects = np.zeros(n + RATE * 3)
    last_key = -1
    for event in cues["events"]:
        kind = event["kind"]
        at = int(event["frame"] / cues["fps"] * RATE)
        if kind == "key":
            # Typing runs at one character a frame; a key every other frame is
            # a believable typist rather than a machine gun.
            if event["frame"] - last_key < 2:
                continue
            last_key = event["frame"]
            at += int(rng.uniform(0, 0.012) * RATE)
        sound = EFFECTS[kind]() * LEVEL[kind]
        effects[at:at + len(sound)] += sound
    effects = reverb(effects[:n], 0.8, 0.12)

    bed = load_music(sys.argv[2], length) if len(sys.argv) > 2 else reverb(music(length), 1.6, 0.25)
    # In over the first second, out under the end card.
    t = np.arange(n) / RATE
    bed *= np.minimum(1, t / 1.0) * np.minimum(1, np.maximum(0, (length - t) / 1.6))
    bed *= 0.55

    mix = effects + bed
    mix /= max(1.0, np.max(np.abs(mix)) / 0.89)  # peak at about -1 dBFS
    stereo = np.stack([mix, mix], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    out = WORK / f"audio-{aspect}.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    print(f"{out}: {length:.2f}s")


if __name__ == "__main__":
    main()
