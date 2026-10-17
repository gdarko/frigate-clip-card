import { LitElement, html } from "lit";

// Visual editor built on Home Assistant's own form element.
const SCHEMA = [
  { name: "title", selector: { text: {} } },
  {
    name: "cameras",
    selector: { entity: { multiple: true, filter: { domain: "camera", integration: "frigate" } } },
  },
  { name: "default_camera", selector: { entity: { filter: { domain: "camera", integration: "frigate" } } } },
  {
    name: "language",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "auto", label: "Auto (Home Assistant profile)" },
          { value: "mk", label: "Македонски" },
          { value: "en", label: "English" },
        ],
      },
    },
  },
  { name: "max_length_minutes", selector: { number: { min: 1, max: 240, mode: "box", unit_of_measurement: "min" } } },
];

const LABELS = {
  title: "Title",
  cameras: "Cameras (empty = all Frigate cameras)",
  default_camera: "Default camera",
  language: "Language",
  max_length_minutes: "Maximum clip length",
};

class FrigateClipCardEditor extends LitElement {
  static properties = { hass: { attribute: false }, _config: { state: true } };

  setConfig(config) {
    this._config = config;
  }

  render() {
    if (!this.hass || !this._config) return html``;
    return html`<ha-form
      .hass=${this.hass}
      .data=${this._config}
      .schema=${SCHEMA}
      .computeLabel=${(s) => LABELS[s.name] ?? s.name}
      @value-changed=${(e) => {
        const config = { ...e.detail.value };
        if (Array.isArray(config.cameras) && !config.cameras.length) delete config.cameras;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      }}
    ></ha-form>`;
  }
}

customElements.define("frigate-clip-card-editor", FrigateClipCardEditor);
