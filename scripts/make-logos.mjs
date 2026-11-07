/**
 * 로고 자산 생성 (기획서 2.2: 검정 배경에는 남색 부분을 흰색으로 바꾼 반전 로고)
 *  GUI/logo.png → public/logo.png (원본색, 투명 배경, 여백 제거)
 *               → public/logo-inverse.png (남색 → 흰색, 투명 배경)
 *  GUI/logo_icon.png → public/logo_icon.png (파비콘)
 *
 * 흰 배경 위 잉크 색을 역합성(alpha = (255 - p) / (255 - ink))해 가장자리까지 깨끗하게 분리한다.
 * ※ 공식 반전 로고 파일이 오면 public/logo-inverse.png 를 교체한다. (기획서 미결 4)
 */
import sharp from "sharp";
import { mkdirSync, copyFileSync } from "node:fs";

const NAVY = [2, 42, 95];
const TEAL = [3, 187, 182];
const WHITE = [255, 255, 255];

mkdirSync("public", { recursive: true });

const { data, info } = await sharp("GUI/logo.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const original = Buffer.alloc(data.length);
const inverse = Buffer.alloc(data.length);

function unblend(px, ink) {
  // 채널별 alpha 추정 후 평균, 잔차로 잉크 적합도 측정
  let sum = 0;
  let n = 0;
  for (let c = 0; c < 3; c++) {
    const denom = 255 - ink[c];
    if (denom > 30) {
      sum += (255 - px[c]) / denom;
      n++;
    }
  }
  const a = Math.min(1, Math.max(0, sum / n));
  let err = 0;
  for (let c = 0; c < 3; c++) err += Math.abs(a * ink[c] + (1 - a) * 255 - px[c]);
  return { a, err };
}

for (let i = 0; i < data.length; i += 4) {
  const px = [data[i], data[i + 1], data[i + 2]];
  const n = unblend(px, NAVY);
  const t = unblend(px, TEAL);
  const isNavy = n.err <= t.err;
  const a = isNavy ? n.a : t.a;
  const alpha = a < 0.02 ? 0 : Math.round(a * 255);
  const ink = isNavy ? NAVY : TEAL;
  const inkInv = isNavy ? WHITE : TEAL;
  for (let c = 0; c < 3; c++) {
    original[i + c] = ink[c];
    inverse[i + c] = inkInv[c];
  }
  original[i + 3] = alpha;
  inverse[i + 3] = alpha;
}

const raw = { raw: { width: info.width, height: info.height, channels: 4 } };
await sharp(original, raw).trim().resize({ height: 160 }).png().toFile("public/logo.png");
await sharp(inverse, raw).trim().resize({ height: 160 }).png().toFile("public/logo-inverse.png");
copyFileSync("GUI/logo_icon.png", "public/logo_icon.png");
console.log("public/logo.png, public/logo-inverse.png, public/logo_icon.png 생성 완료");
