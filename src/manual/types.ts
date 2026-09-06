/**
 * Core manual descriptor, shared by the CLI entry point and the downloaders.
 *
 * This lives in its own module rather than in src/index.ts because that file
 * runs the CLI on import: anything importing `Manual` from there would execute
 * the whole program as a side effect. TypeScript happened to elide the
 * type-only import under CommonJS, but Node's native type stripping performs no
 * type analysis and would keep it.
 */
export interface Manual {
  // Path prefix / downloader selector. "em" -> modern EWD (ewdappu); all other
  // types share the generic "<type>/<id>/toc.xml" format and route through the
  // generic/legacy downloader: "rm" -> repair manual, "bm" -> body manual,
  // "ewd" -> older wiring diagram, "atm" -> automatic transmission manual,
  // "cr" -> collision/body repair manual, "ncf" -> new car features,
  // "whr" -> wire harness repair manual. The last four are common on older
  // vehicles, which split content across several standalone publications.
  type: "em" | "rm" | "bm" | "ewd" | "atm" | "cr" | "ncf" | "whr";
  id: string; // e.g. EM1234
  year?: number; // e.g. 2019
  raw: string; // e.g. EM1234@2019
}
