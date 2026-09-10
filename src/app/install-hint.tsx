"use client";

import { useEffect, useState } from "react";

export function InstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    const check = window.setTimeout(() => setVisible(isIos && !standalone && !sessionStorage.getItem("mori-install-hint-dismissed")), 0);
    return () => window.clearTimeout(check);
  }, []);

  if (!visible) return null;

  return <aside className="install-hint" role="status"><div><strong>Install Mori</strong><span>Tap Share, then Add to Home Screen for the app view.</span></div><button onClick={() => { sessionStorage.setItem("mori-install-hint-dismissed", "true"); setVisible(false); }} aria-label="Dismiss install hint">×</button></aside>;
}
