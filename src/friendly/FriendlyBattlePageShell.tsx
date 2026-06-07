import type { BuildOptions, CreatureRuntime } from "../engine";
import type { AppPage } from "../AppPageRouter";
import { FriendlyBattleFlow } from "./FriendlyBattleFlow";
import { useFriendlyBattleController } from "./useFriendlyBattleController";
import type { FriendlyShellPage } from "./friendlyTypes";

export function FriendlyBattlePageShell({
  nameA,
  nameB,
  buildA,
  buildB,
  creatureA,
  creatureB,
  creatures,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
  onSwitchToAdvanced,
  onPageChange,
}: {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  creatures: CreatureRuntime[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (build: BuildOptions) => void;
  onBuildBChange: (build: BuildOptions) => void;
  onSwitchToAdvanced: (page?: AppPage) => void;
  onPageChange: (page: FriendlyShellPage) => void;
}) {
  const battle = useFriendlyBattleController({
    creatureA,
    creatureB,
    buildA,
    buildB,
  });

  return (
    <FriendlyBattleFlow
      nameA={nameA}
      nameB={nameB}
      buildA={buildA}
      buildB={buildB}
      creatures={creatures}
      getCreatureIcon={getCreatureIcon}
      onNameAChange={onNameAChange}
      onNameBChange={onNameBChange}
      onBuildAChange={onBuildAChange}
      onBuildBChange={onBuildBChange}
      onBack={() => onPageChange("home")}
      onOpenAdvanced={() => onSwitchToAdvanced("compare")}
      onSwapSides={() => {
        const nextNameA = nameB;
        const nextNameB = nameA;
        const nextBuildA = buildB;
        const nextBuildB = buildA;
        onNameAChange(nextNameA);
        onNameBChange(nextNameB);
        onBuildAChange(nextBuildA);
        onBuildBChange(nextBuildB);
      }}
      battle={battle}
    />
  );
}
