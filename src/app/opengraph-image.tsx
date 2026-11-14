import { ImageResponse } from "next/og";
import { GAME_NAME_PARTS } from "@/game/config";
import { bannerLine, ogAlt } from "@/game/copy";

// Rendered once at build time and served as a static PNG.
export const dynamic = "force-static";
export const alt = ogAlt();
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
        <div style={{ display: "flex", gap: 44, marginBottom: 36 }}>
          <div style={{ width: 30, height: 14, borderRadius: 14, backgroundColor: "#ffb866", boxShadow: "0 0 40px 12px rgba(255,170,80,0.7)" }} />
          <div style={{ width: 30, height: 14, borderRadius: 14, backgroundColor: "#ffb866", boxShadow: "0 0 40px 12px rgba(255,170,80,0.7)" }} />
        </div>
        <div style={{ display: "flex", fontSize: 132, fontWeight: 700, letterSpacing: 34, marginRight: -34, color: "#e6c65a", lineHeight: 1 }}>
          {GAME_NAME_PARTS[0].toUpperCase()}
        </div>
        <div style={{ display: "flex", fontSize: 46, fontWeight: 600, letterSpacing: 30, marginRight: -30, marginTop: 14, color: "#e6c65a" }}>
          {GAME_NAME_PARTS[1].toUpperCase()}
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
        <div style={{ display: "flex", fontSize: 34, letterSpacing: 6, marginTop: 40, color: "#ded6c6" }}>
          {bannerLine()}
        </div>
        <div style={{ display: "flex", fontSize: 30, marginTop: 20, color: "#a39cae" }}>
          A daily parry, scored to the millisecond. No two days alike.
        </div>
      </div>
    ),
    size,
  );
}
