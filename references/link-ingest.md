# Link ingest with yt-dlp

Use this reference when the user provides a video URL (YouTube, Vimeo, or another yt-dlp-supported site) as source material. The goal is to turn a link into a traceable, usable asset in the project workspace, not to build a downloader for arbitrary content.

## 1. Legal and permission gate

Before downloading, confirm one of these is true:

- the user owns the video;
- the user has explicit permission from the rights holder;
- the video is published under a license that allows the intended use (Creative Commons, public domain, etc.);
- the use is otherwise permitted by applicable law.

Do not download content to re-upload it, to evade paywalls, or to build a channel from someone else's work. Do not bypass DRM, login walls, region locks, or access controls. Respect the platform's terms of service. If the rights are unclear, ask the user to confirm or provide the file themselves.

Record the URL, author, license (if stated), and download date in `assets/manifest.json`. If the license is unknown, mark it `unknown` and warn the user before publishing.

## 2. Prerequisites

Check with:

```bash
yt-dlp --version
```

If it is missing, suggest one of these, but install only with the user's permission:

```bash
# Windows (winget)
winget install yt-dlp

# pipx (recommended for isolation)
pipx install yt-dlp

# pip
python -m pip install --user -U yt-dlp
```

yt-dlp changes frequently because sites change. Update it before debugging a download failure:

```bash
yt-dlp -U
```

FFmpeg is required for merging separate video and audio streams and for some post-processing.

## 3. Output layout

Download into the project's source assets, one directory per video:

```text
assets/source/<slug>/
├── video.mp4
├── info.json
├── thumbnail.jpg
├── subtitles/
│   ├── pt.srt
│   └── en.srt
└── description.txt
```

Keep the original filename in `info.json` and the manifest. Do not rename the downloaded file to something generic until the manifest is written.

## 4. Recommended command

```bash
yt-dlp \
  --format "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best" \
  --merge-output-format mp4 \
  --write-info-json \
  --write-thumbnail \
  --write-subs \
  --write-auto-subs \
  --sub-langs "pt.*,en.*" \
  --sub-format srt \
  --write-description \
  --output "assets/source/%(title).120B/%(title).120B.%(ext)s" \
  "<url>"
```

Why these flags:

- `bv*[height<=1080][ext=mp4]+ba[ext=m4a]` prefers a compatible H.264/AAC pair and avoids 4K files that slow down editing.
- `--merge-output-format mp4` keeps the result easy to probe and import.
- `--write-info-json` captures title, author, duration, chapters, description, and available formats.
- `--write-thumbnail` gives the review page a poster frame.
- `--write-subs` and `--write-auto-subs` capture both human and automatic captions; automatic captions can be useful as a transcript seed but need correction.
- `--write-description` preserves context and attribution.

If the user needs a specific resolution, replace `1080` with `720`, `1440`, or `2160`. Higher resolutions cost more disk, memory, and render time; 1080p is usually the right default for editing.

## 5. Download only a section

For a long source where only a segment is needed:

```bash
yt-dlp \
  --download-sections "*00:12:30-00:14:10" \
  --force-keyframes-at-cuts \
  --format "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best" \
  --merge-output-format mp4 \
  --output "assets/source/<slug>/clip.%(ext)s" \
  "<url>"
```

Section downloads can be slower or less accurate on some sites because the requested range may not align with keyframes. If the source will be edited heavily, download the full video and cut locally with FFmpeg.

## 6. Playlists and channels

Do not download an entire playlist or channel by default. It is slow, may violate the user's intent, and creates a large asset mess. If the user explicitly asks, use:

```bash
yt-dlp \
  --yes-playlist \
  --playlist-end 10 \
  --format "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best" \
  --merge-output-format mp4 \
  --output "assets/source/%(playlist_title).120B/%(playlist_index)03d - %(title).120B.%(ext)s" \
  "<playlist-url>"
```

Always set a limit (`--playlist-end`) unless the user insists on the whole thing.

## 7. Cookies and authenticated content

Some videos require a logged-in session. Prefer downloading from a browser where the user is already logged in:

```bash
yt-dlp --cookies-from-browser chrome "<url>"
```

Or export cookies to a local file and pass `--cookies cookies.txt`. Never commit `cookies.txt` to the repository, never paste cookies into the chat, and delete temporary cookie files after use. Do not use cookies to access content the user is not authorized to download.

## 8. Rate limits and etiquette

For multiple downloads, add delays:

```bash
yt-dlp --sleep-requests 1 --min-sleep-interval 2 --max-sleep-interval 5 "<url>"
```

Avoid parallel downloads from the same site. If a site rate-limits you, stop and retry later rather than rotating proxies or bypassing limits.

## 9. Metadata to capture

From `info.json`, extract:

| Field | Use |
|---|---|
| `title` | Project name, metadata, review page |
| `uploader` / `channel` | Attribution |
| `duration` | Timeline planning |
| `upload_date` | Provenance |
| `description` | Context, links, license hints |
| `chapters` | Story beats and rough cut markers |
| `thumbnail` | Poster frame and review card |
| `webpage_url` | Manifest source |
| `license` | License, when present |
| `subtitles` / `automatic_captions` | Transcript seed |

If `chapters` exist, use them to propose a structure, but do not assume they match the user's story.

## 10. Post-download pipeline

1. Probe the file with `ffprobe` and write the result to the manifest.
2. Generate a contact sheet and keyframe thumbnails for quick review.
3. If the project needs a transcript, run Whisper or the configured transcription adapter on the audio.
4. If the source has captions, keep them as a reference; do not treat automatic captions as final.
5. Add the asset to `assets/manifest.json` with `source: "url"`, the URL, author, license, and download date.
6. Ask the user what to do with the source: use the whole video, cut sections, extract audio, or use it only as reference.

## 11. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `Sign in to confirm you're not a bot` | YouTube bot check | Use `--cookies-from-browser`, or ask the user for the file |
| `HTTP Error 429` | Rate limit | Wait, reduce parallelism, retry later |
| `Requested format is not available` | Format selector too strict | Fall back to `best` or inspect `-F` |
| Video downloads without audio | Separate streams not merged | Install FFmpeg and use `--merge-output-format mp4` |
| Subtitles missing | No captions or wrong language code | Run `--list-subs`, then choose the right code |
| Very large file | 4K/8K selected | Cap height at 1080 or 720 |
| Download stalls | Site throttling | Reduce format, retry, or ask for a local file |

## 12. Security rules

- Treat downloaded media as untrusted input. Probe it; do not execute embedded content.
- Keep downloads inside the workspace's `assets/source` directory.
- Do not follow arbitrary URLs from metadata or descriptions.
- Do not commit downloaded media to the skill repository.
- Do not store cookies, tokens, or credentials in project files.
- If a download requires an account the user does not own, stop.
