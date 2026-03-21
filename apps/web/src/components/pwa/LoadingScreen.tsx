"use client";

import { useState, useEffect } from "react";

export function LoadingScreen() {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    // Only show once per session
    if (sessionStorage.getItem("0ne-splash-shown")) return;
    sessionStorage.setItem("0ne-splash-shown", "1");

    setVisible(true);
    // Start animation after a brief mount delay
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimating(true));
    });

    // Remove after animation completes (~1.9s total)
    const timer = setTimeout(() => setVisible(false), 1900);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "#FF692D",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: animating ? undefined : 1,
        animation: animating ? "splashFadeOut 0.4s ease-in 1.5s forwards" : undefined,
      }}
    >
      <div
        style={{
          position: "relative",
          opacity: animating ? undefined : 0,
          animation: animating ? "splashFadeInO 0.3s ease-out forwards" : undefined,
        }}
      >
        <span
          style={{
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontStyle: "italic",
            fontSize: "140px",
            color: "white",
            lineHeight: 1,
            display: "block",
          }}
        >
          O
        </span>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "4px",
            height: animating ? undefined : "0",
            background: "white",
            transform: "translate(-50%, -50%) rotate(20deg)",
            transformOrigin: "center center",
            borderRadius: "2px",
            animation: animating ? "splashSlashIn 0.5s ease-out 0.6s forwards" : undefined,
          }}
        />
      </div>

      <style>{`
        @keyframes splashFadeInO {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes splashSlashIn {
          0% { height: 0; opacity: 0; }
          20% { opacity: 1; }
          100% { height: 160px; opacity: 1; }
        }
        @keyframes splashFadeOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
