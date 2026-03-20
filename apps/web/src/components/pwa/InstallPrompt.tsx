"use client";

import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "pwa-install-dismissed";
const DISMISS_DAYS = 7;

function isDismissed(): boolean {
  if (typeof window === "undefined") return true;
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return false;
  const dismissedAt = new Date(dismissed).getTime();
  const now = Date.now();
  return now - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    if (isIOS()) {
      setShowIOSPrompt(true);
      setVisible(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1rem",
        left: "1rem",
        right: "1rem",
        maxWidth: "28rem",
        margin: "0 auto",
        background: "#1C1B19",
        color: "white",
        borderRadius: "0.75rem",
        padding: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        zIndex: 9999,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <img
        src="/icons/icon-192x192.png"
        alt="0ne"
        width={40}
        height={40}
        style={{ borderRadius: "0.5rem", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>
          Install 0ne
        </div>
        <div style={{ fontSize: "0.75rem", color: "#999", marginTop: "0.125rem" }}>
          {showIOSPrompt
            ? "Tap Share, then \"Add to Home Screen\""
            : "Add to your home screen for quick access"}
        </div>
      </div>
      {!showIOSPrompt && deferredPrompt && (
        <button
          onClick={handleInstall}
          style={{
            background: "#FF692D",
            color: "white",
            border: "none",
            borderRadius: "0.375rem",
            padding: "0.5rem 1rem",
            fontWeight: 600,
            fontSize: "0.8125rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Install
        </button>
      )}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#666",
          fontSize: "1.25rem",
          cursor: "pointer",
          padding: "0.25rem",
          lineHeight: 1,
        }}
      >
        &times;
      </button>
    </div>
  );
}
