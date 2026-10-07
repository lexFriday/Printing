import type { jsPDF as JsPDF } from "jspdf";
import type { CalibrationOffset } from "@/lib/printCalibration";

type PrintUnit = "cm" | "in";
type TextAlign = "left" | "right" | "center";

const CM_TO_PT = 28.3464566929;
const IN_TO_PT = 72;

export function fitPreprintedFontSize(
  text: string,
  maxWidth: number,
  baseSize: number,
  minSize: number,
  measure: (value: string, size: number) => number = (value, size) => value.length * size * 0.52,
) {
  const value = text.trim();
  for (let size = baseSize; size >= minSize; size -= 0.5) {
    if (measure(value, size) <= maxWidth) return size;
  }
  return minSize;
}

export function drawPreprintedText(
  pdf: JsPDF,
  {
    text,
    top,
    left,
    right,
    width,
    pageWidth,
    unit,
    align = "left",
    size = 10,
    minSize,
    fitToWidth = false,
    offset,
  }: {
    text: string | number | null | undefined;
    top: number;
    left?: number;
    right?: number;
    width: number;
    pageWidth: number;
    unit: PrintUnit;
    align?: TextAlign;
    size?: number;
    minSize?: number;
    fitToWidth?: boolean;
    offset?: CalibrationOffset;
  },
) {
  const raw = `${text ?? ""}`.trim();
  if (!raw) return;

  const fieldWidth = toPt(width, unit);
  pdf.setFont("helvetica", "bold");
  const fittedSize = fitToWidth
    ? fitPreprintedFontSize(
        raw.toUpperCase(),
        fieldWidth,
        size,
        minSize ?? size,
        (value, nextSize) => {
          pdf.setFontSize(nextSize);
          return pdf.getTextWidth(value);
        },
      )
    : size;
  pdf.setFontSize(fittedSize);
  pdf.setTextColor(0, 0, 0);

  const value = trimToWidth(pdf, raw.toUpperCase(), fieldWidth);
  const x = textX({ left: left === undefined ? undefined : left + (offset?.xMm ?? 0) / (unit === "in" ? 25.4 : 10), right: right === undefined ? undefined : right - (offset?.xMm ?? 0) / (unit === "in" ? 25.4 : 10), width, pageWidth, unit, align });
  const y = toPt(top + (offset?.yMm ?? 0) / (unit === "in" ? 25.4 : 10), unit) + fittedSize * 0.75;
  pdf.text(value, x, y, { align });
}

function textX({
  left,
  right,
  width,
  pageWidth,
  unit,
  align,
}: {
  left?: number;
  right?: number;
  width: number;
  pageWidth: number;
  unit: PrintUnit;
  align: TextAlign;
}) {
  if (right !== undefined) return pageWidth - toPt(right, unit);
  const leftPt = toPt(left ?? 0, unit);
  const widthPt = toPt(width, unit);
  if (align === "right") return leftPt + widthPt;
  if (align === "center") return leftPt + widthPt / 2;
  return leftPt;
}

function trimToWidth(pdf: JsPDF, text: string, maxWidth: number) {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let output = text;
  while (output.length > 0 && pdf.getTextWidth(output) > maxWidth) {
    output = output.slice(0, -1);
  }
  return output.trimEnd();
}

function toPt(value: number, unit: PrintUnit) {
  return value * (unit === "cm" ? CM_TO_PT : IN_TO_PT);
}
