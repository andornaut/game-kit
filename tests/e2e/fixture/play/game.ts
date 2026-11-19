// The game's code, which the page imports once launch resolves "play", as a game's boot loader
// imports its main chunk. Its hashed URL changes with each code variant, so a document importing
// another build's chunk gets a 404 instead of the active build's code.
declare const __VARIANT__: string;

export const GAME_VARIANT = __VARIANT__;
