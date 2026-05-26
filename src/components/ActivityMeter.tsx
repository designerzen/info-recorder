import type { CSSProperties } from "react";

type ActivityMeterProps = {
  activityRms: number;
  silenceRms: number;
};

export function ActivityMeter({ activityRms, silenceRms }: ActivityMeterProps) {
  const meterMax = Math.max(0.001, silenceRms * 2.5, activityRms);
  const activityRatio = Math.min(1, activityRms / meterMax);
  const silenceMarker = Math.min(
    100,
    Math.round((silenceRms / meterMax) * 100)
  );
  const isUttering = activityRms >= silenceRms;
  const statusLabel = isUttering ? "Uttering" : "Listening";

  return (
    <div className="activity-level" data-uttering={isUttering} aria-label="Realtime source activity">
      <div className="activity-level-heading">
        <span className="utterance-status">
          <span className="utterance-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <span>{formatRms(activityRms)} RMS</span>
      </div>
      <div
        className="activity-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(activityRatio * 100)}
        aria-label={`Realtime source activity level. Active threshold ${formatRms(silenceRms)} RMS.`}
        style={
          {
            "--activity-level": `${Math.round(activityRatio * 100)}%`,
            "--silence-point": `${silenceMarker}%`
          } as CSSProperties
        }
      >
        <span />
        <i aria-hidden="true" />
      </div>
      <p className="activity-note">Active threshold: {formatRms(silenceRms)} RMS</p>
    </div>
  );
}

function formatRms(value: number) {
  return value.toFixed(3);
}
