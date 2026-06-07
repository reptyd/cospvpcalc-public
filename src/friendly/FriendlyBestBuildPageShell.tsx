import { useEffect } from "react";
import type { BuildOptions, CreatureRuntime } from "../engine";
import type { AppPage } from "../AppPageRouter";
import { buildWizardSteps, FriendlyBestBuildResults, FriendlyBestBuildWizard } from "./FriendlyBestBuildFlow";
import { useFriendlyBestBuildController } from "./useFriendlyBestBuildController";
import type { FriendlyBestBuildAnswers, FriendlyShellPage } from "./friendlyTypes";

export function FriendlyBestBuildPageShell({
  mode,
  creatures,
  selectedBestBuildCreature,
  selectedBestBuildData,
  answers,
  setAnswers,
  bestBuildStep,
  setBestBuildStep,
  eligibleForAirRule,
  tierOptions,
  getCreatureIcon,
  onNameAChange,
  onBuildAChange,
  onSwitchToAdvanced,
  onPageChange,
}: {
  mode: "wizard" | "result";
  creatures: CreatureRuntime[];
  selectedBestBuildCreature: string;
  selectedBestBuildData?: CreatureRuntime;
  answers: FriendlyBestBuildAnswers;
  setAnswers: (value: FriendlyBestBuildAnswers) => void;
  bestBuildStep: number;
  setBestBuildStep: (value: number) => void;
  eligibleForAirRule: boolean;
  tierOptions: number[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onBuildAChange: (build: BuildOptions) => void;
  onSwitchToAdvanced: (page?: AppPage) => void;
  onPageChange: (page: FriendlyShellPage) => void;
}) {
  const friendlyBestBuild = useFriendlyBestBuildController({
    nameA: selectedBestBuildCreature,
    creatures,
  });

  useEffect(() => {
    if (friendlyBestBuild.isRunning && mode !== "result") {
      onPageChange("bestBuildResult");
    }
  }, [friendlyBestBuild.isRunning, mode, onPageChange]);

  const bestBuildRunInFlight = friendlyBestBuild.pendingRun !== null || friendlyBestBuild.isRunning;
  const currentResultBuild = friendlyBestBuild.topResults[0]?.build ?? null;

  const runFriendlyBestBuild = () => {
    onNameAChange(selectedBestBuildCreature);
    friendlyBestBuild.startFriendlyRun(answers);
    onPageChange("bestBuildResult");
  };

  const wizardSteps = buildWizardSteps({
    answers,
    eligibleForAirRule,
    creatureName: selectedBestBuildCreature,
    currentResultBuild,
    tierOptions,
    onAnswersChange: setAnswers,
    onRun: runFriendlyBestBuild,
  });

  if (mode === "wizard") {
    return (
      <FriendlyBestBuildWizard
        selectedCreatureName={selectedBestBuildCreature}
        selectedCreature={selectedBestBuildData}
        getCreatureIcon={getCreatureIcon}
        bestBuildStep={bestBuildStep}
        setBestBuildStep={setBestBuildStep}
        wizardSteps={wizardSteps}
        answers={answers}
        onBack={() => onPageChange("bestBuildSelect")}
      />
    );
  }

  return (
    <FriendlyBestBuildResults
      runInFlight={bestBuildRunInFlight}
      progress={friendlyBestBuild.progress}
      topResults={friendlyBestBuild.topResults}
      runtimeRequirementError={friendlyBestBuild.runtimeRequirementError}
      answers={answers}
      engineMode={friendlyBestBuild.engineIntent?.mode ?? "standard"}
      selectedCreatureName={selectedBestBuildCreature}
      getCreatureIcon={getCreatureIcon}
      onApplyToBattle={(build) => {
        onBuildAChange(build);
        onPageChange("battle");
      }}
      onOpenAdvanced={(build) => {
        onBuildAChange(build);
        onNameAChange(selectedBestBuildCreature);
        onSwitchToAdvanced("compare");
      }}
      onBack={() => onPageChange("bestBuildWizard")}
    />
  );
}
