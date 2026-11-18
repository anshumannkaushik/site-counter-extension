// Minimal background script (Firefox MV3 event page). All work is done
// from the popup; this file exists so the extension has a background
// context for future features.
var ql2BgApi = typeof browser !== "undefined" ? browser : chrome;
ql2BgApi.runtime.onInstalled && ql2BgApi.runtime.onInstalled.addListener(function () {});
