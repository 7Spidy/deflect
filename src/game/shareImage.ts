import { MISS_WINDOW_MS, PERFECT_WINDOW_MS } from "./config";
import {
  biasOf,
  biasSentence,
  GRADE_TITLES,
  gradeFor,
  runScore,
  type StrikeResult,
} from "./scoring";

export interface ShareImageInput {
  puzzle: number;
  bossName: string;
  results: readonly StrikeResult[];
  siteLabel: string;
}

export function scoreColor(score: number): string {
  if (score >= 95) return "#f3dc9a";
  if (score >= 75) return "#9fc27a";
  if (score >= 40) return "#e2703a";
  return "#6f6878";
}

function cssFont(variable: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

/** Draws the 1200x630 result card. Returns null if the canvas cannot export. */
export async function renderShareImage(input: ShareImageInput): Promise<File | null> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const display = cssFont("--font-cinzel", "serif");
  const body = cssFont("--font-garamond", "serif");
  try {
    await Promise.all([
      document.fonts.load(`700 100px ${display}`),
      document.fonts.load(`400 40px ${body}`),
    ]);
  } catch {
    // fall back to whatever is available
  }

  const score = runScore(input.results);
  const grade = gradeFor(score);

  ctx.fillStyle = "#060508";
  ctx.fillRect(0, 0, W, H);
  const top = ctx.createRadialGradient(W / 2, -60, 0, W / 2, -60, 700);
  top.addColorStop(0, "rgba(70,60,86,0.6)");
  top.addColorStop(1, "rgba(6,5,8,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H);
  const ember = ctx.createRadialGradient(W / 2, H + 120, 0, W / 2, H + 120, 620);
  ember.addColorStop(0, "rgba(226,112,58,0.32)");
  ember.addColorStop(1, "rgba(6,5,8,0)");
  ctx.fillStyle = ember;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#d4af37";
  ctx.font = `700 44px ${display}`;
  ctx.fillText("D E F L E C T", 70, 96);
  ctx.textAlign = "right";
  ctx.fillStyle = "#a39cae";
  ctx.font = `400 34px ${body}`;
  ctx.fillText(`No. ${input.puzzle}  ·  ${input.bossName}`, W - 70, 94);

  // Grade
  ctx.textAlign = "left";
  const gold = ctx.createLinearGradient(0, 150, 0, 380);
  gold.addColorStop(0, "#f6e4a8");
  gold.addColorStop(0.55, "#d4af37");
  gold.addColorStop(1, "#8a6a1e");
  ctx.fillStyle = gold;
  ctx.shadowColor = "rgba(212,175,55,0.4)";
  ctx.shadowBlur = 40;
  ctx.font = `900 250px ${display}`;
  ctx.fillText(grade, 70, 360);
  const gradeWidth = ctx.measureText(grade).width;
  ctx.shadowBlur = 0;

  const tx = 70 + gradeWidth + 50;
  ctx.fillStyle = "#f3dc9a";
  ctx.font = `700 60px ${display}`;
  ctx.fillText(GRADE_TITLES[grade].toUpperCase(), tx, 250);
  ctx.fillStyle = "#ded6c6";
  ctx.font = `400 44px ${body}`;
  ctx.fillText(`Score ${score} of 100`, tx, 312);
  ctx.fillStyle = "#a39cae";
  ctx.font = `italic 400 36px ${body}`;
  ctx.fillText(biasSentence(biasOf(input.results)), tx, 362);

  // Timeline
  const x0 = 110;
  const x1 = W - 110;
  const mid = (x0 + x1) / 2;
  const y = 468;
  const scale = (x1 - x0) / 2 / MISS_WINDOW_MS;
  ctx.fillStyle = "rgba(212,175,55,0.22)";
  ctx.fillRect(mid - PERFECT_WINDOW_MS * scale, y - 44, PERFECT_WINDOW_MS * 2 * scale, 88);
  ctx.strokeStyle = "rgba(222,214,198,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.strokeStyle = "#d4af37";
  ctx.beginPath();
  ctx.moveTo(mid, y - 52);
  ctx.lineTo(mid, y + 52);
  ctx.stroke();
  ctx.fillStyle = "#a39cae";
  ctx.font = `400 28px ${body}`;
  ctx.textAlign = "left";
  ctx.fillText("300ms early", x0, y + 80);
  ctx.textAlign = "right";
  ctx.fillText("300ms late", x1, y + 80);
  ctx.textAlign = "center";
  ctx.fillText("impact", mid, y + 80);

  // Dots stagger over 6 rows of 12 px so any number of strikes stays on the axis.
  const dot = input.results.length > 12 ? 7 : 11;
  input.results.forEach((r, i) => {
    if (r.offset === null) return;
    const clamped = Math.max(-MISS_WINDOW_MS, Math.min(MISS_WINDOW_MS, r.offset));
    const x = mid + clamped * scale;
    const yy = y - 30 + (i % 6) * 12;
    ctx.fillStyle = scoreColor(r.score);
    ctx.shadowColor = scoreColor(r.score);
    ctx.shadowBlur = r.score >= 95 ? 18 : 0;
    ctx.beginPath();
    ctx.arc(x, yy, dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  ctx.textAlign = "right";
  ctx.fillStyle = "#a39cae";
  ctx.font = `400 28px ${body}`;
  ctx.fillText(input.siteLabel, W - 70, H - 26);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return null;
  return new File([blob], `deflect-${input.puzzle}.png`, { type: "image/png" });
}
