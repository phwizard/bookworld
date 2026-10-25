#!/usr/bin/env python3
"""A voice backend that clones a character's voice from a stored sample (Chatterbox, MIT) and speaks a line.

    VOICE_BACKEND=command
    VOICE_COMMAND=voice/.venv/bin/python voice/render.py --sample {sample} --out {out} --lang {lang} --text {text}

Needs a Python 3.10 to 3.12 environment with `pip install chatterbox-tts soundfile` (PyTorch; a GPU makes it fast,
a CPU renders a line in some seconds). The sample is 10 to 30 seconds of clean speech in the character's voice
(`voice.sample` in the world file, a wav next to world.json). English with the base model; `chatterbox-tts`'s
multilingual model covers Russian, German, French and others, not Ukrainian (October 2026).
"""
import argparse
import subprocess
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', default='')
    ap.add_argument('--out', required=True)
    ap.add_argument('--text', required=True)
    ap.add_argument('--lang', default='en')
    ap.add_argument('--exaggeration', type=float, default=0.5)
    ap.add_argument('--cfg', type=float, default=0.5)
    a = ap.parse_args()
    try:
        import torch  # noqa: F401
        import soundfile as sf
        if a.lang and a.lang != 'en':
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS as TTS
            model = TTS.from_pretrained(device=device())
            wav = model.generate(a.text, language_id=a.lang, audio_prompt_path=a.sample or None, exaggeration=a.exaggeration, cfg_weight=a.cfg)
        else:
            from chatterbox.tts import ChatterboxTTS as TTS
            model = TTS.from_pretrained(device=device())
            wav = model.generate(a.text, audio_prompt_path=a.sample or None, exaggeration=a.exaggeration, cfg_weight=a.cfg)
    except ImportError as e:
        print(f'render.py needs chatterbox-tts, torch and soundfile in its environment: {e}', file=sys.stderr)
        return 2
    tmp = a.out[:-4] + '.wav' if a.out.endswith('.mp3') else a.out + '.wav'
    sf.write(tmp, wav.squeeze(0).cpu().numpy(), model.sr)
    if a.out.endswith('.mp3'):
        r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-codec:a', 'libmp3lame', '-q:a', '4', a.out])
        if r.returncode != 0:
            import os
            os.replace(tmp, a.out)  # a wav under the mp3 name; browsers decode it
    return 0


def device() -> str:
    import torch
    if torch.cuda.is_available():
        return 'cuda'
    if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


if __name__ == '__main__':
    sys.exit(main())
