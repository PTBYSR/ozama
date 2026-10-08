"use client";

import React, { useState, useEffect, useRef } from "react";

interface FundingOption {
  id: string;
  amount: number;
  label: string;
  amountLabel: string;
  windowSeconds: number;
  windowLabel: string;
}

const OPTIONS: FundingOption[] = [
  { id: "50m", amount: 50_000_000, label: "50M", amountLabel: "50M", windowSeconds: 7200, windowLabel: "2 Hours Cooldown" },
  { id: "25m", amount: 25_000_000, label: "25M", amountLabel: "25M", windowSeconds: 3600, windowLabel: "1 Hour Cooldown" },
  { id: "10m", amount: 10_000_000, label: "10M", amountLabel: "10M", windowSeconds: 1800, windowLabel: "30 Min Cooldown" },
];

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "Ready";
  const hours = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  }
  return `${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}

function formatCompactNaira(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `₦${(amount / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (amount >= 1_000_000) {
    return `₦${(amount / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (amount >= 1_000) {
    return `₦${(amount / 1_000).toFixed(0)}K`;
  }
  return `₦${amount.toLocaleString()}`;
}

export default function OzamaPage() {
  const [username, setUsername] = useState("");
  const [verifiedUser, setVerifiedUser] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [userLimitNotice, setUserLimitNotice] = useState<string | null>(null);
  const [userCooldownSeconds, setUserCooldownSeconds] = useState<number>(0);

  // Anti-bot wall states
  const [honeypot, setHoneypot] = useState("");
  const [botToken, setBotToken] = useState("");

  // Stats badge state
  const [stats, setStats] = useState<{ totalAmount: number; totalPlayers: number }>({
    totalAmount: 0,
    totalPlayers: 0,
  });

  // Concurrency capacity state (max 20 users)
  const [isCapacityChecked, setIsCapacityChecked] = useState(false);
  const [isAtCapacity, setIsAtCapacity] = useState(false);
  const [activeUsersCount, setActiveUsersCount] = useState(1);
  const sessionIdRef = useRef<string>("");

  const [selectedOption, setSelectedOption] = useState<FundingOption>(OPTIONS[0]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isNoticeOpen, setIsNoticeOpen] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isFailed, setIsFailed] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Username validation regex: 3-24 alphanumeric or underscore
  const targetHandle = (verifiedUser || username).trim().replace(/^@+/, "");
  const isUsernameValid = /^[a-zA-Z0-9_]{3,24}$/.test(targetHandle);

  // Active funding or cooldown state (removes setup form and displays only the funding progress section)
  const isFundingActive = isExecuting || isFailed || cooldownRemaining > 0;

  // Swarm Activity Status (Live vs Down)
  const [systemStatus, setSystemStatus] = useState<{ isLive: boolean; maintenanceMessage?: string }>({
    isLive: true,
    maintenanceMessage: "",
  });

  // Fetch corner statistics
  const fetchStats = async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setStats({
          totalAmount: Number(data.totalAmount) || 0,
          totalPlayers: Number(data.totalPlayers) || 0,
        });
      }
    } catch {
      // ignore transient stats error
    }
  };

  // Fetch live system status (Live vs Down)
  const fetchSystemStatus = async () => {
    try {
      const res = await fetch("/api/system-status");
      if (res.ok) {
        const data = await res.json();
        setSystemStatus({
          isLive: data.isLive ?? true,
          maintenanceMessage: data.maintenanceMessage || "",
        });
      }
    } catch {
      // keep fallback
    }
  };

  // Generate anti-bot client token & load stats on mount
  useEffect(() => {
    fetchStats();
    fetchSystemStatus();
    const statusInterval = setInterval(fetchSystemStatus, 8000);
    // Anti-bot challenge token with client timestamp
    const token = btoa(`ozm_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    setBotToken(token);
    return () => clearInterval(statusInterval);
  }, []);

  // 20-Person Concurrency Tracker & Heartbeat
  useEffect(() => {
    if (typeof window === "undefined") return;
    let sid = sessionStorage.getItem("ozm_sess_id");
    if (!sid) {
      sid = "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("ozm_sess_id", sid);
    }
    sessionIdRef.current = sid;

    const pingCapacity = async () => {
      try {
        const res = await fetch("/api/capacity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, action: "heartbeat" }),
        });
        if (res.ok) {
          const data = await res.json();
          setIsCapacityChecked(true);
          if (!data.allowed) {
            setIsAtCapacity(true);
            setActiveUsersCount(data.activeCount || 20);
          } else {
            setIsAtCapacity(false);
            setActiveUsersCount(data.activeCount || 1);
          }
        }
      } catch {
        // keep current state
      }
    };

    pingCapacity();
    // Heartbeat ping every 8 seconds
    const interval = setInterval(pingCapacity, 8000);

    const handleBeforeUnload = () => {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/capacity",
          new Blob([JSON.stringify({ sessionId: sid, action: "release" })], { type: "application/json" })
        );
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // Debounced real-time Lagos Life player verification
  useEffect(() => {
    const clean = username.trim().replace(/^@+/, "");
    if (!clean || clean.length < 3) {
      setVerifiedUser(null);
      setIsVerifying(false);
      setVerifyError(null);
      setUserLimitNotice(null);
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      setVerifiedUser(null);
      setIsVerifying(false);
      setUserLimitNotice(null);
      setVerifyError("Username must be 3–24 letters, numbers, or underscores.");
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);
    setVerifiedUser(null);
    setUserLimitNotice(null);

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/verify-user?username=${encodeURIComponent(clean)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.exists && data.player) {
          setVerifiedUser(data.player.username);
          setVerifyError(null);
          setUserCooldownSeconds(data.cooldownSeconds || 0);
          if (data.limitReason) {
            setUserLimitNotice(data.limitReason);
          } else {
            setUserLimitNotice(null);
          }
        } else {
          setVerifiedUser(null);
          setUserLimitNotice(null);
          setUserCooldownSeconds(0);
          setVerifyError(data.error || "This account does not exist on Lagos Life. Please check the spelling.");
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setVerifiedUser(null);
          setUserLimitNotice(null);
          setUserCooldownSeconds(0);
          setVerifyError("Could not connect to Lagos Life right now. Please try again in a moment.");
        }
      } finally {
        setIsVerifying(false);
      }
    }, 350);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [username]);

  // Fields remain locked while executing, while finished, OR when swarm is Down (offline)
  const isFieldsLocked = isExecuting || isComplete || !systemStatus.isLive;

  const logsRef = useRef<string[]>([]);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}`;
    setLogs((prev) => {
      const updated = [...prev, formatted];
      logsRef.current = updated;
      return updated;
    });
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Cooldown countdown timer interval
  useEffect(() => {
    if (cooldownRemaining <= 0) {
      if (isComplete) {
        // Once cooldown is over, automatically reappear the username & funding option UI!
        setIsComplete(false);
        setActiveOrderId(null);
        setProgress(0);
        setErrorMsg(null);
        if (typeof window !== "undefined") {
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete("order");
            window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    const timer = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining, isComplete]);

  // Execute button clicked -> show confirmation modal
  const handleExecuteClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!systemStatus.isLive) {
      setErrorMsg(
        systemStatus.maintenanceMessage ||
          "The Ozama Swarm is currently offline for maintenance. Please check back shortly."
      );
      return;
    }
    if (!verifiedUser) {
      if (isVerifying) {
        setErrorMsg("Checking player on Lagos Life, please wait small...");
      } else if (verifyError) {
        setErrorMsg(verifyError);
      } else {
        setErrorMsg("Please enter a valid Lagos Life username.");
      }
      return;
    }
    if (userLimitNotice) {
      if (userCooldownSeconds > 0) {
        setCooldownRemaining(userCooldownSeconds);
        setIsComplete(true);
        setProgress(100);
        return;
      }
      setErrorMsg(userLimitNotice);
      return;
    }
    setErrorMsg(null);
    setIsConfirmOpen(true);
  };

  // User confirms modal -> proceed with funding
  const handleProceed = async () => {
    setIsConfirmOpen(false);
    setIsNoticeOpen(true);
  };

  // Reusable order polling & progress listener (persists order ID to URL, DB is authoritative)
  const startOrderPolling = (
    orderId: string,
    targetUser: string,
    windowSeconds: number,
    optionId?: string
  ) => {
    setActiveOrderId(orderId);
    setIsFailed(false);
    setIsExecuting(true);
    setIsComplete(false);

    // Sync order ID to URL for seamless reload persistence backed by DB
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("order", orderId);
        window.history.replaceState({}, "", url.toString());
      } catch {
        // ignore
      }
    }

    let lastLoggedStatus = "";
    let lastLoggedBatchCount = 0;

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const statusRes = await fetch(`/api/status/${orderId}`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          const order = statusData.order;

          if (order) {
            setProgress(order.percentComplete || 0);

            if (order.status === "authenticating" && lastLoggedStatus !== "authenticating") {
              lastLoggedStatus = "authenticating";
              addLog(`Authenticating player node on Lagos Life banking system...`);
            } else if (order.status === "allocating" && lastLoggedStatus !== "allocating") {
              lastLoggedStatus = "allocating";
              addLog(`Allocating bot swarm (${order.botsDispatched || 10} verified nodes)...`);
            } else if (order.status === "streaming") {
              const batches = order.batches || [];
              if (batches.length > lastLoggedBatchCount) {
                for (let i = lastLoggedBatchCount; i < batches.length; i++) {
                  const b = batches[i];
                  addLog(`Dispatched Bot Batch #${b.batchId} (+₦${(b.amount || 0).toLocaleString()})`);
                }
                lastLoggedBatchCount = batches.length;
              }
            } else if (order.status === "completed") {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              setProgress(100);
              setIsExecuting(false);
              setIsComplete(true);
              setIsFailed(false);
              setCooldownRemaining(windowSeconds);
              addLog(`✓ Funds delivered! ₦${(order.amount || selectedOption.amount).toLocaleString()} credited to @${targetUser}.`);
              addLog(`(Ensure player has Lagos Life open to auto-sync bank balance).`);
              fetchStats();
            } else if (order.status === "failed") {
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              setIsExecuting(false);
              setIsFailed(true);
              setErrorMsg(order.error || "Funding paused.");
              addLog(`Failed: ${order.error || "Unknown server error"}`);
            }
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 1000);
  };

  // Auto-resume active or completed session directly from Database on mount/refresh
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlOrderId = params.get("order");
      if (!urlOrderId) return;

      const resumeDbSession = async () => {
        try {
          const res = await fetch(`/api/status/${urlOrderId}`);
          if (!res.ok) return;
          const data = await res.json();
          const order = data.order;
          if (!order) return;

          setUsername(order.username);
          setVerifiedUser(order.username);
          setActiveOrderId(urlOrderId);

          const matchedOpt = OPTIONS.find((o) => o.amount === order.amount);
          if (matchedOpt) setSelectedOption(matchedOpt);
          const winSecs = matchedOpt?.windowSeconds || 7200;

          if (order.status === "completed") {
            const completedTime = order.completedAt
              ? new Date(order.completedAt).getTime()
              : Date.now();
            const elapsed = Math.floor((Date.now() - completedTime) / 1000);
            const remaining = Math.max(0, winSecs - elapsed);

            if (remaining > 0) {
              setIsExecuting(false);
              setIsComplete(true);
              setIsFailed(false);
              setProgress(100);
              setCooldownRemaining(remaining);
              addLog(`✓ Funds delivered! ₦${(order.amount || 0).toLocaleString()} credited to @${order.username}.`);
            } else {
              // Cooldown already finished: Reopen setup form directly
              setIsExecuting(false);
              setIsComplete(false);
              setIsFailed(false);
              setProgress(0);
              setCooldownRemaining(0);
            }
          } else if (order.status === "failed") {
            setIsExecuting(false);
            setIsFailed(true);
            setErrorMsg(order.error || "Funding paused.");
            addLog(`Failed: ${order.error || "Funding paused"}`);
          } else {
            setIsExecuting(true);
            setIsFailed(false);
            setProgress(order.percentComplete || 25);
            addLog(`Resuming active order #${urlOrderId} from database...`);
            startOrderPolling(urlOrderId, order.username, winSecs, matchedOpt?.id);
          }
        } catch {
          // ignore transient resume error
        }
      };

      resumeDbSession();
    } catch {
      // ignore
    }
  }, []);

  // User confirms in-game notice modal -> execute funding
  const handleFinalExecute = async () => {
    setIsNoticeOpen(false);
    setIsExecuting(true);
    setIsComplete(false);
    setCooldownRemaining(0);
    setProgress(5);
    setLogs([]);
    setErrorMsg(null);

    const targetUser = verifiedUser || username.trim().replace(/^@+/, "");
    addLog(`Initiating live funding for @${targetUser}...`);

    try {
      const res = await fetch("/api/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: targetUser,
          amount: selectedOption.amount,
          website: honeypot, // Honeypot anti-bot field
          botToken,          // Timed anti-bot token
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setIsExecuting(false);
        setErrorMsg(data.error || "Execution failed.");
        addLog(`Error: ${data.error || "Request failed"}`);
        if (data.details?.cooldownSeconds) {
          setCooldownRemaining(data.details.cooldownSeconds);
          setIsComplete(true);
        }
        return;
      }

      addLog(`Connected to Lagos Life server for @${targetUser}.`);
      if (data.dailyTriesRemaining !== undefined) {
        addLog(`Daily quota: ${data.dailyTriesRemaining} tries remaining today.`);
      }
      setProgress(25);

      const orderId = data.order?.id;
      if (orderId) {
        setActiveOrderId(orderId);
        startOrderPolling(orderId, targetUser, selectedOption.windowSeconds, selectedOption.id);
      } else {
        setIsExecuting(false);
        setIsComplete(true);
        setIsFailed(false);
        setCooldownRemaining(selectedOption.windowSeconds);
        fetchStats();
      }

    } catch (err: any) {
      setIsExecuting(false);
      setIsFailed(true);
      setErrorMsg(err.message || "Network error. Please try again.");
      addLog(`Network error: ${err.message}`);
    }
  };

  // Cancel active funding in progress - cancel completely and go directly back to setup form
  const handleCancelFunding = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (activeOrderId) {
      fetch(`/api/status/${activeOrderId}?action=cancel`).catch(() => {});
    }
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("order");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      } catch {
        // ignore
      }
    }
    setIsExecuting(false);
    setIsComplete(false);
    setIsFailed(false);
    setActiveOrderId(null);
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    setCooldownRemaining(0);
  };

  // Reset view to reopen username and funding option UI
  const handleReset = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("order");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      } catch {
        // ignore
      }
    }
    setIsExecuting(false);
    setIsComplete(false);
    setIsFailed(false);
    setActiveOrderId(null);
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    setCooldownRemaining(0);
  };

  // Switch to different user
  const handleSwitchUser = () => {
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("order");
        window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
      } catch {
        // ignore
      }
    }
    setIsExecuting(false);
    setIsComplete(false);
    setIsFailed(false);
    setActiveOrderId(null);
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    setUsername("");
    setVerifiedUser(null);
    setVerifyError(null);
    setIsVerifying(false);
    setCooldownRemaining(0);
  };

  // Resume paused order from last batch
  const handleResumeFunding = async () => {
    if (!activeOrderId) return;
    setIsFailed(false);
    setErrorMsg(null);
    setIsExecuting(true);
    addLog("⚡ Resuming swarm delivery from last successful batch...");
    try {
      await fetch(`/api/status/${activeOrderId}?action=resume`);
      const targetUser = verifiedUser || username.trim().replace(/^@+/, "");
      startOrderPolling(activeOrderId, targetUser, selectedOption.windowSeconds, selectedOption.id);
    } catch {
      setIsExecuting(false);
      setIsFailed(true);
      setErrorMsg("Failed to resume funding. Please check network connection.");
    }
  };

  // Render "Site at Capacity" screen if 20 concurrent operators limit reached
  if (isCapacityChecked && isAtCapacity) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-4 selection:bg-[#2f7de1] selection:text-white">
        <div className="w-full max-w-md lagos-card p-6 sm:p-8 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-center gap-2.5 flex-wrap mb-2">
            <h1 className="font-display text-3xl font-bold text-[#16203c] tracking-tight flex items-center gap-1.5">
              Ozama <span>🔥</span>
            </h1>
            <a
              href="https://x.com/ptbthefirst"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#5b6782] hover:text-[#16203c] text-[11px] font-semibold border border-[#d5dde6] transition-all hover:scale-105 active:scale-95 shadow-2xs"
            >
              <span>stuck? click here</span>
            </a>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold mb-4 mt-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            Site at Capacity (20/20 Operators Active)
          </div>
          <p className="text-sm text-[#5b6782] mb-6 leading-relaxed">
            Concurrent funding desk capacity is strictly limited to 20 users to protect bot swarm pipelines.
            You are queued — access will open automatically as soon as an operator leaves.
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-[#2f7de1] font-semibold py-2">
            <svg className="animate-spin h-4 w-4 text-[#2f7de1]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>Auto-reconnecting when a slot opens...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-[#2f7de1] selection:text-white relative">
      {/* Top Corner Badges */}
      <div className="fixed top-3.5 right-3.5 sm:top-5 sm:right-5 z-40 pointer-events-auto flex items-center gap-2">
        {/* Swarm Live/Down Activity Status Badge */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md border text-xs font-bold transition-all shadow-xs ${
          systemStatus.isLive
            ? "bg-white/90 border-emerald-500/30 text-emerald-700"
            : "bg-rose-50/95 border-rose-300 text-rose-700"
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            systemStatus.isLive ? "bg-emerald-500 animate-pulse" : "bg-rose-500 animate-ping"
          }`} />
          <span className="text-[11px] font-bold">
            {systemStatus.isLive ? "Swarm Live" : "Swarm Offline"}
          </span>
        </div>

        {/* Minimal Top Corner Stats Badge */}
        <div className="flex items-center gap-2.5 bg-white/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-[#d5dde6]/70 shadow-xs text-xs font-semibold text-[#16203c] transition-all">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#008751] animate-pulse" />
            <span className="text-[#5b6782] font-normal text-[11px]">Funded:</span>
            <span className="font-bold text-[#16203c]">{formatCompactNaira(stats.totalAmount)}</span>
          </div>
          <span className="text-[#cbd5e1] font-light">|</span>
          <div className="flex items-center gap-1">
            <span className="text-[#5b6782] font-normal text-[11px]">Players:</span>
            <span className="font-bold text-[#16203c]">{stats.totalPlayers}</span>
          </div>
        </div>
      </div>

      {/* Container Card */}
      <div className="w-full max-w-md lagos-card p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Minimal Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2.5 flex-wrap">
            <h1 className="font-display text-3xl font-bold text-[#16203c] tracking-tight flex items-center gap-1.5">
              Ozama <span>🔥</span>
            </h1>
            <a
              href="https://x.com/ptbthefirst"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#5b6782] hover:text-[#16203c] text-[11px] font-semibold border border-[#d5dde6] transition-all hover:scale-105 active:scale-95 shadow-2xs"
              title="Reach out on X"
            >
              <span>stuck? click here</span>
              <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>

        {/* Maintenance Alert when Swarm is Down */}
        {!systemStatus.isLive && (
          <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium leading-relaxed text-center animate-in fade-in shadow-xs">
            <div className="font-bold text-rose-900 flex items-center justify-center gap-1.5 mb-1">
              <span>⚠️</span>
              <span>Swarm Offline for Maintenance</span>
            </div>
            <p className="text-[11px] text-rose-700">
              {systemStatus.maintenanceMessage ||
                "Funding is temporarily paused while our swarm undergoes scheduled maintenance. Please check back shortly."}
            </p>
          </div>
        )}

        {/* Mode 1: Setup Form (Username & Funding Options) */}
        {!isFundingActive && (
          <form onSubmit={handleExecuteClick} className="space-y-5 animate-in fade-in duration-300">
            {/* Invisible Anti-Bot Honeypot Field */}
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              className="hidden opacity-0 absolute -z-50 pointer-events-none"
              aria-hidden="true"
            />

            {/* Username Input */}
            <div>
              <label className="block text-xs font-bold text-[#16203c] uppercase tracking-wider mb-1.5">
                Username
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-[#5b6782]">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  disabled={!systemStatus.isLive}
                  onChange={(e) => {
                    const val = e.target.value;
                    setUsername(val);
                    if (errorMsg) setErrorMsg(null);
                    if (userLimitNotice) setUserLimitNotice(null);
                  }}
                  placeholder="lagoslife_username"
                  className={`w-full bg-[#f8fafd] border rounded-2xl pl-8 pr-10 py-3 text-sm font-semibold text-[#16203c] placeholder:text-[#94a3b8] focus:outline-none transition-all ${
                    verifyError && username.trim().length >= 3
                      ? "border-red-400 focus:border-red-500 bg-red-50/20"
                      : verifiedUser && userLimitNotice
                      ? "border-amber-400 focus:border-amber-500 bg-amber-50/20"
                      : verifiedUser
                      ? "border-[#008751] focus:border-[#008751] bg-[#f0fbf5]/40"
                      : "border-[#d5dde6] focus:border-[#2f7de1]"
                  } ${!systemStatus.isLive ? "opacity-60 cursor-not-allowed bg-[#edf2f7]" : ""}`}
                />
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
                  {isVerifying && (
                    <svg
                      className="animate-spin h-4 w-4 text-[#2f7de1]"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                  )}
                  {!isVerifying && verifiedUser && !userLimitNotice && (
                    <span className="text-sm text-[#008751] font-bold">✓</span>
                  )}
                  {!isVerifying && verifiedUser && userLimitNotice && (
                    <span className="text-sm text-amber-600 font-bold">⏳</span>
                  )}
                  {!isVerifying && verifyError && username.trim().length >= 3 && (
                    <span className="text-sm text-red-500 font-bold">✕</span>
                  )}
                </div>
              </div>

              {/* Minimal Real-time Feedback */}
              {isVerifying && (
                <p className="mt-1.5 text-xs text-[#5b6782] flex items-center gap-1.5 animate-in fade-in duration-150">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2f7de1] animate-pulse" />
                  Checking player on Lagos Life...
                </p>
              )}
              {!isVerifying && verifiedUser && !userLimitNotice && (
                <p className="mt-1.5 text-xs text-[#008751] font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                  <span>✓</span> Player verified: <strong className="font-semibold">@{verifiedUser}</strong>
                </p>
              )}
              {!isVerifying && verifiedUser && userLimitNotice && (
                <p className="mt-1.5 text-xs text-amber-600 font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                  <span>⏳</span> {userLimitNotice}
                </p>
              )}
              {!isVerifying && verifyError && username.trim().length >= 3 && (
                <p className="mt-1.5 text-xs text-red-500 font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                  <span>✕</span> {verifyError}
                </p>
              )}
            </div>

            {/* Options Input */}
            <div>
              <label className="block text-xs font-bold text-[#16203c] uppercase tracking-wider mb-1.5">
                Funding Option
              </label>
              <div className="space-y-2">
                {OPTIONS.map((opt) => {
                  const isSelected = selectedOption.id === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!systemStatus.isLive}
                      onClick={() => {
                        setSelectedOption(opt);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-2xl border transition-all flex items-center justify-between text-sm ${
                        isSelected
                          ? "bg-[#16203c] text-white border-[#16203c] shadow-sm font-semibold"
                          : "bg-[#f8fafd] text-[#16203c] border-[#d5dde6] hover:border-[#b0c0d0]"
                      } ${!systemStatus.isLive ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <span className="font-semibold">{opt.label}</span>
                      <span className={`text-xs ${isSelected ? "text-slate-300" : "text-[#5b6782]"}`}>
                        {opt.windowLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3">
                {errorMsg}
              </div>
            )}

            {/* Execute Button */}
            {systemStatus.isLive ? (
              <button
                type="submit"
                disabled={!verifiedUser || isVerifying}
                className="w-full py-3.5 px-4 lagos-button text-sm tracking-wide uppercase disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isVerifying ? "Verifying..." : "Execute"}
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={true}
                  className="w-full py-3.5 px-4 rounded-2xl bg-slate-100 text-rose-700 border border-rose-200 text-xs font-bold uppercase tracking-wider cursor-not-allowed flex items-center justify-center gap-2 select-none shadow-xs"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span>Swarm Offline — Maintenance in Progress</span>
                </button>
                <p className="text-[11px] text-center text-slate-500">
                  {systemStatus.maintenanceMessage || "Funding is temporarily paused. Please check back shortly."}
                </p>
              </div>
            )}
          </form>
        )}

        {/* Mode 2: Funding Progress View (Animated replacement of form) */}
        {isFundingActive && (
          <div className="space-y-5 animate-in fade-in zoom-in-95 duration-300">
            {/* Top Recipient & Selected Tier Badge */}
            <div className="p-4 rounded-2xl bg-[#f8fafd] border border-[#d5dde6] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#5b6782] mb-0.5">
                  Recipient Player
                </div>
                <div className="font-mono text-sm font-bold text-[#16203c] flex items-center gap-1.5">
                  <span>@{targetHandle || "player"}</span>
                  <span className="text-xs text-[#008751]">✓</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#5b6782] mb-0.5">
                  Amount
                </div>
                <div className="font-bold text-sm text-[#16203c]">
                  {selectedOption.amountLabel}
                </div>
              </div>
            </div>

            {/* Progress Bar & Header */}
            <div className="p-4 rounded-2xl bg-[#f8fafd] border border-[#d5dde6]">
              <div className="flex justify-between items-center text-xs font-semibold text-[#16203c] mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="truncate max-w-[220px]">
                    {isComplete
                      ? targetHandle
                        ? `Funded @${targetHandle}`
                        : "Completed"
                      : isFailed
                      ? targetHandle
                        ? `Paused @${targetHandle}`
                        : "Funding Paused"
                      : targetHandle
                      ? `Funding @${targetHandle}`
                      : "Funding Progress"}
                  </span>
                  {isExecuting && !isComplete && (
                    <span className="inline-flex items-center gap-0.5 text-[#2f7de1] ml-0.5">
                      <span className="w-1 h-1 rounded-full bg-[#2f7de1] animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1 h-1 rounded-full bg-[#2f7de1] animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1 h-1 rounded-full bg-[#2f7de1] animate-bounce" />
                    </span>
                  )}
                  {isFailed && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded ml-1">
                      Paused
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-[#16203c]">{progress}%</span>
                </div>
              </div>
              <div className="relative w-full h-2.5 bg-[#e2e8f0] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ease-out rounded-full relative overflow-hidden ${
                    isComplete ? "bg-[#008751]" : isFailed ? "bg-amber-500" : "bg-[#2f7de1]"
                  }`}
                  style={{ width: `${Math.max(progress, isExecuting && !isComplete ? 6 : 0)}%` }}
                >
                  {isExecuting && !isComplete && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-shimmer" />
                  )}
                </div>
              </div>
            </div>

            {/* Collapsible Subtle Activity Logs */}
            <div>
              <button
                type="button"
                onClick={() => setShowLogs(!showLogs)}
                className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50/80 hover:bg-slate-100/80 border border-slate-200/60 transition-colors select-none text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-slate-500">Activity Logs</span>
                  {logs.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200/70 text-slate-600 font-mono font-medium">
                      {logs.length}
                    </span>
                  )}
                  {isExecuting && !isComplete && (
                    <span className="flex items-center gap-1 text-[10px] font-mono text-[#2f7de1]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2f7de1] animate-pulse" />
                      live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                  <span>{showLogs ? "Hide" : "Show"}</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform duration-200 text-slate-400 ${showLogs ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {showLogs && (
                <div className="mt-1.5 bg-[#0b1329] border border-slate-800/80 text-slate-300 font-mono text-[11px] rounded-xl p-3 max-h-36 overflow-y-auto space-y-1 shadow-inner">
                  {logs.map((log, index) => (
                    <div key={index} className="leading-relaxed text-slate-300">
                      {log}
                    </div>
                  ))}
                  {isExecuting && !isComplete && (
                    <div className="flex items-center gap-2 text-blue-400/90 text-[10px] pt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                      <span className="italic">Transferring in-game funds...</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>

            {/* In-Flight Controls: CANCEL BUTTON & RESET BUTTON */}
            {isExecuting && !isComplete && (
              <div className="space-y-2 pt-1">
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={handleCancelFunding}
                    className="flex-1 py-3 px-4 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <span>✕</span>
                    <span>Cancel</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 py-3 px-4 rounded-full bg-[#16203c] hover:bg-[#202d50] text-white text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-xs hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <span>↺</span>
                    <span>Reset</span>
                  </button>
                </div>
                <p className="text-[11px] text-center text-[#5b6782]">
                  Tap <strong>Cancel</strong> to halt transfer, or <strong>Reset</strong> to reopen the form.
                </p>
              </div>
            )}

            {/* Failure & Paused Controls with Resume & Reset Button */}
            {isFailed && (
              <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-200/90 space-y-3 animate-in fade-in">
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                    !
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                      Funding Paused (Delivered Funds Safe)
                    </h4>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      {errorMsg?.includes("409")
                        ? "Transfer paused because of Lagos Life network delay. Don't worry, all money already sent to your account is safe! Tap Resume below to continue."
                        : errorMsg || "Transfer paused. Delivered funds are safe. Tap Resume to continue."}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleResumeFunding}
                    className="flex-1 py-3 rounded-full bg-[#16203c] hover:bg-[#202d50] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-sm cursor-pointer"
                  >
                    ⚡ Resume Funding
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 py-3 rounded-full border border-slate-300 hover:bg-slate-100 text-[#5b6782] text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer text-center"
                  >
                    ↺ Reset
                  </button>
                </div>
              </div>
            )}

            {/* Post-Completion Controls */}
            {isComplete && (
              <div className="space-y-2.5 pt-1">
                {cooldownRemaining > 0 ? (
                  <div className="space-y-2">
                    <div className="w-full py-3 px-4 rounded-2xl bg-amber-50 text-amber-900 border border-amber-200 text-xs font-bold text-center flex items-center justify-center gap-2">
                      <span>⏳</span>
                      <span>Cooldown Active: {formatCooldown(cooldownRemaining)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="w-full py-3.5 rounded-full bg-[#16203c] hover:bg-[#202d50] text-white text-xs uppercase tracking-wider font-bold cursor-pointer transition-all shadow-xs"
                    >
                      ↺ Reset Form
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full py-3.5 lagos-green-button text-xs uppercase tracking-wider font-bold cursor-pointer"
                  >
                    ↺ Start New Funding
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSwitchUser}
                  className="w-full text-center text-[11px] text-[#5b6782] hover:text-[#16203c] pt-1 cursor-pointer transition-colors"
                >
                  Fund a different account
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Modal 1 */}
      {isConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150">
            <h3 className="font-display text-xl font-bold text-[#16203c] mb-2">
              Confirm Funding
            </h3>
            <p className="text-sm text-[#5b6782] mb-6 leading-relaxed">
              Are you sure you want to proceed with funding{" "}
              <strong className="text-[#16203c] font-semibold">{selectedOption.amountLabel}</strong> to{" "}
              <strong className="text-[#16203c] font-semibold">@{verifiedUser || username.trim().replace(/^@+/, "")}</strong>?
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-full border border-[#d5dde6] text-xs font-semibold text-[#5b6782] hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProceed}
                className="flex-1 py-2.5 rounded-full lagos-button text-xs font-semibold cursor-pointer"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal 2: Note for Your Funding to Work */}
      {isNoticeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150">
            <h3 className="font-display text-xl font-bold text-[#16203c] mb-2">
              Note for Your Funding to Work
            </h3>
            <p className="text-sm text-[#5b6782] mb-6 leading-relaxed">
              In the Lagos Life game, you need to keep your game open and check your phone messages (in the game as well) so that the funding can work properly.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setIsNoticeOpen(false)}
                className="flex-1 py-2.5 rounded-full border border-[#d5dde6] text-xs font-semibold text-[#5b6782] hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFinalExecute}
                className="flex-1 py-2.5 rounded-full lagos-button text-xs font-semibold cursor-pointer"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
