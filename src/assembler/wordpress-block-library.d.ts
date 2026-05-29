// Minimal ambient declaration for `@wordpress/block-library`. The package ships
// no bundled types and the `@types/wordpress__block-library` package lags the
// pinned 9.x version, so we declare only the single symbol the assembler uses —
// `registerCoreBlocks`, which registers the core block types the serializer
// oracle needs (see wp-runtime.ts). Keeping this surface tiny avoids coupling to
// a possibly-mismatched third-party type package.
declare module "@wordpress/block-library" {
  /** Registers all core block types. Must run after a DOM exists. */
  export function registerCoreBlocks(): void;
}
