"""Background music for the demo video, synthesized from scratch (no samples, no licensing):
a slow Am7–Fmaj7–Cmaj7–G6 pad with a soft arpeggio and sub bass, through a convolution reverb.
  python3 scripts/video/music.py <seconds> <out.wav>
"""
import sys, wave
import numpy as np

SR = 44100
secs = float(sys.argv[1])
out = sys.argv[2]
n = int(SR * secs)
t = np.arange(n) / SR
rng = np.random.default_rng(7)

def hz(midi): return 440.0 * 2 ** ((midi - 69) / 12)

# A minor, 4 s per chord (≈ 60 bpm, one bar each)
CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 64]]
BASS = [45, 41, 36, 43]
BAR = 4.0
L = np.zeros(n); R = np.zeros(n)

def env(start, length, attack, release):
    e = np.zeros(n)
    i0, i1 = max(0, int(start * SR)), min(n, int((start + length) * SR))
    if i0 >= i1: return e
    x = np.arange(i0, i1) / SR - start
    e[i0:i1] = np.minimum(1, x / attack) * np.minimum(1, np.maximum(0, (length - x) / release))
    return e

bars = int(np.ceil(secs / BAR)) + 1
for b in range(bars):
    start = b * BAR - 0.6               # overlap so chords cross-fade
    chord, bass = CHORDS[b % 4], BASS[b % 4]
    e = env(start, BAR + 1.2, 1.4, 1.6)
    if not e.any(): continue
    for k, m in enumerate(chord):
        f = hz(m)
        for det, pan in ((-0.12, 0.3), (0.12, 0.7)):   # two slightly detuned voices per note
            ph = rng.uniform(0, 2 * np.pi)
            v = np.sin(2 * np.pi * f * (1 + det / 100) * t + ph) + 0.18 * np.sin(4 * np.pi * f * t + ph)
            L += 0.05 * e * v * (1 - pan); R += 0.05 * e * v * pan
    sub = 0.11 * env(start + 0.6, BAR, 0.3, 1.0) * np.sin(2 * np.pi * hz(bass - 12) * t)
    L += sub; R += sub
    # arpeggio: eighth notes, plucky, from bar 4 on so the intro breathes
    if b >= 4:
        pattern = [chord[0] + 12, chord[2] + 12, chord[1] + 12, chord[3] + 12] * 2
        for i, m in enumerate(pattern):
            s0 = b * BAR + i * BAR / 8
            i0 = int(s0 * SR)
            if i0 >= n: break
            ln = min(n - i0, int(0.9 * SR))
            x = np.arange(ln) / SR
            pl = np.sin(2 * np.pi * hz(m) * x) * np.exp(-x * 6) * (1 - np.exp(-x * 400))
            pan = 0.35 if i % 2 else 0.65
            L[i0:i0 + ln] += 0.032 * pl * (1 - pan); R[i0:i0 + ln] += 0.032 * pl * pan

# convolution reverb: 2.8 s of decaying noise
ir_len = int(2.8 * SR)
x = np.arange(ir_len) / SR
def ir(): 
    v = rng.standard_normal(ir_len) * np.exp(-x * 2.3)
    v[0] = 0; return v / np.sqrt(np.sum(v ** 2))
def conv(a, h):
    m = len(a) + len(h)
    size = 1 << (m - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, size) * np.fft.rfft(h, size), size)[:len(a)]
L = 0.65 * L + 0.5 * conv(L, ir()); R = 0.65 * R + 0.5 * conv(R, ir())

# fade in/out, normalize to -3 dBFS
fade = np.minimum(1, t / 3) * np.minimum(1, np.maximum(0, (secs - t) / 4))
L *= fade; R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
st = (np.stack([L, R], 1) / peak * 0.7 * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print(f"wrote {out} ({secs:.1f}s)")
