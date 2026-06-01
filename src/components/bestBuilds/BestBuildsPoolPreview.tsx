import { creatureByName, getCreatureIcon } from "../../engine/creatureData";
import { IconImg } from "../IconImg";

type BestBuildsPoolPreviewProps = {
  activePool: string[];
};

export function BestBuildsPoolPreview({ activePool }: BestBuildsPoolPreviewProps) {
  return (
    <div className="panel-block optimizer-results-block">
      <h3>Pool preview ({activePool.length})</h3>
      {activePool.length === 0 ? <div className="muted">No creatures in pool.</div> : null}
      {activePool.length > 0 ? (
        <div className="pool-preview-list" role="region" aria-label="Pool preview" tabIndex={0}>
          {activePool.map((name) => {
            const creatureRow = creatureByName[name];
            return (
              <div key={name} className="pool-preview-item">
                <IconImg src={getCreatureIcon(name)} alt={name} size={26} />
                <span className="pool-name">{name}</span>
                <span className="pool-tier">T{creatureRow?.stats.tier ?? "?"}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
