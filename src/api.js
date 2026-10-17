// Thin wrappers around what the Frigate Home Assistant integration (>= 5.15) already exposes.
// Every request goes through Home Assistant, so the card also works away from home.

const parse = (r) => (typeof r === "string" ? JSON.parse(r) : r);

export async function getRecordingsSummary(hass, instanceId, camera, timezone) {
  return parse(
    await hass.callWS({
      type: "frigate/recordings/summary",
      instance_id: instanceId,
      camera,
      timezone,
    }),
  );
}

export async function getRecordings(hass, instanceId, camera, after, before) {
  return parse(
    await hass.callWS({
      type: "frigate/recordings/get",
      instance_id: instanceId,
      camera,
      after: Math.floor(after),
      before: Math.ceil(before),
    }),
  );
}

export async function signPath(hass, path, expires = 3600) {
  const res = await hass.callWS({ type: "auth/sign_path", path, expires });
  return res.path;
}

// HLS playlist for a time window (the integration proxies it to Frigate's vod module).
export const vodPath = (instanceId, camera, start, end) =>
  `/api/frigate/${instanceId}/vod/${camera}/start/${Math.floor(start)}/end/${Math.ceil(end)}/index.m3u8`;

// MP4 of exactly [start, end] cut from the recordings by Frigate, without re-encoding.
export const clipPath = (instanceId, camera, start, end) =>
  `/api/frigate/${instanceId}/recording/${camera}/start/${Math.floor(start)}/end/${Math.ceil(end)}`;

export async function saveExport(hass, entityId, start, end, name, timeZone) {
  // The integration parses "%Y-%m-%d %H:%M:%S" as Home Assistant local time.
  await hass.callService(
    "frigate",
    "export_recording",
    {
      playback_factor: "realtime",
      start_time: formatLocal(start, timeZone),
      end_time: formatLocal(end, timeZone),
      name: name || null,
    },
    { entity_id: entityId },
  );
}

function formatLocal(epoch, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(epoch * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
