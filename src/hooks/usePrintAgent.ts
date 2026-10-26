import { useState, useEffect, useCallback, useRef } from "react";

const DEFAULT_PORT = 18890;

export interface AgentInfo {
  status?: string;
  platform?: string;
  supported?: boolean;
  spoolerEngine?: string;
  defaultPrinter?: string;
  printers?: string[];
  version?: string;
  isWindows?: boolean;
  isLocalhost?: boolean;
}

export interface DiscoveredAgent {
  host: string;
  info: AgentInfo;
}

export interface ScanProgress {
  current: number;
  total: number;
  subnet: string;
}

function cleanHost(h: string): string {
  return (h || "").trim().replace(/^https?:\/\//, "").replace(/:\d+$/, "");
}

export async function probeHost(
  candidateHost: string,
  timeoutMs = 2500,
): Promise<DiscoveredAgent | null> {
  const clean = cleanHost(candidateHost);
  if (!clean || clean === "0.0.0.0") return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${clean}:${DEFAULT_PORT}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as AgentInfo;
      if (data && (data.status === "running" || data.platform || data.supported !== undefined)) {
        const isWindows =
          data.platform === "win32" ||
          (typeof data.spoolerEngine === "string" && data.spoolerEngine.includes("Windows"));
        const isLocalhost = clean === "127.0.0.1" || clean === "localhost";
        return {
          host: clean,
          info: {
            ...data,
            isWindows: Boolean(isWindows),
            isLocalhost,
          },
        };
      }
    }
  } catch (err) {
    if (clean === "127.0.0.1" || clean === "localhost") {
      console.warn(`[PrintAgent] Health check unreachable at http://${clean}:${DEFAULT_PORT}:`, err);
    }
  }
  return null;
}

export function usePrintAgent() {
  const [host, setHost] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dr_print_agent_host") || "127.0.0.1";
    }
    return "127.0.0.1";
  });
  const [isRunning, setIsRunning] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [discoveredAgents, setDiscoveredAgents] = useState<DiscoveredAgent[]>([]);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const checkingRef = useRef(false);

  const getAgentUrl = (ip = host) => `http://${ip}:${DEFAULT_PORT}`;

  const checkStatus = useCallback(
    async (targetHost?: string) => {
      if (checkingRef.current) return isRunning === true;
      checkingRef.current = true;
      setChecking(true);

      const savedHost =
        typeof window !== "undefined" ? localStorage.getItem("dr_print_agent_host") : null;
      const activeHost = cleanHost(targetHost || savedHost || host || "127.0.0.1");

      const match = await probeHost(activeHost, 2500);

      if (match) {
        setIsRunning(true);
        setAgentInfo(match.info);
        if (match.host !== host) {
          setHost(match.host);
          localStorage.setItem("dr_print_agent_host", match.host);
        }
        checkingRef.current = false;
        setChecking(false);
        return true;
      }

      // If custom host was unreachable and wasn't localhost, attempt localhost fallback
      if (activeHost !== "127.0.0.1" && activeHost !== "localhost") {
        const localMatch = await probeHost("127.0.0.1", 1500);
        if (localMatch) {
          setIsRunning(true);
          setAgentInfo(localMatch.info);
          setHost("127.0.0.1");
          localStorage.setItem("dr_print_agent_host", "127.0.0.1");
          checkingRef.current = false;
          setChecking(false);
          return true;
        }
      }

      setIsRunning(false);
      setAgentInfo(null);
      checkingRef.current = false;
      setChecking(false);
      return false;
    },
    [host, isRunning],
  );

  // Subnet scan is ONLY triggered on user demand
  const scanNetwork = useCallback(
    async (customPrefix?: string) => {
      if (scanning) return discoveredAgents;
      setScanning(true);
      setScanProgress(null);
      const found: DiscoveredAgent[] = [];

      // Determine subnet to scan
      let prefix = customPrefix?.trim();
      if (!prefix) {
        const currentHostname = typeof window !== "undefined" ? window.location.hostname : "";
        const match = currentHostname.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)/);
        prefix = match ? match[1] : "192.168.1.";
      }
      if (!prefix.endsWith(".")) prefix += ".";

      // Also check known Windows tailscale peer if configured
      const quickCheck = await probeHost("100.69.135.112", 1000);
      if (quickCheck) {
        found.push(quickCheck);
        setDiscoveredAgents([quickCheck]);
      }

      // Scan target subnet in batches of 20 with 1000ms timeout
      const ipList: string[] = [];
      for (let i = 1; i <= 254; i++) {
        ipList.push(`${prefix}${i}`);
      }

      const chunkSize = 20;
      for (let i = 0; i < ipList.length; i += chunkSize) {
        setScanProgress({
          current: Math.min(i + chunkSize, ipList.length),
          total: ipList.length,
          subnet: prefix,
        });
        const chunk = ipList.slice(i, i + chunkSize);
        const results = await Promise.all(chunk.map((ip) => probeHost(ip, 1000)));
        for (const r of results) {
          if (r && !found.some((item) => item.host === r.host)) {
            found.push(r);
            setDiscoveredAgents((prev) => [...prev, r]);
          }
        }
      }

      setScanProgress(null);

      // If agents were found, pick Windows first
      if (found.length > 0) {
        const winAgent = found.find((f) => f.info.isWindows);
        const bestAgent = winAgent || found[0];
        setHost(bestAgent.host);
        localStorage.setItem("dr_print_agent_host", bestAgent.host);
        void checkStatus(bestAgent.host);
      }

      setScanning(false);
      return found;
    },
    [checkStatus, discoveredAgents, scanning],
  );

  useEffect(() => {
    // Single check on mount
    void checkStatus();

    const handleFocus = () => {
      void checkStatus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    // Heartbeat: 10s if running, 5s if offline
    const pollInterval = isRunning ? 10000 : 5000;
    const interval = setInterval(() => void checkStatus(), pollInterval);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      clearInterval(interval);
    };
  }, [checkStatus, isRunning]);

  const updateHost = (newHost: string) => {
    const clean = cleanHost(newHost);
    if (clean) {
      setHost(clean);
      localStorage.setItem("dr_print_agent_host", clean);
      void checkStatus(clean);
    }
  };

  const sendToPrinter = async (payload: {
    identifier?: string;
    jobData?: unknown;
    printer?: string;
    printerModel?: "standard" | "epson-l121";
    documentType?: string;
    settings?: string;
    calibration?: unknown;
    pdfBase64?: string;
  }) => {
    const res = await fetch(`${getAgentUrl()}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to trigger print job");
    }
    return res.json();
  };

  const isWindows = Boolean(agentInfo?.isWindows);
  const isLocalhost = host === "127.0.0.1" || host === "localhost";

  return {
    isRunning,
    checking,
    scanning,
    scanProgress,
    discoveredAgents,
    host,
    updateHost,
    checkStatus,
    scanNetwork,
    sendToPrinter,
    agentInfo,
    version: agentInfo?.version,
    platform: agentInfo?.platform,
    isWindows,
    isLocalhost,
    supported: agentInfo?.supported ?? (isRunning === true ? true : false),
    spoolerEngine: agentInfo?.spoolerEngine,
    defaultPrinter: agentInfo?.defaultPrinter,
    printers: agentInfo?.printers,
  };
}
