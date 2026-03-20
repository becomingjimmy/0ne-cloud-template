export default function OfflinePage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#F6F5F3",
        color: "#22201D",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "4rem",
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          color: "#FF692D",
          marginBottom: "1rem",
        }}
      >
        0ne
      </div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        You're offline
      </h1>
      <p style={{ color: "#666", maxWidth: "24rem" }}>
        Check your connection and try again.
      </p>
    </div>
  );
}
