// The fixture game's router worker entry, built by precachePlugin like a game's.
import { runServiceWorker } from "../../../src/web/pwa/dom/serviceWorker.ts";
import { POLICY } from "./policy.ts";

runServiceWorker(POLICY);
