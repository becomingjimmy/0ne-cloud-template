"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failed — silently ignore (e.g. localhost without HTTPS)
      });
    }
  }, []);

  return null;
}
