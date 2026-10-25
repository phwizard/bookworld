#!/usr/bin/env python3
"""Sings a line of a song in a character's voice: each word is spoken by the voice backend (the same command the
world service uses for lines), analysed with the WORLD vocoder, stretched to its notes' length, set to their pitch
with a little portamento and vibrato, and placed on the beat. No model sings; the voice is the character's.

    sing.py --out line.mp3 --tempo 96 --words '[{"word":"In","notes":[[60,1]]}, ...]' \
            --speak 'voice/say.sh {voice} {out} {text}' --voice Moira [--sample x.wav --lang en --description '...']

`words` is the JSON the world service builds from a song file's {melody:} line (shared/src/song.ts parseMelody):
notes are [midi, beats]; midi -1 is a rest. Needs the venv: numpy, soundfile, pyworld; ffmpeg on the PATH or the imageio-ffmpeg package.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import pyworld as pw
import soundfile as sf

FRAME_MS = 5.0
RATE = 22050


def ffmpeg_path() -> str:
    """ffmpeg on the PATH, or the one in the imageio-ffmpeg package (a box where nothing can be installed with apt)."""
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


FFMPEG = ffmpeg_path()


def speak(template: str, text: str, out: str, values: dict) -> None:
    v = dict(values, text=text, out=out)
    parts = [p for p in template.split()]
    args = []
    for p in parts:
        for k, val in v.items():
            p = p.replace('{' + k + '}', val)
        args.append(p)
    subprocess.run(args, check=True, timeout=120)


def load_mono(path: str) -> np.ndarray:
    wav = path + '.wav'
    subprocess.run([FFMPEG, '-loglevel', 'error', '-y', '-i', path, '-ac', '1', '-ar', str(RATE), wav], check=True)
    x, fs = sf.read(wav, dtype='float64')
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x


def trim(x: np.ndarray, floor_db: float = -38.0, margin_s: float = 0.03) -> np.ndarray:
    hop = int(RATE * 0.005)
    frames = max(1, len(x) // hop)
    rms = np.array([np.sqrt(np.mean(x[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(frames)])
    db = 20 * np.log10(rms / (rms.max() + 1e-12) + 1e-12)
    loud = np.where(db > floor_db)[0]
    if not len(loud):
        return x
    a = max(0, int(loud[0] * hop - margin_s * RATE))
    b = min(len(x), int((loud[-1] + 1) * hop + margin_s * RATE))
    return x[a:b]


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def sing_word(x: np.ndarray, notes: list, tempo: float, vib_cents: float, vib_hz: float) -> np.ndarray:
    """The spoken word stretched to its notes and set to their pitch."""
    beat = 60.0 / tempo
    f0, t = pw.harvest(x, RATE, frame_period=FRAME_MS)
    sp = pw.cheaptrick(x, f0, t, RATE)
    ap = pw.d4c(x, f0, t, RATE)
    n_src = len(f0)
    total_beats = sum(b for _, b in notes)
    n_tgt = max(4, int(round(total_beats * beat * 1000 / FRAME_MS)))
    # voiced frames of the source carry the vowel; they stretch, the unvoiced edges (consonants) keep their length
    voiced = f0 > 0
    idx = np.arange(n_tgt) * (n_src / n_tgt)
    src_i = np.clip(np.round(idx).astype(int), 0, n_src - 1)
    if voiced.sum() >= 4 and n_tgt > n_src:
        # keep the consonant frames at the start and end one to one, stretch the voiced middle
        first, last = int(np.argmax(voiced)), int(n_src - np.argmax(voiced[::-1]) - 1)
        head, tail = first, n_src - last - 1
        mid_tgt = n_tgt - head - tail
        if mid_tgt > 2:
            mid = np.clip(np.round(first + np.arange(mid_tgt) * ((last - first + 1) / mid_tgt)).astype(int), first, last)
            src_i = np.concatenate([np.arange(head), mid, np.arange(last + 1, n_src)])
    sp_t = np.ascontiguousarray(sp[src_i])
    ap_t = np.ascontiguousarray(ap[src_i])
    unvoiced = ~voiced[src_i]
    # the pitch: which note each target frame belongs to, by beats
    f0_t = np.zeros(n_tgt)
    pos = 0
    edges = []
    for midi, beats in notes:
        n = int(round(beats / total_beats * n_tgt))
        f0_t[pos:pos + n] = midi_hz(midi) if midi >= 0 else 0.0
        edges.append(pos)
        pos += n
    pos = min(pos, n_tgt)  # the rounded note lengths can add up to a frame more than the target
    f0_t[pos:] = f0_t[pos - 1] if pos > 0 else 0.0
    # portamento: smooth the log pitch over 60 ms around each change
    logf = np.where(f0_t > 0, np.log(np.maximum(f0_t, 1.0)), 0.0)
    k = max(1, int(60 / FRAME_MS))
    if k > 1:
        kern = np.ones(k) / k
        sm = np.convolve(logf, kern, mode='same')
        logf = np.where(f0_t > 0, sm, 0.0)
    # vibrato after the first 150 ms of each note
    tt = np.arange(n_tgt) * FRAME_MS / 1000
    vib = np.zeros(n_tgt)
    for j, e in enumerate(edges):
        end = edges[j + 1] if j + 1 < len(edges) else n_tgt
        on = e + int(150 / FRAME_MS)
        if end > on:
            vib[on:end] = np.sin(2 * np.pi * vib_hz * (tt[on:end] - tt[on])) * (vib_cents / 1200) * np.log(2)
    f0_out = np.where(f0_t > 0, np.exp(logf + vib), 0.0)
    f0_out[unvoiced] = 0.0
    y = pw.synthesize(np.ascontiguousarray(f0_out), sp_t, ap_t, RATE, FRAME_MS)
    fade = int(RATE * 0.01)
    if len(y) > 2 * fade:
        y[:fade] *= np.linspace(0, 1, fade)
        y[-fade:] *= np.linspace(1, 0, fade)
    return y


def main() -> int:
    # a background job next to the world service: the service gets the CPU first
    try:
        os.nice(10)
    except OSError:
        pass
    ap_ = argparse.ArgumentParser()
    ap_.add_argument('--out', required=True)
    ap_.add_argument('--tempo', type=float, required=True)
    ap_.add_argument('--words', required=True, help='JSON, or @file')
    ap_.add_argument('--speak', required=True, help='the voice command template, placeholders {text} {out} {voice} {sample} {lang} {description}')
    ap_.add_argument('--voice', default='')
    ap_.add_argument('--sample', default='')
    ap_.add_argument('--lang', default='en')
    ap_.add_argument('--description', default='')
    ap_.add_argument('--gender', default='')
    ap_.add_argument('--name', default='')
    ap_.add_argument('--vibrato-cents', type=float, default=20.0)
    ap_.add_argument('--vibrato-hz', type=float, default=5.5)
    a = ap_.parse_args()
    words = json.load(open(a.words[1:])) if a.words.startswith('@') else json.loads(a.words)
    beat = 60.0 / a.tempo
    total = sum(b for w in words for _, b in w['notes'])
    out = np.zeros(int((total * beat + 1.0) * RATE))
    values = {'voice': a.voice, 'sample': a.sample, 'lang': a.lang, 'description': a.description, 'gender': a.gender, 'name': a.name}
    with tempfile.TemporaryDirectory() as tmp:
        onset = 0.0
        for i, w in enumerate(words):
            notes = [(m, b) for m, b in w['notes']]
            dur = sum(b for _, b in notes)
            if all(m < 0 for m, _ in notes) or not w['word'].strip():
                onset += dur * beat
                continue
            spoken = os.path.join(tmp, f'w{i}.mp3')
            speak(a.speak, w['word'], spoken, values)
            x = trim(load_mono(spoken))
            y = sing_word(x, notes, a.tempo, a.vibrato_cents, a.vibrato_hz)
            start = int(onset * RATE)
            end = min(len(out), start + len(y))
            out[start:end] += y[:end - start]
            onset += dur * beat
    peak = np.abs(out).max() or 1.0
    out = out / peak * 0.85
    wav = a.out + '.wav'
    sf.write(wav, out, RATE)
    if a.out.endswith('.mp3'):
        r = subprocess.run([FFMPEG, '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '4', a.out])
        if r.returncode == 0:
            os.remove(wav)
        else:
            os.replace(wav, a.out)
    else:
        os.replace(wav, a.out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
