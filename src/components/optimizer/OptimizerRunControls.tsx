import { formatRoundedPercent } from "../../shared/displayFormat";

type OptimizerRunControlsProps = {
  isRunning: boolean;
  progress: number;
  onRun: () => void;
  onCancel: () => void;
};

export function OptimizerRunControls({
  isRunning,
  progress,
  onRun,
  onCancel,
}: OptimizerRunControlsProps) {
  return (
    <>
      <button className="primary" onClick={onRun}>
        Run Optimizer
      </button>
      {isRunning && (
        <>
          <div className="note">Progress: {formatRoundedPercent(progress * 100)}</div>
          <button className="secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
    </>
  );
}
