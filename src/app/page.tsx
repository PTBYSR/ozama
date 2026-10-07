"use client";

import React, { useState, useEffect, useRef } from "react";

interface MintOption {
  id: string;
  amount: number;
  label: string;
  amountLabel: string;
  windowSeconds: number;
  windowLabel: string;
}

const OPTIONS: MintOption[] = [
  { id: "500m", amount: 500_000_000, label: "500M", amountLabel: "500M", windowSeconds: 7200, windowLabel: "2 Hours Cooldown" },
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

export default function OzamaMintPage() {
  const [username, setUsername] = useState("");
  const [verifiedUser, setVerifiedUser] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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

  const [selectedOption, setSelectedOption] = useState<MintOption>(OPTIONS[0]);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isNoticeOpen, setIsNoticeOpen] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Username validation regex: 3-24 alphanumeric or underscore
  const isUsernameValid = /^[a-zA-Z0-9_]{3,24}$/.test(username.trim().replace(/^@+/, ""));

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

  // Generate anti-bot client token & load stats on mount
  useEffect(() => {
    fetchStats();
    // Anti-bot challenge token with client timestamp
    const token = btoa(`ozm_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    setBotToken(token);
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
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(clean)) {
      setVerifiedUser(null);
      setIsVerifying(false);
      setVerifyError("Username must be 3–24 letters, numbers, or underscores.");
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);
    setVerifiedUser(null);

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
        } else {
          setVerifiedUser(null);
          setVerifyError(data.error || "Player not found on Lagos Life");
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setVerifiedUser(null);
          setVerifyError("Unable to verify player account.");
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

  // Fields remain locked while executing OR while finished (until Start New Funding is allowed)
  const isFieldsLocked = isExecuting || isComplete;

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Cooldown countdown timer interval
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
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
  }, [cooldownRemaining]);

  // Execute button clicked -> show confirmation modal
  const handleExecuteClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifiedUser) {
      if (isVerifying) {
        setErrorMsg("Verifying player on Lagos Life, please wait...");
      } else if (verifyError) {
        setErrorMsg(verifyError);
      } else {
        setErrorMsg("Please enter a valid Lagos Life username.");
      }
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
      let pollCount = 0;

      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          if (!orderId) {
            clearInterval(pollInterval);
            setIsExecuting(false);
            setIsComplete(true);
            setCooldownRemaining(selectedOption.windowSeconds);
            fetchStats();
            return;
          }

          const statusRes = await fetch(`/api/status/${orderId}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            const order = statusData.order;

            if (order) {
              setProgress(order.percentComplete || 0);

              if (order.status === "allocating") {
                addLog(`Allocating bot swarm (${order.botsDispatched} verified bots)...`);
              } else if (order.status === "streaming") {
                const latestBatch = order.batches?.[order.batches.length - 1];
                if (latestBatch) {
                  addLog(`Dispatched Bot Batch #${latestBatch.batchId} (+₦${(latestBatch.amount || 0).toLocaleString()})`);
                }
              } else if (order.status === "completed") {
                clearInterval(pollInterval);
                setProgress(100);
                setIsExecuting(false);
                setIsComplete(true);
                setCooldownRemaining(selectedOption.windowSeconds);
                addLog(`✓ Funds delivered! ₦${selectedOption.amount.toLocaleString()} credited to @${targetUser}.`);
                addLog(`(Ensure player has Lagos Life open to auto-sync bank balance).`);
                fetchStats(); // Update corner stats immediately
              } else if (order.status === "failed") {
                clearInterval(pollInterval);
                setIsExecuting(false);
                setErrorMsg(order.error || "Funding failed.");
                addLog(`Failed: ${order.error || "Unknown server error"}`);
              }
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 1000);

    } catch (err: any) {
      setIsExecuting(false);
      setErrorMsg(err.message || "Network error. Please try again.");
      addLog(`Network error: ${err.message}`);
    }
  };

  // Reset form once cooldown is elapsed
  const handleReset = () => {
    if (cooldownRemaining > 0) return;
    setIsExecuting(false);
    setIsComplete(false);
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
  };

  // Switch to different user
  const handleSwitchUser = () => {
    setIsExecuting(false);
    setIsComplete(false);
    setProgress(0);
    setLogs([]);
    setErrorMsg(null);
    setUsername("");
    setVerifiedUser(null);
    setVerifyError(null);
    setIsVerifying(false);
    setCooldownRemaining(0);
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
      {/* Minimal Top Corner Stats Badge */}
      <div className="fixed top-3.5 right-3.5 sm:top-5 sm:right-5 z-40 pointer-events-auto">
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

        {/* Input Form */}
        <form onSubmit={handleExecuteClick} className="space-y-5">
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
                disabled={isFieldsLocked}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="lagoslife_username"
                className={`w-full bg-[#f8fafd] border rounded-2xl pl-8 pr-10 py-3 text-sm font-semibold text-[#16203c] placeholder:text-[#94a3b8] focus:outline-none transition-all ${
                  verifyError && username.trim().length >= 3
                    ? "border-red-400 focus:border-red-500 bg-red-50/20"
                    : verifiedUser
                    ? "border-[#008751] focus:border-[#008751] bg-[#f0fbf5]/40"
                    : "border-[#d5dde6] focus:border-[#2f7de1]"
                } ${isFieldsLocked ? "opacity-60 cursor-not-allowed bg-[#edf2f7]" : ""}`}
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
                {!isVerifying && verifiedUser && (
                  <span className="text-sm text-[#008751] font-bold">✓</span>
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
            {!isVerifying && verifiedUser && (
              <p className="mt-1.5 text-xs text-[#008751] font-medium flex items-center gap-1.5 animate-in fade-in duration-150">
                <span>✓</span> Player verified: <strong className="font-semibold">@{verifiedUser}</strong>
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
                    disabled={isFieldsLocked}
                    onClick={() => setSelectedOption(opt)}
                    className={`w-full text-left px-4 py-3 rounded-2xl border transition-all flex items-center justify-between text-sm ${
                      isSelected
                        ? "bg-[#16203c] text-white border-[#16203c] shadow-sm font-semibold"
                        : "bg-[#f8fafd] text-[#16203c] border-[#d5dde6] hover:border-[#b0c0d0]"
                    } ${isFieldsLocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
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
          {!isExecuting && !isComplete && (
            <button
              type="submit"
              disabled={!verifiedUser || isVerifying}
              className="w-full py-3.5 px-4 lagos-button text-sm tracking-wide uppercase disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isVerifying ? "Verifying..." : "Execute"}
            </button>
          )}
        </form>

        {/* Progress Bar & Logs (Active or Complete) */}
        {(isExecuting || isComplete || logs.length > 0) && (
          <div className="mt-6 pt-6 border-t border-[#e2e8f0]">
            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between items-center text-xs font-semibold text-[#16203c] mb-1.5">
                <span>{isComplete ? "Completed" : "Funding Progress"}</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-[#e2e8f0] rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    isComplete ? "bg-[#008751]" : "bg-[#2f7de1]"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Basic Logs Box */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#5b6782] mb-1.5">
                Logs
              </div>
              <div className="bg-[#0f172a] text-[#e2e8f0] font-mono text-xs rounded-xl p-3.5 h-36 overflow-y-auto space-y-1">
                {logs.map((log, index) => (
                  <div key={index} className="leading-relaxed">
                    {log}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>

            {/* Post-Completion Controls */}
            {isComplete && (
              <div className="mt-4 space-y-2">
                {cooldownRemaining > 0 ? (
                  /* Cooldown Active: Button is strictly DISABLED */
                  <button
                    type="button"
                    disabled={true}
                    className="w-full py-3.5 rounded-full bg-slate-100 text-[#5b6782] border border-[#d5dde6] text-xs uppercase tracking-wider font-bold cursor-not-allowed flex items-center justify-center gap-2 select-none"
                  >
                    <span>⏳ Cooldown Active ({formatCooldown(cooldownRemaining)})</span>
                  </button>
                ) : (
                  /* Cooldown Ended: Button becomes active */
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full py-3.5 lagos-green-button text-xs uppercase tracking-wider font-bold cursor-pointer"
                  >
                    Start New Funding
                  </button>
                )}

                {/* Option to switch to a different account */}
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

      {/* Confirmation Modal 2: Note on Lagos Life Game Balance */}
      {isNoticeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-150">
            <h3 className="font-display text-xl font-bold text-[#16203c] mb-2">
              Note on Lagos Life Game Balance
            </h3>
            <p className="text-sm text-[#5b6782] mb-6 leading-relaxed">
              In Lagos Life, incoming transfers are sent via the in-game banking network. Have the player open the game / phone messages so the game client registers and syncs the new funds.
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
