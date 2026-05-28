// Host-language type mirror for the assembler and downstream tracks. These are
// the inferred Zod types re-exported as the canonical IR types — one source of
// truth (the schema), surfaced as plain TypeScript types.
export type {
  IR,
  IRNode,
  BlockNode,
  PatternRef,
  Region,
  DesignTokens,
  ParamSlot,
  QueryConfig,
} from "./schema";
