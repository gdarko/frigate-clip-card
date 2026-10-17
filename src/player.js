import Hls from "hls.js";

// Plays a signed Frigate VOD playlist proxied by Home Assistant. The integration checks that every
// segment request carries the playlist's authSig, so it is appended to segment URLs as well.
export class VodPlayer {
  constructor(video) {
    this.video = video;
    this.hls = null;
  }

  load(signedPlaylistUrl) {
    this.destroy();
    const sig = new URL(signedPlaylistUrl, window.location.origin).searchParams.get("authSig");
    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        xhrSetup: (xhr, url) => {
          if (sig && !url.includes("authSig=")) {
            xhr.open("GET", `${url}${url.includes("?") ? "&" : "?"}authSig=${encodeURIComponent(sig)}`, true);
          }
        },
      });
      this.hls.loadSource(signedPlaylistUrl);
      this.hls.attachMedia(this.video);
      return;
    }
    // Native HLS (older Safari): segments may be rejected without authSig; best effort.
    this.video.src = signedPlaylistUrl;
  }

  onError(cb) {
    if (this.hls) {
      this.hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data?.fatal) cb(data);
      });
    }
  }

  destroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.removeAttribute("src");
  }
}
