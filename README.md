# Frigate Clip Card

A Home Assistant Lovelace card to **pick a [Frigate](https://frigate.video) recording, trim it and download it**
as an MP4 — or save it as a Frigate export. No re-encoding: Frigate cuts the clip from its recordings.

*Македонски — види подолу.*

## Features
- Camera and day pickers; the hours that have recordings are highlighted.
- Preview an hour of recordings (HLS), move to the previous/next hour.
- **Start here / End here** from the player position, ±1 s / ±5 s nudges, click a time to jump to it.
- **Download MP4** of exactly that range, or **Save to Frigate** (appears under *Exports* in Frigate).
- Gaps in the recordings are skipped correctly; a warning shows if part of the range was not recorded.
- Works away from home: everything goes through Home Assistant (signed URLs), never directly to Frigate.
- English and Macedonian, following your Home Assistant profile language (or set `language`).
- Visual editor.

## Requirements
- Home Assistant with the [Frigate integration](https://github.com/blakeblackshear/frigate-hass-integration)
  **v5.15 or newer** (uses its `frigate/recordings/*` websocket commands, recording/VOD proxy and the
  `frigate.export_recording` service).
- Frigate with recordings enabled.

## Installation (HACS)
1. HACS → ⋮ → **Custom repositories** → add `https://github.com/gdarko/frigate-clip-card`, type **Dashboard**.
2. Install **Frigate Clip Card** and reload the browser.
3. Add the card from the dashboard card picker, or in YAML:

```yaml
type: custom:frigate-clip-card
```

## Options
| Option | Default | Description |
|---|---|---|
| `title` | "Clip from recordings" | Card title |
| `cameras` | all Frigate cameras | List of camera entities, or `{entity, name}` objects to rename them |
| `default_camera` | first camera | Camera selected when the card opens |
| `language` | `auto` | `auto`, `en` or `mk` |
| `max_length_minutes` | `30` | Longest clip allowed |

```yaml
type: custom:frigate-clip-card
title: Clips
default_camera: camera.front_door
language: auto
max_length_minutes: 30
cameras:
  - entity: camera.front_door
    name: Front door
  - camera.garage
```

## How it works
| Step | Home Assistant / Frigate integration API |
|---|---|
| Days and hours with recordings | websocket `frigate/recordings/summary` |
| Recording segments of the hour | websocket `frigate/recordings/get` |
| Preview | `/api/frigate/<instance>/vod/<camera>/start/<s>/end/<e>/index.m3u8` (signed with `auth/sign_path`) |
| Download | `/api/frigate/<instance>/recording/<camera>/start/<s>/end/<e>` (signed) |
| Save to Frigate | service `frigate.export_recording` |

## Development
```sh
npm ci
npm run watch      # rebuilds dist/frigate-clip-card.js on change
```
Releases: push a `vX.Y.Z` tag — the workflow builds the bundle and attaches it to the GitHub release (HACS
installs that asset).

---

## Македонски

Картичка за Home Assistant: **изберете снимка од Frigate, исечете ја и симнете ја** како MP4, или зачувајте ја
во Frigate (Exports). Видеото не се кодира повторно — Frigate го сече од снимките.

- Избор на камера и ден; часовите со снимки се обоени.
- Преглед по час, со „Претходен / Следен час“.
- **Почеток тука / Крај тука** од моменталната позиција, фино дотерување ±1 / ±5 секунди.
- **Симни MP4** или **Зачувај во Frigate**.
- Работи и надвор од дома, бидејќи сè оди преку Home Assistant.
- Македонски и англиски, според јазикот на вашиот HA профил (или `language: mk`).

**Инсталација:** HACS → ⋮ → *Custom repositories* → `https://github.com/gdarko/frigate-clip-card`, тип
*Dashboard* → инсталирај → освежи го прелистувачот → додај ја картичката.

Потребно: Frigate интеграција v5.15 или понова.

## License
MIT
