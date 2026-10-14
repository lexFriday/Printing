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
}

function getCandidateHosts(preferredHost: string): string[] {
  const currentHostname = typeof window !== "undefined" ? window.location.hostname : "";
  const list = [preferredHost, "127.0.0.1", "localhost", currentHostname]
    .map((h) => (h || "").trim().replace(/^https?:\/\//, "").replace(/:\d+$/, ""))
    .filter((h) => Boolean(h) && h !== "0.0.0.0");
  return Array.from(new Set(list));
}

async function probeHost(
  candidateHost: string,
  timeoutMs = 2500,
): Promise<{ host: string; info: AgentInfo } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${candidateHost}:${DEFAULT_PORT}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as AgentInfo;
      if (data && (data.status === "running" || data.platform || data.supported !== undefined)) {
        return { host: candidateHost, info: data };
      }
    }
  } catch {
    // Unreachable or blocked
  }
  return null;
}

// Concurrently test all candidate hosts and resolve as soon as the first responsive agent answers
async function detectAgent(candidates: string[]): Promise<{ host: string; info: AgentInfo } | null> {
  if (candidates.length === 0) return null;
  return new Promise((resolve) => {
    let pending = candidates.length;
    let resolved = false;

    candidates.forEach((cand) => {
      probeHost(cand, 2500).then((res) => {
        if (resolved) return;
        if (res) {
          resolved = true;
          resolve(res);
          return;
        }
        pending--;
        if (pending === 0) {
          resolve(null);
        }
      });
    });
  });
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
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const checkingRef = useRef(false);

  const getAgentUrl = (ip = host) => `http://${ip}:${DEFAULT_PORT}`;

  const checkStatus = useCallback(
    async (targetHost = host) => {
      if (checkingRef.current) return isRunning === true;
      checkingRef.current = true;
      setChecking(true);

      const candidates = getCandidateHosts(targetHost);
      const match = await detectAgent(candidates);

      if (match) {
        setIsRunning(true);
        setAgentInfo({
          status: match.info.status,
          platform: match.info.platform,
          supported: match.info.supported ?? true,
          spoolerEngine: match.info.spoolerEngine,
          defaultPrinter: match.info.defaultPrinter,
          printers: match.info.printers,
          version: match.info.version,
        });
        if (match.host !== host) {
          setHost(match.host);
          localStorage.setItem("dr_print_agent_host", match.host);
        }
        checkingRef.current = false;
        setChecking(false);
        return true;
      }

      setIsRunning(false);
      setAgentInfo(null);
      checkingRef.current = false;
      setChecking(false);
      return false;
    },
    [host, isRunning],
  );

  useEffect(() => {
    void checkStatus();

    const handleFocus = () => {
      void checkStatus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    // Fast 3.5s retry when offline to detect app launch immediately, 10s heartbeat when online
    const pollInterval = isRunning ? 10000 : 3500;
    const interval = setInterval(() => void checkStatus(), pollInterval);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
      clearInterval(interval);
    };
  }, [checkStatus, isRunning]);

  const updateHost = (newHost: string) => {
    const clean = newHost.trim().replace(/^https?:\/\//, "").replace(/:\d+$/, "");
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

  return {
    isRunning,
    checking,
    host,
    updateHost,
    checkStatus,
    sendToPrinter,
    agentInfo,
    version: agentInfo?.version,
    platform: agentInfo?.platform,
    supported: agentInfo?.supported ?? (isRunning === true ? true : false),
    spoolerEngine: agentInfo?.spoolerEngine,
    defaultPrinter: agentInfo?.defaultPrinter,
  };
}
