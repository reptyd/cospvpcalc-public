import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { SpeedBuildsSetupControls } from "./SpeedBuildsSetupControls";

type SpeedBuildsControlPanelProps = {
  controller: SpeedBuildsController;
  nameA: string;
  creatureNames: string[];
  onNameAChange: (value: string) => void;
  getCreatureIcon: (name: string) => string | null;
};

export function SpeedBuildsControlPanel(props: SpeedBuildsControlPanelProps) {
  return (
    <div className="panel-block">
      <SpeedBuildsSetupControls {...props} />
    </div>
  );
}
