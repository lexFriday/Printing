import { Link } from "@tanstack/react-router";
import type { jsPDF as JsPDF } from "jspdf";
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PrintCalibrationPanel } from "@/components/print/PrintCalibrationPanel";
import {
  DEFAULT_PRINT_CALIBRATION,
  legacyCalibrationKey,
  printCalibrationKey,
  readLegacyCalibration,
  readPrintCalibration,
  savePrintCalibration,
  type CalibrationDocumentType,
  type PersistedCalibrationDocumentType,
  type PrintCalibration,
} from "@/lib/printCalibration";
import {
  loadPrintCalibration,
  resetPrintCalibration,
  savePrintCalibrationForUser,
} from "@/lib/printCalibrationData";

const PrintCalibrationContext = createContext<{
  calibration: PrintCalibration;
  buildPdf?: (calibration: PrintCalibration) => Promise<JsPDF | null> | JsPDF | null;
}>({ calibration: DEFAULT_PRINT_CALIBRATION });

export function PrintShell({
  backTo,
  backParams,
  backSearch,
  backLabel,
  pdfFileName = "document.pdf",
  pdfPageSize = "letter",
  pageCssSize = "Letter",
  printProfile,
  printWithGeneratedPdf = false,
  buildGeneratedPdf,
  buildGeneratedPrintPdf,
  downloadExcel,
  children,
  calibrationDocument,
}: {
  backTo: string;
  backParams?: Record<string, string>;
  backSearch?: Record<string, unknown>;
  backLabel: string;
  pdfFileName?: string;
  pdfPageSize?: string | readonly number[];
  pageCssSize?: string;
  printProfile?: {
    mediaWidthIn: number;
    mediaHeightIn: number;
    orientation: "portrait" | "landscape";
    scalePercent: number;
    marginsIn: number;
    fitToPage: boolean;
    centerOnPage: boolean;
  };
  printWithGeneratedPdf?: boolean;
  buildGeneratedPdf?: (calibration: PrintCalibration) => Promise<JsPDF | null> | JsPDF | null;
  buildGeneratedPrintPdf?: (calibration: PrintCalibration) => Promise<JsPDF | null> | JsPDF | null;
  downloadExcel?: () => void;
  children: ReactNode;
  calibrationDocument?: CalibrationDocumentType;
}) {
  const [pdfAction, setPdfAction] = useState<"download" | "print" | null>(null);
  const [calibration, setCalibration] = useState<PrintCalibration>(DEFAULT_PRINT_CALIBRATION);
  const [calibrationLoading, setCalibrationLoading] = useState(!!calibrationDocument),
    [calibrationSaving, setCalibrationSaving] = useState(false),
    [calibrationSaved, setCalibrationSaved] = useState(true),
    [draftValid, setDraftValid] = useState(true);
  const editVersion = useRef(0);
  useEffect(() => {
    if (!calibrationDocument) return;
    if (!isPersisted(calibrationDocument)) {
      setCalibration(readPrintCalibration(printCalibrationKey(calibrationDocument)));
      setCalibrationLoading(false);
      return;
    }
    let active = true;
    const version = editVersion.current;
    setCalibrationLoading(true);
    loadPrintCalibration(calibrationDocument)
      .then((saved) => {
        if (active && version === editVersion.current)
          setCalibration(
            saved ?? readLegacyCalibration(calibrationDocument) ?? DEFAULT_PRINT_CALIBRATION,
          );
      })
      .catch((error) => {
        console.warn("Print calibration storage is unavailable; using default alignment.", error);
        if (active && version === editVersion.current)
          setCalibration(readLegacyCalibration(calibrationDocument) ?? DEFAULT_PRINT_CALIBRATION);
      })
      .finally(() => active && setCalibrationLoading(false));
    return () => {
      active = false;
    };
  }, [calibrationDocument]);

  async function buildPdf(forPrint = false) {
    const generatedPdfBuilder = forPrint
      ? (buildGeneratedPrintPdf ?? buildGeneratedPdf)
      : buildGeneratedPdf;
    if (generatedPdfBuilder) {
      const pdf = await generatedPdfBuilder(calibration);
      if (pdf) applyPdfCalibration(pdf, calibration);
      return pdf;
    }

    const element = document.querySelector(".print-document") as HTMLElement | null;
    if (!element) {
      toast.error("Could not find the printable document.");
      return null;
    }

    const { default: jsPDF } = await import("jspdf");
    const { default: html2canvas } = await import("html2canvas");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const restoreImages = await inlinePrintImages(element);
    const captureFrame = preparePdfCaptureFrame(element);
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(captureFrame.target, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
    } finally {
      captureFrame.cleanup();
      restoreImages();
    }
    const pdf = new jsPDF(
      "p",
      "pt",
      typeof pdfPageSize === "string" ? pdfPageSize : ([...pdfPageSize] as number[]),
    );
    addCanvasToPdf(pdf, canvas);
    return pdf;
  }

  async function downloadPdf() {
    setPdfAction("download");
    try {
      const pdf = await buildPdf();
      if (pdf) pdf.save(safePdfName(pdfFileName));
    } catch (error) {
      console.error(error);
      toast.error(pdfDownloadErrorMessage(error));
    } finally {
      setPdfAction(null);
    }
  }

  async function printGeneratedPdf() {
    setPdfAction("print");
    try {
      const pdf = await buildPdf(true);
      if (!pdf) return;
      pdf.autoPrint({ variant: "non-conform" });
      const url = URL.createObjectURL(pdf.output("blob"));
      writePdfViewer(window, url, safePdfName(pdfFileName), { autoPrint: true });
    } catch (error) {
      console.error(error);
      toast.error(pdfDownloadErrorMessage(error));
    } finally {
      setPdfAction(null);
    }
  }

  function handlePrint() {
    if (downloadExcel) {
      downloadExcel();
      return;
    }
    if (printWithGeneratedPdf) {
      void printGeneratedPdf();
      return;
    }
    window.print();
  }

  return (
    <div
      className={`print-shell min-h-screen bg-slate-100 p-6 ${calibrationDocument ? "calibration-layout" : ""}`}
      data-print-profile={printProfile ? JSON.stringify(printProfile) : undefined}
    >
      <style>{`
        @page {
          size: ${pageCssSize};
          margin: 0;
        }

        .print-document, .print-document * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .print-table th, .print-table td {
          border: 1px solid #111;
        }

        .print-table tr {
          break-inside: avoid;
        }

        @media print {
          html, body {
            background: white !important;
          }

          .print-shell {
            min-height: auto !important;
            padding: 0 !important;
            background: white !important;
          }

          .print-actions {
            display: none !important;
          }

          .print-document {
            box-shadow: none !important;
          }
        }

        @media (min-width: 1024px) {
          .calibration-layout { display: grid; grid-template-columns: minmax(340px, 380px) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
          .calibration-layout > .print-actions { grid-column: 1 / -1; max-width: none; }
          .calibration-layout > .calibration-controls { grid-column: 1; grid-row: 2; display: block; width: auto; max-width: none; margin: 0; }
          .calibration-layout > .print-calibration-frame { grid-column: 2; grid-row: 2; min-width: 0; }
        }

        .print-calibration-frame .print-document,
        .print-calibration-frame .quotation-print-document {
          transform: translate(calc(var(--print-calibration-x, 0) * 1mm), calc(var(--print-calibration-y, 0) * 1mm));
        }
      `}</style>
      <div className="print-actions mx-auto mb-4 flex max-w-[8.5in] items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to={backTo as never} params={backParams as never} search={backSearch as never}>
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={downloadPdf} disabled={pdfAction !== null}>
            <Download className="h-4 w-4" />{" "}
            {pdfAction === "download" ? "Preparing..." : "Download PDF"}
          </Button>
          {downloadExcel ? (
            <Button variant="outline" onClick={downloadExcel}>
              Download Excel
            </Button>
          ) : null}
          <Button onClick={handlePrint} disabled={pdfAction !== null}>
            <Printer className="h-4 w-4" />
            {pdfAction === "print" ? "Preparing..." : downloadExcel ? "Print in Excel" : "Print"}
          </Button>
        </div>
      </div>
      {calibrationDocument ? (
        <div className="calibration-controls mx-auto mb-4 max-w-[12in]">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
            <PrintCalibrationPanel
              documentType={calibrationDocument}
              value={calibration}
              loading={calibrationLoading}
              saving={calibrationSaving}
              saved={calibrationSaved}
              onDraftChange={(next, valid) => {
                editVersion.current += 1;
                setDraftValid(valid);
                if (valid) {
                  setCalibration(next);
                  setCalibrationSaved(false);
                }
              }}
              onSave={() => {
                if (!draftValid) return;
                if (!isPersisted(calibrationDocument)) {
                  savePrintCalibration(printCalibrationKey(calibrationDocument), calibration);
                  setCalibrationSaved(true);
                  return;
                }
                setCalibrationSaving(true);
                savePrintCalibrationForUser(calibrationDocument, calibration)
                  .then((saved) => {
                    setCalibration(saved);
                    setCalibrationSaved(true);
                    localStorage.removeItem(legacyCalibrationKey(calibrationDocument));
                    toast.success("Print setup saved.");
                  })
                  .catch((error) => {
                    console.error(error);
                    toast.error("Print setup was not saved. Your changes are still here.");
                  })
                  .finally(() => setCalibrationSaving(false));
              }}
              onReset={() => {
                if (!window.confirm("Reset this print setup to its original alignment?")) return;
                editVersion.current += 1;
                setCalibration(DEFAULT_PRINT_CALIBRATION);
                setCalibrationSaved(true);
                localStorage.removeItem(legacyCalibrationKey(calibrationDocument));
                if (isPersisted(calibrationDocument))
                  void resetPrintCalibration(calibrationDocument).catch(() =>
                    toast.error("The saved setup could not be reset."),
                  );
                else localStorage.removeItem(printCalibrationKey(calibrationDocument));
              }}
              onTestPrint={handlePrint}
            />
          </div>
        </div>
      ) : null}
      <div
        className="print-calibration-frame"
        style={
          {
            "--print-calibration-x": calibration.page.xMm,
            "--print-calibration-y": calibration.page.yMm,
          } as CSSProperties
        }
      >
        <PrintCalibrationContext.Provider value={{ calibration, buildPdf: buildGeneratedPdf }}>
          {children}
        </PrintCalibrationContext.Provider>
      </div>
    </div>
  );
}

export function GeneratedPdfPreview({
  pdfArtifact,
  title,
  pageSizeIn,
}: {
  pdfArtifact: Promise<JsPDF>;
  title: string;
  pageSizeIn: { width: number; height: number };
}) {
  const calibrationContext = useContext(PrintCalibrationContext);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const pdf = calibrationContext.buildPdf
          ? await calibrationContext.buildPdf(calibrationContext.calibration)
          : await pdfArtifact;
        if (!pdf) throw new Error("PDF preview is unavailable.");
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const document = await pdfjs.getDocument({
          data: new Uint8Array(pdf.output("arraybuffer")),
        }).promise;
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 96 / 72 });
        const canvas = canvasRef.current;
        if (!active || !canvas) throw new Error("PDF preview canvas is unavailable.");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) throw new Error("Unable to create PDF preview canvas.");
        await page.render({ canvas, canvasContext, viewport }).promise;
        if (active) setStatus("ready");
      } catch (error) {
        console.error("Unable to render PDF preview", error);
        if (active) setStatus("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [pdfArtifact, calibrationContext]);

  const pageStyle = {
    height: `${pageSizeIn.height}in`,
    width: `${pageSizeIn.width}in`,
  };

  if (status === "error") {
    return (
      <div
        className="print-document mx-auto flex items-center justify-center bg-white text-sm text-muted-foreground"
        style={pageStyle}
      >
        Preview unavailable. Use Download PDF to inspect the generated page.
      </div>
    );
  }

  return (
    <div className="mx-auto aspect-[8.5/5.5] w-full max-w-[8.5in] overflow-hidden bg-white">
      <div className="flex h-full w-full items-center justify-center">
        <canvas
          ref={canvasRef}
          aria-label={title}
          className="print-document block max-h-full max-w-full bg-white object-contain"
          style={pageStyle}
        />
        {status === "loading" ? <span className="sr-only">Preparing preview...</span> : null}
      </div>
    </div>
  );
}

function writePdfViewer(
  target: Window,
  url: string,
  fileName: string,
  options: { autoPrint?: boolean } = {},
) {
  const title = escapeHtml(fileName.replace(/\.pdf$/i, ""));
  const safeUrl = escapeAttribute(url);
  const iframePrintHandler = options.autoPrint
    ? ` onload="setTimeout(function(){try{this.contentWindow.focus();this.contentWindow.print();}catch(error){}}, 250)"`
    : "";
  target.document.open();
  target.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
        background: #ffffff;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: 0;
      }

      .fallback {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        color: #111827;
        font: 14px Arial, Helvetica, sans-serif;
      }

      .fallback a {
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        padding: 10px 14px;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <iframe src="${safeUrl}" title="${title}"${iframePrintHandler}></iframe>
    <noscript>
      <div class="fallback">
        <a href="${safeUrl}" download="${escapeAttribute(fileName)}">Download PDF</a>
      </div>
    </noscript>
  </body>
</html>`);
  target.document.close();
}

function addCanvasToPdf(pdf: JsPDF, canvas: HTMLCanvasElement) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pageCanvasHeight = Math.ceil((canvas.width * pageHeight) / pageWidth);
  const pageCanvas = document.createElement("canvas");
  const context = pageCanvas.getContext("2d");
  if (!context) throw new Error("Could not prepare PDF canvas.");

  pageCanvas.width = canvas.width;

  let sourceY = 0;
  while (sourceY < canvas.height) {
    const sliceHeight = Math.min(pageCanvasHeight, canvas.height - sourceY);
    pageCanvas.height = sliceHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    context.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      sliceHeight,
    );

    if (sourceY > 0) pdf.addPage();
    const imageHeight = (sliceHeight * pageWidth) / canvas.width;
    pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, imageHeight);
    sourceY += sliceHeight;
  }
}

function applyPdfCalibration(pdf: JsPDF, calibration: PrintCalibration) {
  if (calibration.page.xMm === 0 && calibration.page.yMm === 0) return;

  const pointsPerMm = 72 / 25.4;
  const x = calibration.page.xMm * pointsPerMm;
  const y = -calibration.page.yMm * pointsPerMm;
  const pages = (pdf.internal as unknown as { pages?: unknown[] }).pages;
  if (!pages) return;

  for (let pageNumber = 1; pageNumber < pages.length; pageNumber += 1) {
    const page = pages[pageNumber];
    if (!Array.isArray(page)) continue;
    page.unshift("q", `1 0 0 1 ${x} ${y} cm`);
    page.push("Q");
  }
}

function safePdfName(value: string) {
  const clean = value
    .replace(/\.pdf$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${clean || "document"}.pdf`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

async function inlinePrintImages(root: HTMLElement) {
  const originals = new Map<HTMLImageElement, string>();
  const images = Array.from(root.querySelectorAll("img"));

  await Promise.all(
    images.map(async (image) => {
      const source = image.currentSrc || image.src;
      if (!source || source.startsWith("data:")) return;

      originals.set(image, image.src);
      const dataUrl = await imageToDataUrl(source);
      image.src = dataUrl;
      await waitForImage(image);
    }),
  );

  return () => {
    originals.forEach((src, image) => {
      image.src = src;
    });
  };
}

async function imageToDataUrl(src: string) {
  const response = await fetch(src);
  if (!response.ok) throw new Error("Unable to load print image.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function waitForImage(image: HTMLImageElement) {
  if (image.complete) return;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to render print image."));
  });
}

function preparePdfCaptureFrame(source: HTMLElement) {
  const rect = source.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height || source.scrollHeight);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.border = "0";
  document.body.appendChild(frame);

  const frameDocument = frame.contentDocument;
  if (!frameDocument) {
    frame.remove();
    throw new Error("Unable to prepare PDF capture frame.");
  }

  frameDocument.open();
  frameDocument.write(
    '<!doctype html><html><head><meta charset="utf-8" /></head><body></body></html>',
  );
  frameDocument.close();
  frameDocument.body.style.margin = "0";
  frameDocument.body.style.background = "#ffffff";

  const clone = source.cloneNode(true) as HTMLElement;
  copyRenderedStyles(source, clone);
  forcePdfCaptureBounds(clone, width, height);
  forcePdfSafeTextRendering(clone);
  forcePrintCaptureColors(clone);
  frameDocument.body.appendChild(clone);

  return {
    target: clone,
    cleanup: () => frame.remove(),
  };
}

function forcePdfCaptureBounds(root: HTMLElement, width: number, height: number) {
  root.style.position = "relative";
  root.style.display = "block";
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.minWidth = `${width}px`;
  root.style.minHeight = `${height}px`;
  root.style.margin = "0";
  root.style.transform = "none";
  root.style.boxShadow = "none";
}

function copyRenderedStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  for (const property of computed) {
    (target as HTMLElement).style.setProperty(
      property,
      sanitizeCaptureStyle(property, computed.getPropertyValue(property)),
      computed.getPropertyPriority(property),
    );
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) copyRenderedStyles(child, targetChild);
  });
}

function sanitizeCaptureStyle(property: string, value: string) {
  if (!/\b(?:lab|lch|oklab|oklch)\(/i.test(value)) return value;
  if (property.includes("background")) return "transparent";
  if (property.includes("border")) return "#000000";
  return "#000000";
}

function forcePrintCaptureColors(root: HTMLElement) {
  root.style.background = "#ffffff";
  root.style.color = "#000000";
  root.style.boxShadow = "none";

  root.querySelectorAll<HTMLElement>(".print-title-bar").forEach((element) => {
    element.style.background = "#332f91";
    element.style.color = "#ffffff";
  });

  root.querySelectorAll<HTMLElement>(".print-table th").forEach((element) => {
    element.style.background = "#000000";
    element.style.color = "#ffffff";
  });
}

function forcePdfSafeTextRendering(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    element.style.fontFamily = "Arial, Helvetica, sans-serif";
    element.style.fontKerning = "none";
    element.style.letterSpacing = "0";
    element.style.textRendering = "auto";
    element.style.wordSpacing = "normal";
  });
}

function pdfDownloadErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  if (detail.includes("capture") || detail.includes("render")) {
    return "The PDF could not be prepared. Nothing was saved. Try again, and check the document before printing.";
  }
  return "The PDF could not be prepared. Nothing was saved. Please try again.";
}

function isPersisted(value: CalibrationDocumentType): value is PersistedCalibrationDocumentType {
  return (
    value === "invoice" ||
    value === "delivery-receipt" ||
    value === "check-voucher" ||
    value === "check"
  );
}
