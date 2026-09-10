import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#5e8f75", color: "white", fontSize: 98, fontWeight: 700, fontFamily: "serif", borderRadius: 38 }}>
      M
    </div>,
    size,
  );
}
