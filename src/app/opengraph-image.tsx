import { ImageResponse } from "next/og";

// Rendered once at build time and served as a static PNG.
export const dynamic = "force-static";
export const alt = "Deflect: the daily parry. One foe, five strikes, one tap each.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#060508",
          backgroundImage:
            "radial-gradient(circle at 50% 115%, rgba(226,112,58,0.35), rgba(6,5,8,0) 55%), radial-gradient(circle at 50% 0%, rgba(70,60,86,0.55), rgba(6,5,8,0) 60%)",
          color: "#ded6c6",
        }}
      >
        <div style={{ display: "flex", gap: 44, marginBottom: 46 }}>
          <div style={{ width: 30, height: 14, borderRadius: 14, backgroundColor: "#ffb866", boxShadow: "0 0 40px 12px rgba(255,170,80,0.7)" }} />
          <div style={{ width: 30, height: 14, borderRadius: 14, backgroundColor: "#ffb866", boxShadow: "0 0 40px 12px rgba(255,170,80,0.7)" }} />
        </div>
        <div style={{ display: "flex", fontSize: 150, fontWeight: 700, letterSpacing: 36, marginRight: -36, color: "#e6c65a" }}>
          DEFLECT
        </div>
        <div
          style={{
            width: 760,
            height: 4,
            marginTop: 26,
            backgroundImage: "linear-gradient(90deg, rgba(212,175,55,0), #f6e4a8 50%, rgba(212,175,55,0))",
            boxShadow: "0 0 24px 4px rgba(255,200,90,0.6)",
          }}
        />
        <div style={{ display: "flex", fontSize: 40, letterSpacing: 8, marginTop: 44, color: "#ded6c6" }}>
          ONE FOE · FIVE STRIKES · ONE TAP EACH
        </div>
        <div style={{ display: "flex", fontSize: 30, marginTop: 20, color: "#a39cae" }}>
          A daily parry, scored to the millisecond
        </div>
      </div>
    ),
    size,
  );
}
