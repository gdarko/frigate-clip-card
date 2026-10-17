// Time helpers that use Home Assistant's time zone, not the browser's.

function zoneOffsetMs(epochMs, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(epochMs))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - epochMs;
}

// "2026-10-17", 3 → epoch seconds of 03:00 in `timeZone`.
export function zonedToEpoch(day, hour, timeZone) {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let epoch = guess - zoneOffsetMs(guess, timeZone);
  epoch = guess - zoneOffsetMs(epoch, timeZone); // second pass for DST edges
  return epoch / 1000;
}

export function formatTime(epoch, timeZone, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epoch * 1000));
}

// Some browsers ship without Macedonian date data, so mk names are built in.
const MK_DAYS = ["нед", "пон", "вто", "сре", "чет", "пет", "саб"];
const MK_MONTHS = ["јан", "фев", "мар", "апр", "мај", "јун", "јул", "авг", "сеп", "окт", "ное", "дек"];

export function formatDay(day, locale) {
  const [y, m, d] = day.split("-").map(Number);
  if (String(locale).startsWith("mk")) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return `${MK_DAYS[wd]}, ${d} ${MK_MONTHS[m - 1]}`;
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fileStamp(epoch, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(epoch * 1000))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}_${p.hour}${p.minute}${p.second}`;
}

// Recordings inside a VOD window are concatenated without gaps, so map player time
// to wall-clock time through the clipped segment list.
export function buildTimeline(segments, windowStart, windowEnd) {
  const parts = [];
  let offset = 0;
  for (const seg of [...segments].sort((a, b) => a.start_time - b.start_time)) {
    const start = Math.max(seg.start_time, windowStart);
    const end = Math.min(seg.end_time, windowEnd);
    if (end <= start) continue;
    parts.push({ start, end, offset });
    offset += end - start;
  }
  return { parts, duration: offset };
}

export function playerToEpoch(timeline, t) {
  if (!timeline.parts.length) return null;
  for (const p of timeline.parts) {
    if (t < p.offset + (p.end - p.start)) return p.start + Math.max(0, t - p.offset);
  }
  const last = timeline.parts[timeline.parts.length - 1];
  return last.end;
}

export function epochToPlayer(timeline, epoch) {
  for (const p of timeline.parts) {
    if (epoch < p.start) return p.offset; // inside a gap: jump to the next recording
    if (epoch <= p.end) return p.offset + (epoch - p.start);
  }
  return timeline.duration;
}

// Seconds of [start, end] that are actually recorded.
export function coveredSeconds(timeline, start, end) {
  let covered = 0;
  for (const p of timeline.parts) covered += Math.max(0, Math.min(end, p.end) - Math.max(start, p.start));
  return covered;
}
