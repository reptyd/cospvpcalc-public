import { SpeedBuildsBreakdownPanel } from "../components/speedBuilds/SpeedBuildsBreakdownPanel";
import { SpeedBuildsBuffPanel } from "../components/speedBuilds/SpeedBuildsBuffPanel";
import { SpeedBuildsChannelPanel } from "../components/speedBuilds/SpeedBuildsChannelPanel";
import { SpeedBuildsConstraintPanel } from "../components/speedBuilds/SpeedBuildsConstraintPanel";
import { SpeedBuildsControlPanel } from "../components/speedBuilds/SpeedBuildsControlPanel";
import { SpeedBuildsRankingPanel } from "../components/speedBuilds/SpeedBuildsRankingPanel";
import { useSpeedBuildsPageController } from "./useSpeedBuildsPageController";
import "./speedBuilds.css";

export type SpeedBuildsPageProps = {
  nameA: string;
  creatureNames: string[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
};

export default function SpeedBuildsPage({
  nameA,
  creatureNames,
  getCreatureIcon,
  onNameAChange,
}: SpeedBuildsPageProps) {
  const controller = useSpeedBuildsPageController({ nameA, onNameAChange });

  return (
    <section className="panel speed-builds-page">
      <div className="layout-grid">
        <div className="panel-grid">
          <SpeedBuildsControlPanel
            controller={controller}
            nameA={nameA}
            creatureNames={creatureNames}
            onNameAChange={onNameAChange}
            getCreatureIcon={getCreatureIcon}
          />
          <SpeedBuildsBuffPanel controller={controller} />
          {/* Manual is assembled by hand, so there is nothing left for a
              constraint to narrow. */}
          {controller.mode === "optimize" ? <SpeedBuildsConstraintPanel controller={controller} /> : null}
        </div>
      </div>
      <div className="results-grid">
        {controller.mode === "optimize" ? <SpeedBuildsRankingPanel controller={controller} /> : null}
        <SpeedBuildsChannelPanel controller={controller} />
        {/* Optimize picked the build, so an effect-by-effect breakdown of it is
            trivia; Manual is where the reader changed something and wants the
            cause. */}
        {controller.mode === "manual" ? <SpeedBuildsBreakdownPanel controller={controller} /> : null}
      </div>
    </section>
  );
}
