import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { SpeedBuildsConstraintControls } from "./SpeedBuildsConstraintControls";

export function SpeedBuildsConstraintPanel({ controller }: { controller: SpeedBuildsController }) {
  return (
    <div className="panel-block">
      <h3>Constraints</h3>
      <SpeedBuildsConstraintControls controller={controller} />
    </div>
  );
}
