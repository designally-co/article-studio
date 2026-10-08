"""
Reads the voice-over script (launch/voiceover.json) aloud with Kokoro, an
open-source text-to-speech model (Apache 2.0), and saves the take as
launch/assets/voiceover.wav, where sound.py picks it up.

Each line is spoken on its own and joined with a pause, so sound.py can split
the take back into lines at those pauses.

    launch/run.sh voice                 # sets up Kokoro in launch/.work, then this
    python3 launch/edit/voice.py [voice] [speed]

The voice defaults to am_michael (American English, male). Others include
am_fenrir, am_puck, bm_george and bm_fable (male), af_heart and af_bella
(female). See https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile
from kokoro_onnx import Kokoro

LAUNCH = Path(__file__).resolve().parent.parent
MODELS = LAUNCH / ".work" / "kokoro"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
PAUSE = 0.7  # seconds of silence between lines


def model_file(name):
    path = MODELS / name
    if not path.exists():
        MODELS.mkdir(parents=True, exist_ok=True)
        print(f"downloading {name}")
        urllib.request.urlretrieve(RELEASE + name, path)
    return str(path)


def phonemes(kokoro, text, pronounce):
    """The line as phonemes, with the names in `pronounce` swapped for their
    given sounds. The text between names is phonemised as usual."""
    pieces, rest = [], text
    while rest:
        hits = [(rest.find(name), name) for name in pronounce if name in rest]
        if not hits:
            pieces.append(kokoro.tokenizer.phonemize(rest, "en-us"))
            break
        at, name = min(hits)
        if rest[:at].strip():
            pieces.append(kokoro.tokenizer.phonemize(rest[:at], "en-us"))
        pieces.append(pronounce[name])
        rest = rest[at + len(name):]
        # Keep the punctuation that follows a name: it carries the pause.
        while rest[:1] in {".", ",", "!", "?"} and rest:
            pieces[-1] += rest[0]
            rest = rest[1:]
    return " ".join(piece.strip() for piece in pieces if piece.strip())


def main():
    voice = sys.argv[1] if len(sys.argv) > 1 else "am_michael"
    speed = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    kokoro = Kokoro(model_file("kokoro-v1.0.onnx"), model_file("voices-v1.0.bin"))
    script = json.loads((LAUNCH / "voiceover.json").read_text())
    pronounce = script.get("pronounce", {})
    parts, rate = [], 24000
    for text in (line["text"] for line in script["lines"]):
        said = phonemes(kokoro, text, pronounce)
        samples, rate = kokoro.create(said, voice=voice, speed=speed, lang="en-us", is_phonemes=True)
        parts += [samples, np.zeros(int(PAUSE * rate), dtype=np.float32)]
        print(f"{len(samples) / rate:5.2f}s  {text}")
    take = np.concatenate(parts[:-1])
    out = LAUNCH / "assets" / "voiceover.wav"
    soundfile.write(out, take / (np.max(np.abs(take)) + 1e-9) * 0.9, rate, subtype="PCM_16")
    print(f"{out}: {len(take) / rate:.2f}s, voice {voice}")


if __name__ == "__main__":
    main()
