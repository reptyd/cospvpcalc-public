import type { SpeedBuildsController } from "../../pages/useSpeedBuildsPageController";
import { SpeedBuildsBuffControls } from "./SpeedBuildsBuffControls";

export function SpeedBuildsBuffPanel({ controller }: { controller: SpeedBuildsController }) {
  return (
    <div className="panel-block">
      <h3>Buffs</h3>
      <SpeedBuildsBuffControls controller={controller} />
    </div>
  );
}
