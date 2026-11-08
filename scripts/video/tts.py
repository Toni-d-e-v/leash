"""Narration for the demo video: one mp3 per line of narration.json, plus durations.json (ms).
  pip install edge-tts
  FFMPEG=/path/to/ffmpeg python3 scripts/video/tts.py   → docs/.video-tmp/vo/
"""
import asyncio, json, os, re, subprocess, sys
import edge_tts

VOICE = os.environ.get("VOICE", "en-US-AndrewNeural")
RATE = os.environ.get("RATE", "+0%")
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "..", "docs", ".video-tmp", "vo")
os.makedirs(out, exist_ok=True)
lines = json.load(open(os.path.join(here, "narration.json")))

def duration_ms(path):
    err = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return round((int(h) * 3600 + int(m) * 60 + float(s)) * 1000)

async def main():
    durations = {}
    for key, text in lines.items():
        path = os.path.join(out, f"{key}.mp3")
        for attempt in range(5):
            try:
                await edge_tts.Communicate(text, VOICE, rate=RATE).save(path)
                break
            except edge_tts.exceptions.NoAudioReceived:
                await asyncio.sleep(2 + attempt * 2)
        else:
            raise SystemExit(f"no audio for {key}")
        durations[key] = duration_ms(path)
        print(f"{key:10s} {durations[key]/1000:5.1f}s", file=sys.stderr)
    json.dump(durations, open(os.path.join(out, "durations.json"), "w"), indent=1)

asyncio.run(main())
