import { useEffect, useState } from "react";
import { useConnectionStatus, retryConnection } from "./connection";

export default function ConnectionBanner() {
  const { connected, disconnectedAt } = useConnectionStatus();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!disconnectedAt) { setSeconds(0); return; }
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - disconnectedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [disconnectedAt]);

  if (connected) return null;

  const longWait = seconds >= 15;

  return (
    <div className="conn-banner">
      <div className="conn-banner-row">
        <span className="conn-spinner" />
        <span>
          {longWait
            ? "Still trying to reconnect" + (seconds ? " (" + seconds + "s)" : "") + "…"
            : "Connection lost — reconnecting…"}
        </span>
      </div>
      {longWait && (
        <>
          <p className="conn-banner-hint">
            If you haven't played in a while, the server may be waking up from sleep — this can take up to a minute.
          </p>
          <button className="conn-retry-btn" onClick={retryConnection}>
            Retry now
          </button>
        </>
      )}
    </div>
  );
}
