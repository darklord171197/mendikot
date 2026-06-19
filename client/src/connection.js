import { useEffect, useState } from "react";
import { socket } from "./socket";

let appListenerAttached = false;
function attachResumeListener() {
  if (appListenerAttached) return;
  appListenerAttached = true;

  import("@capacitor/app")
    .then(({ App }) => {
      App.addListener("resume", () => {
        if (!socket.connected) socket.connect();
      });
    })
    .catch(() => {
      // Not running under Capacitor (plain web) — ignore.
    });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !socket.connected) socket.connect();
  });
}

export function useConnectionStatus() {
  const [connected, setConnected] = useState(socket.connected);
  const [disconnectedAt, setDisconnectedAt] = useState(null);

  useEffect(() => {
    attachResumeListener();
    const onConnect = () => { setConnected(true); setDisconnectedAt(null); };
    const onDisconnect = () => { setConnected(false); setDisconnectedAt(Date.now()); };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (!socket.connected) setDisconnectedAt((prev) => prev || Date.now());
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return { connected, disconnectedAt };
}

export function retryConnection() {
  if (!socket.connected) socket.connect();
}
