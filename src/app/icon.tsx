import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#5e8f75", color: "white", fontSize: 280, fontWeight: 700, fontFamily: "serif", borderRadius: 104 }}>
      M
    </div>,
    size,
  );
}
