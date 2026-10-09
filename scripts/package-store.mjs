import { build, Platform, Arch } from "electron-builder";

const identityName = process.env.STORE_APPX_IDENTITY_NAME?.trim();
const publisher = process.env.STORE_APPX_PUBLISHER?.trim();
const publisherDisplayName = process.env.STORE_APPX_PUBLISHER_DISPLAY_NAME?.trim();

if (!identityName) {
  throw new Error("Missing STORE_APPX_IDENTITY_NAME from the Microsoft Store app identity.");
}
if (!publisher) {
  throw new Error("Missing STORE_APPX_PUBLISHER from the Microsoft Store app identity.");
}
if (!publisherDisplayName) {
  throw new Error("Missing STORE_APPX_PUBLISHER_DISPLAY_NAME from the Microsoft Store app identity.");
}
if (identityName.length < 3 || identityName.length > 50 || !/^[A-Za-z0-9.-]+$/.test(identityName)) {
  throw new Error("STORE_APPX_IDENTITY_NAME is not a valid Store package identity name.");
}

await build({
  targets: Platform.WINDOWS.createTarget("appx", Arch.x64),
  config: {
    appx: {
      identityName,
      publisher,
      displayName: "DrawsyAI Companion",
      publisherDisplayName,
      languages: ["en-US"],
    },
  },
  publish: "never",
});
