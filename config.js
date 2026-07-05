/* Optional baked-in configuration.

   You CANNOT commit a real Anthropic API key here — GitHub's secret
   scanning / push protection rejects any push that contains one, and a
   key on a public site would be abused and auto-revoked anyway.

   So leave apiKey empty here. Enter your key once in the app
   (Me → Coach), and it's saved on your device (localStorage) — you'll
   never be asked again on that device.

   If you self-host privately, you may paste a key below for convenience. */
window.COACH_CONFIG = {
  apiKey: "",
  model: "claude-opus-4-8",
};
