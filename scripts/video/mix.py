"""Lays the voice lines (at the times in timeline.json) and the synthesized music under the recorded video.
The music ducks under the voice. Output: H.264 + AAC mp4 for YouTube.
  FFMPEG=/path/to/ffmpeg python3 scripts/video/mix.py   → docs/leash-demo.mp4
"""
import json, os, re, subprocess, sys

FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, "..", ".."))
tmp = os.path.join(root, "docs", ".video-tmp")
video = os.path.join(tmp, "leash-demo.webm")
out = os.environ.get("OUT", os.path.join(root, "docs", "leash-demo.mp4"))
tl = json.load(open(os.path.join(tmp, "timeline.json")))

err = subprocess.run([FFMPEG, "-i", video], capture_output=True, text=True).stderr
m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
secs = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else tl["end"] / 1000 + 1
music = os.path.join(tmp, "music.wav")
subprocess.run([sys.executable, os.path.join(here, "music.py"), str(secs), music], check=True)

# Find each line's start in the video: the 12px corner marker changes colour (record-video.ts).
MARK = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255)]
raw = subprocess.run([FFMPEG, "-loglevel", "error", "-i", video, "-vf", "fps=30,crop=6:6:3:3,scale=1:1:flags=area",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
lines = tl["lines"]
seen = {}   # line index -> first frame (ms) showing its marker; a stalled capture can skip a marker entirely
want = 0
for f in range(len(raw) // 3):
    px = raw[f * 3:f * 3 + 3]
    for j in range(want, min(want + 3, len(lines))):
        if all(abs(px[k] - MARK[j % 6][k]) < 80 for k in range(3)):
            seen[j] = round(f * 1000 / 30); want = j + 1
            break
    if want >= len(lines): break
durs = json.load(open(os.path.join(tmp, "vo", "durations.json")))
starts = []
for i, line in enumerate(lines):
    if i in seen: t = seen[i]
    else:        # no marker: keep the clock gap to the previous line
        t = (starts[-1] + line["t"] - lines[i - 1]["t"]) if i else line["t"]
    if i: t = max(t, starts[-1] + durs[lines[i - 1]["id"]] + 150)   # never talk over the previous line
    starts.append(t)
print(f"sync marks found for {len(seen)} of {len(lines)} lines")
inputs, chains = ["-i", video, "-i", music], []
for i, line in enumerate(lines):
    inputs += ["-i", os.path.join(tmp, "vo", f"{line['id']}.mp3")]
    d = starts[i]
    chains.append(f"[{i + 2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={d}|{d}[v{i}]")
n = len(tl["lines"])
graph = "[0:v]drawbox=x=0:y=0:w=16:h=16:color=0x0b0c0b:t=fill[vid];" + ";".join(chains) + ";" + "".join(f"[v{i}]" for i in range(n)) + \
    f"amix=inputs={n}:normalize=0:dropout_transition=0,volume=1.35,apad,asplit=2[voice][key];" \
    "[1:a]volume=0.30[bed];" \
    "[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=40:release=700:makeup=1[ducked];" \
    "[voice][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.89[a]"
cmd = [FFMPEG, "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[vid]", "-map", "[a]",
       "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
       "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{secs:.2f}", out]
subprocess.run(cmd, check=True)
print(f"wrote {out} ({secs:.0f}s)")
