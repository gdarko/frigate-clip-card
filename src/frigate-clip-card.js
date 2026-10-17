import { LitElement, html, css, nothing } from "lit";
import { getRecordingsSummary, getRecordings, signPath, vodPath, clipPath, saveExport } from "./api.js";
import {
  zonedToEpoch,
  formatTime,
  formatDay,
  formatDuration,
  fileStamp,
  buildTimeline,
  playerToEpoch,
  epochToPlayer,
  coveredSeconds,
} from "./time.js";
import { localize } from "./i18n.js";
import { VodPlayer } from "./player.js";
import "./editor.js";

const VERSION = "0.1.1";

class FrigateClipCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _camera: { state: true },
    _days: { state: true },
    _day: { state: true },
    _hour: { state: true },
    _timeline: { state: true },
    _start: { state: true },
    _end: { state: true },
    _name: { state: true },
    _status: { state: true },
    _busy: { state: true },
  };

  static getConfigElement() {
    return document.createElement("frigate-clip-card-editor");
  }

  static getStubConfig() {
    return { type: "custom:frigate-clip-card" };
  }

  setConfig(config) {
    this._config = { max_length_minutes: 30, ...config };
  }

  getCardSize() {
    return 9;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  // ---- data ---------------------------------------------------------------------------------

  get _tz() {
    return this.hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  get _locale() {
    const lang = this._config?.language;
    return lang && lang !== "auto" ? lang : this.hass?.locale?.language || this.hass?.language || "en";
  }

  _t(key, vars) {
    return localize(this.hass, key, vars, this._config?.language);
  }

  get _cameras() {
    if (!this.hass) return [];
    const wanted = this._config?.cameras;
    const isFrigate = (id) => {
      const a = this.hass.states[id]?.attributes;
      return a && a.client_id && a.camera_name;
    };
    const list = wanted
      ? wanted.map((c) => (typeof c === "string" ? { entity: c } : c))
      : Object.keys(this.hass.states)
          .filter((id) => id.startsWith("camera.") && isFrigate(id))
          .sort()
          .map((entity) => ({ entity }));
    return list
      .filter((c) => isFrigate(c.entity))
      .map((c) => {
        const a = this.hass.states[c.entity].attributes;
        return { entity: c.entity, name: c.name || a.friendly_name || a.camera_name, frigate: a.camera_name, instance: a.client_id };
      });
  }

  get _cam() {
    return this._cameras.find((c) => c.entity === this._camera);
  }

  updated(changed) {
    if (changed.has("hass") && !this._camera && this._cameras.length) {
      const preferred = this._config?.default_camera;
      this._selectCamera(this._cameras.some((c) => c.entity === preferred) ? preferred : this._cameras[0].entity);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._player?.destroy();
  }

  async _selectCamera(entity) {
    this._camera = entity;
    this._days = null;
    this._hour = null;
    this._timeline = null;
    this._start = this._end = null;
    this._player?.destroy();
    const cam = this._cam;
    if (!cam) return;
    try {
      const summary = await getRecordingsSummary(this.hass, cam.instance, cam.frigate, this._tz);
      this._days = summary
        .map((d) => ({ day: d.day, hours: new Map(d.hours.map((h) => [Number(h.hour), h])) }))
        .sort((a, b) => b.day.localeCompare(a.day));
      this._day = this._days[0]?.day ?? null;
    } catch (err) {
      this._status = { kind: "error", text: `${this._t("error")}: ${err.message || err}` };
    }
  }

  _selectDay(day) {
    this._day = day;
    this._hour = null;
    this._timeline = null;
    this._player?.destroy();
  }

  async _selectHour(hour) {
    const cam = this._cam;
    if (!cam || hour == null) return;
    this._hour = hour;
    this._status = { kind: "info", text: this._t("loading") };
    const start = zonedToEpoch(this._day, hour, this._tz);
    const end = Math.min(start + 3600, Date.now() / 1000);
    try {
      const segments = await getRecordings(this.hass, cam.instance, cam.frigate, start, end);
      const timeline = { ...buildTimeline(segments, start, end), windowStart: start, windowEnd: end };
      this._timeline = timeline;
      if (!timeline.parts.length) {
        this._status = { kind: "warn", text: this._t("no_recordings_hour") };
        return;
      }
      const signed = await signPath(this.hass, vodPath(cam.instance, cam.frigate, start, end), 4 * 3600);
      await this.updateComplete;
      const video = this.renderRoot.querySelector("video");
      this._player ??= new VodPlayer(video);
      this._player.load(signed);
      this._player.onError((e) => (this._status = { kind: "error", text: `${this._t("error")}: ${e.details}` }));
      this._status = null;
    } catch (err) {
      this._status = { kind: "error", text: `${this._t("error")}: ${err.message || err}` };
    }
  }

  _shiftHour(delta) {
    if (this._hour == null) return;
    let hour = this._hour + delta;
    let dayIdx = this._days.findIndex((d) => d.day === this._day);
    if (hour < 0 || hour > 23) {
      // days are sorted newest first
      dayIdx += hour < 0 ? 1 : -1;
      if (dayIdx < 0 || dayIdx >= this._days.length) return;
      this._day = this._days[dayIdx].day;
      hour = hour < 0 ? 23 : 0;
    }
    this._selectHour(hour);
  }

  // ---- trimming -----------------------------------------------------------------------------

  get _video() {
    return this.renderRoot?.querySelector("video");
  }

  _now() {
    if (!this._timeline || !this._video) return null;
    return playerToEpoch(this._timeline, this._video.currentTime);
  }

  _setMark(which) {
    const t = this._now();
    if (t == null) return;
    if (which === "start") this._start = t;
    else this._end = t;
    this._status = null;
  }

  _nudge(which, delta) {
    if (which === "start" && this._start != null) this._start += delta;
    if (which === "end" && this._end != null) this._end += delta;
    const t = which === "start" ? this._start : this._end;
    if (t != null && this._timeline && this._video) this._video.currentTime = epochToPlayer(this._timeline, t);
  }

  _seek(epoch) {
    if (epoch != null && this._timeline && this._video) this._video.currentTime = epochToPlayer(this._timeline, epoch);
  }

  _validate() {
    if (this._start == null || this._end == null) return this._t("err_unset");
    if (this._end <= this._start) return this._t("err_order");
    if (this._end - this._start > this._config.max_length_minutes * 60)
      return this._t("err_too_long", { max: this._config.max_length_minutes });
    return null;
  }

  async _download() {
    const problem = this._validate();
    if (problem) return (this._status = { kind: "error", text: problem });
    const cam = this._cam;
    this._busy = true;
    this._status = { kind: "info", text: this._t("preparing") };
    try {
      const signed = await signPath(this.hass, clipPath(cam.instance, cam.frigate, this._start, this._end), 600);
      const a = document.createElement("a");
      a.href = signed;
      const label = (this._name || cam.frigate).trim().replace(/[^\p{L}\p{N}_-]+/gu, "_");
      a.download = `${label}_${fileStamp(this._start, this._tz)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this._status = null;
    } catch (err) {
      this._status = { kind: "error", text: `${this._t("error")}: ${err.message || err}` };
    } finally {
      this._busy = false;
    }
  }

  async _save() {
    const problem = this._validate();
    if (problem) return (this._status = { kind: "error", text: problem });
    this._busy = true;
    try {
      await saveExport(this.hass, this._camera, this._start, this._end, this._name, this._tz);
      this._status = { kind: "ok", text: this._t("saved") };
    } catch (err) {
      this._status = { kind: "error", text: `${this._t("error")}: ${err.message || err}` };
    } finally {
      this._busy = false;
    }
  }

  // ---- rendering ----------------------------------------------------------------------------

  render() {
    if (!this.hass || !this._config) return nothing;
    const cams = this._cameras;
    const t = (k, v) => this._t(k, v);
    if (!cams.length) return html`<ha-card .header=${this._config.title ?? t("title")}><div class="body">${t("no_cameras")}</div></ha-card>`;

    const dayInfo = this._days?.find((d) => d.day === this._day);
    const length = this._start != null && this._end != null ? this._end - this._start : null;
    // Gap check only when the clip lies inside the loaded hour (the timeline knows nothing outside it).
    const inWindow =
      this._timeline && this._start >= this._timeline.windowStart && this._end <= this._timeline.windowEnd;
    const covered = length > 0 && inWindow ? coveredSeconds(this._timeline, this._start, this._end) : null;
    const gaps = covered != null && covered < length * 0.95;

    return html`
      <ha-card .header=${this._config.title ?? t("title")}>
        <div class="body">
          <div class="row">
            <label>
              <span>${t("camera")}</span>
              <select @change=${(e) => this._selectCamera(e.target.value)}>
                ${cams.map((c) => html`<option value=${c.entity} ?selected=${c.entity === this._camera}>${c.name}</option>`)}
              </select>
            </label>
            <label>
              <span>${t("day")}</span>
              <select ?disabled=${!this._days?.length} @change=${(e) => this._selectDay(e.target.value)}>
                ${(this._days || []).map(
                  (d) => html`<option value=${d.day} ?selected=${d.day === this._day}>${formatDay(d.day, this._locale)}</option>`,
                )}
              </select>
            </label>
          </div>

          ${this._days && !this._days.length ? html`<div class="note">${t("no_recordings")}</div>` : nothing}
          ${dayInfo
            ? html`<div class="hours" role="group" aria-label=${t("hour")}>
                ${Array.from({ length: 24 }, (_, h) => {
                  const info = dayInfo.hours.get(h);
                  return html`<button
                    class="hour ${info ? "has" : ""} ${info?.events ? "events" : ""} ${h === this._hour ? "active" : ""}"
                    ?disabled=${!info}
                    title=${info ? `${String(h).padStart(2, "0")}:00 · ${formatDuration(info.duration)}` : ""}
                    @click=${() => this._selectHour(h)}
                  >
                    ${String(h).padStart(2, "0")}
                  </button>`;
                })}
              </div>`
            : nothing}

          <div class="player ${this._hour == null ? "empty" : ""}">
            <video controls playsinline muted preload="metadata"></video>
            ${this._hour == null ? html`<div class="placeholder">${t("pick_hour")}</div>` : nothing}
          </div>

          ${this._hour != null
            ? html`
                <div class="row nav">
                  <button class="ghost" @click=${() => this._shiftHour(-1)}><ha-icon icon="mdi:chevron-left"></ha-icon>${t("prev_hour")}</button>
                  <span class="window">${String(this._hour).padStart(2, "0")}:00 – ${String((this._hour + 1) % 24).padStart(2, "0")}:00</span>
                  <button class="ghost" @click=${() => this._shiftHour(1)}>${t("next_hour")}<ha-icon icon="mdi:chevron-right"></ha-icon></button>
                </div>

                <div class="marks">
                  ${this._markRow("start", t("start"), this._start, t("set_start"))}
                  ${this._markRow("end", t("end"), this._end, t("set_end"))}
                  <div class="length">${t("length")}: <b>${length != null ? formatDuration(length) : "–"}</b></div>
                </div>

                ${gaps
                  ? html`<div class="note warn">
                      ${t("warn_gaps", { covered: formatDuration(covered), length: formatDuration(length) })}
                    </div>`
                  : nothing}

                <div class="row actions">
                  <input
                    class="name"
                    type="text"
                    .value=${this._name || ""}
                    placeholder=${t("name")}
                    @input=${(e) => (this._name = e.target.value)}
                  />
                  <button class="primary" ?disabled=${this._busy} @click=${this._download}><ha-icon icon="mdi:download"></ha-icon>${t("download")}</button>
                  <button class="tonal" ?disabled=${this._busy} @click=${this._save}><ha-icon icon="mdi:content-save-outline"></ha-icon>${t("save")}</button>
                </div>
              `
            : nothing}
          ${this._status ? html`<div class="status ${this._status.kind}">${this._status.text}</div>` : nothing}
        </div>
      </ha-card>
    `;
  }

  _markRow(which, label, value, setLabel) {
    return html`<div class="mark">
      <span class="label">${label}</span>
      <button class="tonal set" @click=${() => this._setMark(which)}>
        <ha-icon icon=${which === "start" ? "mdi:ray-start-arrow" : "mdi:ray-end-arrow"}></ha-icon>${setLabel}
      </button>
      <div class="nudges" role="group">
        <button @click=${() => this._nudge(which, -5)}>−5s</button>
        <button @click=${() => this._nudge(which, -1)}>−1s</button>
        <button class="time" title=${value != null ? "▶" : ""} @click=${() => this._seek(value)}>
          ${value != null ? formatTime(value, this._tz, this._locale) : "––:––:––"}
        </button>
        <button @click=${() => this._nudge(which, 1)}>+1s</button>
        <button @click=${() => this._nudge(which, 5)}>+5s</button>
      </div>
    </div>`;
  }

  static styles = css`
    .body {
      padding: 0 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: end;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1 1 160px;
      font-size: 0.85rem;
      color: var(--secondary-text-color);
    }
    select,
    input.name {
      font: inherit;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
    }
    .hours {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 4px;
    }
    .hours .hour {
      height: 32px;
      padding: 0;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--disabled-text-color);
    }
    .hours .hour.has {
      background: color-mix(in srgb, var(--primary-color) 18%, transparent);
      color: var(--primary-text-color);
      cursor: pointer;
    }
    .hours .hour.events {
      border-color: var(--warning-color, #ffa600);
    }
    .hours .hour.active {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .player {
      position: relative;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      width: 100%;
    }
    .player.empty {
      aspect-ratio: 16 / 9;
    }
    video {
      width: 100%;
      height: auto;
      max-height: 65vh;
      display: block;
      object-fit: contain;
    }
    .player.empty video {
      visibility: hidden;
    }
    .placeholder {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 16px;
      text-align: center;
      color: #ddd;
    }
    .nav {
      justify-content: space-between;
      align-items: center;
    }
    .window {
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
    }
    .body {
      container-type: inline-size;
    }
    /* One grid for both rows so the label, button and nudge columns line up. */
    .marks {
      display: grid;
      grid-template-columns: max-content max-content max-content;
      align-items: center;
      gap: 8px 10px;
    }
    .mark {
      display: contents;
    }
    .marks .set {
      width: 100%;
    }
    .marks .length {
      grid-column: 1 / -1;
    }
    @container (max-width: 560px) {
      .marks {
        grid-template-columns: 1fr auto;
        row-gap: 6px;
      }
      .marks .set {
        width: auto;
      }
      .nudges {
        grid-column: 1 / -1;
        display: flex;
        width: 100%;
        margin-bottom: 6px;
      }
      .nudges button {
        flex: 1 1 0;
        padding: 0 4px;
      }
      .nudges .time {
        flex: 2 1 0;
        min-width: 0;
      }
      .actions .name {
        flex: 1 1 100%;
      }
      .actions button {
        flex: 1 1 0;
      }
      .nav .window {
        display: none;
      }
    }
    .mark .label {
      color: var(--secondary-text-color);
    }
    button {
      font: inherit;
      font-size: 0.9rem;
      font-weight: 500;
      height: 36px;
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border: none;
      border-radius: 18px;
      background: var(--secondary-background-color, rgba(127, 127, 127, 0.12));
      color: var(--primary-text-color);
      cursor: pointer;
      transition: background-color 0.15s, filter 0.15s;
      -webkit-tap-highlight-color: transparent;
    }
    button:hover:not(:disabled) {
      filter: brightness(0.95);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button ha-icon {
      --mdc-icon-size: 18px;
    }
    button.primary {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    button.tonal {
      background: color-mix(in srgb, var(--primary-color) 16%, transparent);
      color: var(--primary-color);
    }
    button.ghost {
      background: transparent;
      color: var(--primary-color);
      padding: 0 8px;
    }
    button.ghost:hover:not(:disabled) {
      background: color-mix(in srgb, var(--primary-color) 10%, transparent);
      filter: none;
    }
    .nudges {
      display: inline-flex;
      border-radius: 18px;
      overflow: hidden;
      background: var(--secondary-background-color, rgba(127, 127, 127, 0.12));
    }
    .nudges button {
      border-radius: 0;
      height: 34px;
      padding: 0 10px;
      background: transparent;
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
    }
    .nudges button + button {
      border-left: 1px solid var(--divider-color);
    }
    .nudges button:hover {
      background: color-mix(in srgb, var(--primary-color) 10%, transparent);
      filter: none;
    }
    .nudges .time {
      min-width: 92px;
      font-weight: 600;
      color: var(--primary-text-color);
    }
    button:focus-visible,
    select:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .length {
      color: var(--secondary-text-color);
    }
    .actions {
      align-items: center;
    }
    .actions .name {
      flex: 1 1 180px;
      height: 36px;
      box-sizing: border-box;
      border-radius: 18px;
      padding: 0 14px;
    }
    .note,
    .status {
      font-size: 0.9rem;
      color: var(--secondary-text-color);
    }
    .warn,
    .status.warn {
      color: var(--warning-color, #ffa600);
    }
    .status.error {
      color: var(--error-color, #db4437);
    }
    .status.ok {
      color: var(--success-color, #43a047);
    }
  `;
}

customElements.define("frigate-clip-card", FrigateClipCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "frigate-clip-card",
  name: "Frigate Clip Card",
  description: "Pick a Frigate recording, trim it and download it or save it as a Frigate export.",
  preview: false,
  documentationURL: "https://github.com/gdarko/frigate-clip-card",
});

console.info(`%c FRIGATE-CLIP-CARD %c ${VERSION} `, "background:#03a9f4;color:#fff", "background:#fff;color:#000");
