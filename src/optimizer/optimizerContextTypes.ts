export type OptimizerContext = {
  healthRelevant: boolean;
  opponentStatusIds: Set<string>;
  opponentHasBleed: boolean;
  expectedTtk: number;
  relevantPlushies?: Set<string>;
  mode?: "solo" | "counter";
  soloMode?: "dummy" | "composite";
};
