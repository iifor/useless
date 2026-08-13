import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { DesktopSeatTarget } from "./desktopSeat";

type SeatKind = DesktopSeatTarget["kind"];

export function SeatIcon({ kind }: { kind: SeatKind }) {
  const folder = kind === "folder";
  return <span aria-label={folder ? "文件夹座位" : "文件座位"} className={`seat-icon ${folder ? "folder" : "file"}`} />;
}

export function SeatTargetBubble() {
  const [kind, setKind] = useState<SeatKind>("file");
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = listen<{ kind: SeatKind }>("seat-target:update", (event) => setKind(event.payload.kind));
    return () => { void unlisten.then((dispose) => dispose()); };
  }, []);
  return <div className="seat-target-bubble"><SeatIcon kind={kind} /></div>;
}
