import { Link } from "@tanstack/react-router";
import type { jsPDF as JsPDF } from "jspdf";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowLeft,
  Download,
  Laptop,
  Monitor,
  RefreshCw,
  Search,
  Settings2,
  Wifi,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { usePrintAgent } from "@/hooks/usePrintAgent";
import {
  DEFAULT_PRINT_CALIBRATION,
  printCalibrationKey,
  readLegacyCalibration,
  readPrintCalibration,
  type CalibrationDocumentType,
  type PersistedCalibrationDocumentType,
  type PrintCalibration,
} from "@/lib/printCalibration";
import { loadPrintCalibration } from "@/lib/printCalibrationData";

export interface PrintCalibrationContextValue {
  calibration: PrintCalibration;
  buildPdf?: (calibration: PrintCalibration) => Promise<JsPDF | null> | JsPDF | null;
  printerModel: "standard" | "epson-l121";
  setPrinterModel: (model: "standard" | "epson-l121") => void;
}

export const PrintCalibrationContext = createContext<PrintCalibrationContextValue>({
  calibration: DEFAULT_PRINT_CALIBRATION,
  printerModel: "standard",
  setPrinterModel: () => {},
});

export function usePrintCalibrationContext() {
  return useContext(PrintCalibrationContext);
}

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
  hideDownloadPdf = false,
  hideDownloadExcel = false,
  directPrintJob,
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
  hideDownloadPdf?: boolean;
  hideDownloadExcel?: boolean;
  directPrintJob?: { identifier: string; label?: string; jobData?: unknown };
  children: ReactNode;
  calibrationDocument?: CalibrationDocumentType;
}) {
  const [pdfAction, setPdfAction] = useState<"download" | "direct" | null>(null);
  const printAgent = usePrintAgent();
  const [customHostInput, setCustomHostInput] = useState(printAgent.host);
  useEffect(() => {
    setCustomHostInput(printAgent.host);
  }, [printAgent.host]);

  const [printerModel, setPrinterModel] = useState<"standard" | "epson-l121">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("print_target_printer_model");
      if (saved === "standard" || saved === "epson-l121") return saved;
    }
    return "standard";
  });

  const handlePrinterModelChange = (model: "standard" | "epson-l121") => {
    setPrinterModel(model);
    if (typeof window !== "undefined") {
      localStorage.setItem("print_target_printer_model", model);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("print_target_printer_model")) {
      const defaultPrn = printAgent.defaultPrinter || "";
      if (/l121|l120/i.test(defaultPrn)) {
        setPrinterModel("epson-l121");
      }
    }
  }, [printAgent.defaultPrinter]);

  const [calibration, setCalibration] = useState<PrintCalibration>(DEFAULT_PRINT_CALIBRATION);
  const [, setCalibrationLoading] = useState(!!calibrationDocument);
  useEffect(() => {
    if (!calibrationDocument) return;
    if (!isPersisted(calibrationDocument)) {
      setCalibration(readPrintCalibration(printCalibrationKey(calibrationDocument)));
      setCalibrationLoading(false);
      return;
    }
    let active = true;
    setCalibrationLoading(true);
    loadPrintCalibration(calibrationDocument)
      .then((saved) => {
        if (active)
          setCalibration(
            saved ?? readLegacyCalibration(calibrationDocument) ?? DEFAULT_PRINT_CALIBRATION,
          );
      })
      .catch((error) => {
        console.warn("Print calibration storage is unavailable; using default alignment.", error);
        if (active)
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

  return (
    <div
      className="print-shell min-h-screen bg-slate-100 p-6"
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

          .print-actions, .print-agent-alert {
            display: none !important;
          }

          .print-document {
            box-shadow: none !important;
          }
        }

        .print-calibration-frame .print-document,
        .print-calibration-frame .quotation-print-document {
          transform: translate(calc(var(--print-calibration-x, 0) * 1mm), calc(var(--print-calibration-y, 0) * 1mm));
        }
      `}</style>

      {/* Polished offline notice placed at the top */}
      {directPrintJob && printAgent.isRunning === false ? (
        <div className="print-agent-alert mx-auto mb-3.5 flex max-w-[8.5in] flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-200/90 bg-amber-50/95 px-4 py-2.5 shadow-xs text-xs text-amber-950 backdrop-blur-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-200/80 text-amber-800">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-amber-950">Direct Print Helper is offline</p>
              <p className="text-[11px] text-amber-800/85">
                Launch the print helper on your computer to enable instant 1-click printing.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-300/80 bg-white/90 hover:bg-white text-amber-900 shadow-2xs"
              onClick={async () => {
                const connected = await printAgent.checkStatus();
                if (connected) {
                  toast.success("Print helper connected!");
                } else {
                  toast.error("Could not connect to print helper.");
                }
              }}
              disabled={printAgent.checking}
            >
              <RefreshCw
                className={`h-3 w-3 mr-1.5 ${printAgent.checking ? "animate-spin" : ""}`}
              />
              Check again
            </Button>
            {(() => {
              const isClientMac =
                typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent);
              const downloadHref = isClientMac
                ? "/Automate DirectPrint-mac.zip"
                : "/Automate DirectPrint.exe";
              const downloadName = isClientMac
                ? "Automate DirectPrint-mac.zip"
                : "Automate DirectPrint.exe";
              return (
                <Button
                  asChild
                  size="sm"
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-2xs"
                >
                  <a href={downloadHref} download={downloadName}>
                    <Download className="h-3 w-3 mr-1.5" />
                    Download Helper
                  </a>
                </Button>
              );
            })()}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-amber-800/70 hover:bg-amber-100 hover:text-amber-950"
                  title="Network settings"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3 text-xs">
                <p className="font-semibold text-foreground mb-1">Network Settings</p>
                <p className="text-[11px] text-muted-foreground mb-2">
                  If the print helper is running on another device or Tailscale, enter its IP
                  address:
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    defaultValue={printAgent.host}
                    placeholder="e.g. 192.168.1.50"
                    className="h-7 flex-1 rounded border border-input bg-background px-2 font-mono text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        printAgent.updateHost((e.target as HTMLInputElement).value);
                      }
                    }}
                    onBlur={(e) => {
                      if (e.target.value !== printAgent.host) {
                        printAgent.updateHost(e.target.value);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => {
                      const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                        ?.value;
                      if (input) printAgent.updateHost(input);
                    }}
                  >
                    Save
                  </Button>
                </div>
                <div className="mt-2.5 pt-2 border-t border-border/60">
                  <a
                    href={`http://${printAgent.host || "127.0.0.1"}:18890`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center text-[11px] text-amber-900 font-medium hover:underline gap-1"
                  >
                    Open Print Helper Control Panel →
                  </a>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      ) : null}

      {/* Update notification when running print agent is older than v2.4 */}
      {directPrintJob &&
      printAgent.isRunning &&
      printAgent.version &&
      !printAgent.version.includes("2.4") ? (
        <div className="print-agent-alert mx-auto mb-3.5 flex max-w-[8.5in] flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-blue-200/90 bg-blue-50/95 px-4 py-2.5 shadow-xs text-xs text-blue-950 backdrop-blur-xs">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-200/80 text-blue-800">
              <Download className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-blue-950">
                Print Helper Update Available (Running v{printAgent.version} → Latest v2.4)
              </p>
              <p className="text-[11px] text-blue-800/85">
                Close your currently running print helper and download the new version to apply the latest text wrapping &amp; layout alignment.
              </p>
            </div>
          </div>
          <Button
            asChild
            size="sm"
            className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-2xs shrink-0"
          >
            <a
              href={
                typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent)
                  ? "/Automate DirectPrint-mac.zip"
                  : "/Automate DirectPrint.exe"
              }
              download={
                typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent)
                  ? "Automate DirectPrint-mac.zip"
                  : "Automate DirectPrint.exe"
              }
            >
              <Download className="h-3 w-3 mr-1.5" />
              Download v2.4 Helper
            </a>
          </Button>
        </div>
      ) : null}

      <div className="print-actions mx-auto mb-4 flex max-w-[8.5in] items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to={backTo as never} params={backParams as never} search={backSearch as never}>
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {directPrintJob ? (
            <div className="flex items-center gap-1.5">
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs text-xs">
                <button
                  type="button"
                  onClick={() => handlePrinterModelChange("standard")}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    printerModel === "standard"
                      ? "bg-slate-900 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  title="Standard Center-Feed Printers (Epson L1210, Canon G2010, HP, etc.)"
                >
                  Standard (Center)
                </button>
                <button
                  type="button"
                  onClick={() => handlePrinterModelChange("epson-l121")}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    printerModel === "epson-l121"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                  title="Epson L120 / L121 Series (Right-edge feed, top-loaded)"
                >
                  Epson L120 / L121 (Right)
                </button>
              </div>

              {/* Print Helper Connection & Network Settings Popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-9 px-2.5 text-xs font-medium gap-1.5 border shadow-2xs transition-colors ${
                      printAgent.isRunning && printAgent.isWindows
                        ? "border-emerald-300 bg-emerald-50/80 text-emerald-950 hover:bg-emerald-100"
                        : printAgent.isRunning
                          ? "border-amber-300 bg-amber-50/80 text-amber-950 hover:bg-amber-100"
                          : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                    title={
                      printAgent.isRunning
                        ? `Connected to ${printAgent.isWindows ? "Windows PC" : "Local Mac"} (${printAgent.host})`
                        : "Print helper offline — click to configure IP or scan network"
                    }
                  >
                    {printAgent.isWindows ? (
                      <Monitor className="h-3.5 w-3.5 text-emerald-600" />
                    ) : printAgent.isRunning ? (
                      <Laptop className="h-3.5 w-3.5 text-amber-600" />
                    ) : (
                      <Wifi className="h-3.5 w-3.5 text-slate-400" />
                    )}
                    <span className="font-mono text-[11px] max-w-[130px] truncate">
                      {printAgent.isRunning
                        ? printAgent.isWindows
                          ? `Win: ${printAgent.host}`
                          : `Mac: ${printAgent.host}`
                        : printAgent.host === "127.0.0.1"
                          ? "Offline"
                          : `Offline: ${printAgent.host}`}
                    </span>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        printAgent.isRunning && printAgent.isWindows
                          ? "bg-emerald-500 ring-2 ring-emerald-200"
                          : printAgent.isRunning
                            ? "bg-amber-500 ring-2 ring-amber-200"
                            : "bg-rose-400"
                      }`}
                    />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-88 p-4 text-xs shadow-xl space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">Direct Print Helper</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        printAgent.isRunning && printAgent.isWindows
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : printAgent.isRunning
                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                            : "bg-rose-100 text-rose-800 border border-rose-300"
                      }`}
                    >
                      {printAgent.isRunning
                        ? printAgent.isWindows
                          ? "Windows Online"
                          : "macOS Online"
                        : "Offline"}
                    </span>
                  </div>

                  {/* Connected Details / Status summary */}
                  <div
                    className={`rounded-lg p-2.5 border text-xs space-y-1 ${
                      printAgent.isRunning && printAgent.isWindows
                        ? "bg-emerald-50/60 border-emerald-200 text-emerald-950"
                        : printAgent.isRunning
                          ? "bg-amber-50/60 border-amber-200 text-amber-950"
                          : "bg-muted/40 border-border text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {printAgent.isRunning
                          ? printAgent.isWindows
                            ? "Connected to Windows Print PC"
                            : "Connected to Local Mac (CUPS)"
                          : "Agent Not Reachable"}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 p-0"
                        onClick={() => void printAgent.checkStatus()}
                        disabled={printAgent.checking}
                        title="Recheck status"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${printAgent.checking ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </div>
                    <div className="text-[11px] opacity-90 font-mono">
                      {printAgent.host}:18890
                      {printAgent.defaultPrinter ? ` • ${printAgent.defaultPrinter}` : ""}
                    </div>
                    {printAgent.isRunning && !printAgent.isWindows && (
                      <p className="text-[10.5px] text-amber-800 mt-1 leading-snug">
                        ⚠️ If your physical printer (Epson L121) is plugged into a Windows PC, enter that PC's IP below or click Auto-Scan.
                      </p>
                    )}
                  </div>

                  {/* Manual IP input */}
                  <div>
                    <label className="text-[11px] font-medium text-foreground block mb-1">
                      Print Helper PC IP / Hostname:
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={customHostInput}
                        onChange={(e) => setCustomHostInput(e.target.value)}
                        placeholder="e.g. 192.168.1.50 or Tailscale IP"
                        className="h-8 flex-1 rounded border border-input bg-background px-2.5 font-mono text-xs focus:outline-hidden focus:ring-1 focus:ring-primary"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customHostInput.trim()) {
                            printAgent.updateHost(customHostInput.trim());
                            toast.info(`Connecting to ${customHostInput.trim()}...`);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        className="h-8 text-xs shrink-0"
                        onClick={() => {
                          if (customHostInput.trim()) {
                            printAgent.updateHost(customHostInput.trim());
                            toast.info(`Connecting to ${customHostInput.trim()}...`);
                          }
                        }}
                      >
                        Connect
                      </Button>
                    </div>
                  </div>

                  {/* Auto-Scan Network */}
                  <div className="space-y-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-8 text-xs gap-1.5 border-dashed"
                      onClick={async () => {
                        toast.info("Scanning local subnet for Automate DirectPrint agents...");
                        const found = await printAgent.scanNetwork();
                        if (found.length > 0) {
                          toast.success(`Found ${found.length} print helper(s)! Connected to ${found[0].host}.`);
                        } else {
                          toast.warning("No print helpers found on local subnet. Make sure Automate DirectPrint.exe is running on the PC.");
                        }
                      }}
                      disabled={printAgent.scanning}
                    >
                      <Search className={`h-3.5 w-3.5 ${printAgent.scanning ? "animate-spin" : ""}`} />
                      {printAgent.scanning
                        ? printAgent.scanProgress
                          ? `Scanning ${printAgent.scanProgress.subnet} (${printAgent.scanProgress.current}/${printAgent.scanProgress.total})...`
                          : "Scanning local network..."
                        : "🔍 Auto-Scan Local Network for Print PC"}
                    </Button>

                    {/* Discovered Agents List */}
                    {printAgent.discoveredAgents.length > 0 && (
                      <div className="mt-2 space-y-1 max-h-36 overflow-y-auto rounded-md border border-border/80 bg-muted/20 p-1.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase px-1">
                          Discovered Agents:
                        </span>
                        {printAgent.discoveredAgents.map((agent) => {
                          const isActive = agent.host === printAgent.host;
                          return (
                            <div
                              key={agent.host}
                              className={`flex items-center justify-between p-1.5 rounded text-xs transition-colors ${
                                isActive ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/60"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {agent.info.isWindows ? (
                                  <Monitor className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <Laptop className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                )}
                                <div className="truncate">
                                  <span className="font-mono font-medium">{agent.host}</span>
                                  <span className="text-[10px] text-muted-foreground ml-1">
                                    ({agent.info.isWindows ? "Windows" : "macOS"})
                                  </span>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant={isActive ? "secondary" : "outline"}
                                className="h-6 text-[11px] px-2"
                                onClick={() => {
                                  printAgent.updateHost(agent.host);
                                  setCustomHostInput(agent.host);
                                }}
                                disabled={isActive}
                              >
                                {isActive ? "Active" : "Use"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Shortcuts & Links */}
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
                    <button
                      type="button"
                      className="hover:underline text-primary"
                      onClick={() => {
                        printAgent.updateHost("127.0.0.1");
                        setCustomHostInput("127.0.0.1");
                      }}
                    >
                      Use Localhost
                    </button>
                    <a
                      href={`http://${printAgent.host || "127.0.0.1"}:18890`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline inline-flex items-center gap-0.5 text-primary"
                    >
                      Open Control Panel →
                    </a>
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                variant={printAgent.isRunning ? "default" : "secondary"}
                disabled={pdfAction !== null}
                onClick={async () => {
                  if (!printAgent.isRunning) {
                    toast.error(
                      "Direct Print Agent is offline. Please launch Automate DirectPrint.exe on your computer or connect to its IP.",
                      {
                        duration: 5000,
                      },
                    );
                    return;
                  }
                  if (printerModel === "epson-l121" && !printAgent.isWindows) {
                    toast.warning(
                      `Direct Print is currently connected to macOS (${printAgent.host}). The Epson L121 spooler requires Windows. Please connect to your Windows PC IP.`,
                      { duration: 6000 },
                    );
                  }
                  if (printAgent.supported === false) {
                    toast.error(
                      `Direct Print is not supported on ${printAgent.platform || "this OS"}.`,
                    );
                    return;
                  }
                  setPdfAction("direct");
                  try {
                    await printAgent.sendToPrinter({
                      identifier: directPrintJob.identifier,
                      jobData: {
                        ...(typeof directPrintJob.jobData === "object" && directPrintJob.jobData !== null
                          ? directPrintJob.jobData
                          : {}),
                        printerModel,
                      },
                      printerModel,
                      calibration: calibrationDocument ? calibration : undefined,
                    });
                    toast.success(
                      printerModel === "epson-l121"
                        ? "Print job sent to Epson L121 right-feeder spooler!"
                        : "Print job sent directly to printer spooler!",
                    );
                  } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : "Could not print via agent.");
                  } finally {
                    setPdfAction(null);
                  }
                }}
                className="gap-1.5"
              >
                <Zap className="h-4 w-4" />
                {pdfAction === "direct"
                  ? "Sending..."
                  : printAgent.isRunning && printAgent.supported !== false
                    ? `Direct Print (${printerModel === "epson-l121" ? "Epson L121" : "Ready"})`
                    : printAgent.isRunning && printAgent.supported === false
                      ? `Direct Print (Unsupported: ${printAgent.platform})`
                      : "Direct Print"}
                <span
                  className={`ml-1 inline-block h-2 w-2 rounded-full ${
                    printAgent.isRunning && printAgent.supported !== false
                      ? "bg-emerald-400 ring-2 ring-emerald-300"
                      : printAgent.isRunning && printAgent.supported === false
                        ? "bg-red-400"
                        : "bg-amber-400"
                  }`}
                  title={
                    printAgent.isRunning
                      ? `Agent connected at ${printAgent.host} (${printAgent.spoolerEngine || printAgent.platform || "Ready"})`
                      : "Agent offline"
                  }
                />
              </Button>
            </div>
          ) : null}
          {!hideDownloadPdf ? (
            <Button variant="outline" onClick={downloadPdf} disabled={pdfAction !== null}>
              <Download className="h-4 w-4" />{" "}
              {pdfAction === "download" ? "Preparing..." : "Download PDF"}
            </Button>
          ) : null}
          {!hideDownloadExcel && downloadExcel ? (
            <Button variant="outline" onClick={downloadExcel}>
              Download Excel
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="print-calibration-frame mx-auto max-w-[8.5in] flex justify-center"
        style={
          {
            "--print-calibration-x": calibration.page.xMm,
            "--print-calibration-y": calibration.page.yMm,
          } as CSSProperties
        }
      >
        <PrintCalibrationContext.Provider
          value={{
            calibration,
            buildPdf: buildGeneratedPdf,
            printerModel,
            setPrinterModel: handlePrinterModelChange,
          }}
        >
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
