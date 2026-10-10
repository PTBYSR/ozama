"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { SystemSettings, UserSummary, OrderDoc, BlockedIpDoc } from "@/lib/types";

interface AdminStats {
  totalAmount: number;
  totalPlayers: number;
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  activeOrders: number;
  botPoolSize: number;
  blockedIpsCount?: number;
  activeVisitors?: number;
  maxCapacity?: number;
}

function formatCompactNaira(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `₦${(amount / 1_000_000_000).toFixed(2).replace(/\.00$/, "")}B`;
  }
  if (amount >= 1_000_000) {
    return `₦${(amount / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  }
  if (amount >= 1_000) {
    return `₦${(amount / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `₦${(amount || 0).toLocaleString()}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Determines if an in-progress order is stale (> 2 minutes without update)
function isOrderStale(order: OrderDoc): boolean {
  if (["streaming", "allocating", "authenticating", "queued"].includes(order.status)) {
    const lastTouch = new Date(order.updatedAt || order.createdAt).getTime();
    return Date.now() - lastTouch > 2 * 60 * 1000;
  }
  return false;
}

export default function AdminDashboardPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  // Dashboard Data
  const [systemStatus, setSystemStatus] = useState<SystemSettings>({
    isLive: true,
    maintenanceMessage: "",
    killSwitch: false,
    killSwitchMessage: "Ozama is currently offline for system maintenance. Please check back shortly.",
    maxCapacity: 20,
    updatedAt: "",
  });
  const [stats, setStats] = useState<AdminStats>({
    totalAmount: 0,
    totalPlayers: 0,
    totalOrders: 0,
    completedOrders: 0,
    failedOrders: 0,
    activeOrders: 0,
    botPoolSize: 2699,
    blockedIpsCount: 0,
    activeVisitors: 0,
    maxCapacity: 20,
  });
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [blockedIps, setBlockedIps] = useState<BlockedIpDoc[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Status & Kill switch & Capacity controls
  const [tempIsLive, setTempIsLive] = useState(true);
  const [tempMaintenanceMsg, setTempMaintenanceMsg] = useState("");
  const [tempKillSwitch, setTempKillSwitch] = useState(false);
  const [tempKillSwitchMsg, setTempKillSwitchMsg] = useState("");
  const [tempMaxCapacity, setTempMaxCapacity] = useState<number>(20);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusSaveSuccess, setStatusSaveSuccess] = useState<string | null>(null);

  // Manual IP block input
  const [manualIp, setManualIp] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [isBlockingIp, setIsBlockingIp] = useState(false);
  const [resettingUser, setResettingUser] = useState<string | null>(null);
  const [ipActionFeedback, setIpActionFeedback] = useState<string | null>(null);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<"users" | "orders" | "security">("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Check initial session
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/admin/auth");
        const data = await res.json();
        if (data.authenticated) {
          setIsAuthenticated(true);
          fetchOverview();
        }
      } catch {
        // not authenticated
      } finally {
        setAuthChecking(false);
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    setIsSubmittingAuth(true);
    setAuthError(null);

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.trim() }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIsAuthenticated(true);
        fetchOverview();
      } else {
        setAuthError(data.error || "Incorrect admin password");
      }
    } catch (err: any) {
      setAuthError(err.message || "Failed to authenticate");
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const fetchOverview = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/overview");
      if (res.ok) {
        const data = await res.json();
        if (data.systemStatus) {
          setSystemStatus(data.systemStatus);
          setTempIsLive(data.systemStatus.isLive);
          setTempMaintenanceMsg(data.systemStatus.maintenanceMessage || "");
          setTempKillSwitch(data.systemStatus.killSwitch || false);
          setTempKillSwitchMsg(
            data.systemStatus.killSwitchMessage ||
              "Ozama is currently offline for system maintenance. Please check back shortly."
          );
          setTempMaxCapacity(data.systemStatus.maxCapacity ?? 20);
        }
        if (data.stats) setStats(data.stats);
        if (data.users) setUsers(data.users);
        if (data.orders) setOrders(data.orders);
        if (data.blockedIps) setBlockedIps(data.blockedIps);
      } else if (res.status === 401) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Failed to fetch admin overview:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save Settings (Live/Down, Kill Switch, Capacity, Messages)
  const handleSaveSettings = async (overrides?: {
    isLive?: boolean;
    killSwitch?: boolean;
    maintenanceMessage?: string;
    killSwitchMessage?: string;
    maxCapacity?: number;
  }) => {
    setIsUpdatingStatus(true);
    setStatusSaveSuccess(null);

    const targetCapacity =
      overrides?.maxCapacity !== undefined ? overrides.maxCapacity : tempMaxCapacity;

    const payload = {
      isLive: overrides?.isLive !== undefined ? overrides.isLive : tempIsLive,
      maintenanceMessage:
        overrides?.maintenanceMessage !== undefined ? overrides.maintenanceMessage : tempMaintenanceMsg,
      killSwitch: overrides?.killSwitch !== undefined ? overrides.killSwitch : tempKillSwitch,
      killSwitchMessage:
        overrides?.killSwitchMessage !== undefined ? overrides.killSwitchMessage : tempKillSwitchMsg,
      maxCapacity: Math.max(1, Math.floor(Number(targetCapacity) || 20)),
    };

    try {
      const res = await fetch("/api/admin/system-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data.settings);
        setTempIsLive(data.settings.isLive);
        setTempKillSwitch(data.settings.killSwitch || false);
        if (data.settings.maxCapacity !== undefined) {
          setTempMaxCapacity(data.settings.maxCapacity);
        }
        setStatusSaveSuccess("✓ Configuration saved and published live!");
        setTimeout(() => setStatusSaveSuccess(null), 4000);
      }
    } catch (err) {
      console.error("Settings update error:", err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Quick toggle helper for Kill Switch
  const handleToggleKillSwitch = (active: boolean) => {
    setTempKillSwitch(active);
    handleSaveSettings({ killSwitch: active });
  };

  // Quick toggle helper for Swarm Live / Down
  const handleToggleSwarmLive = (live: boolean) => {
    setTempIsLive(live);
    handleSaveSettings({ isLive: live });
  };

  // Block an IP address immediately
  const handleBlockIp = async (ipToBlock: string, reason = "Blocked by administrator") => {
    const cleanIp = ipToBlock.trim();
    if (!cleanIp) return;
    setIsBlockingIp(true);
    setIpActionFeedback(null);

    try {
      const res = await fetch("/api/admin/blocked-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: cleanIp, reason }),
      });
      const data = await res.json();
      if (res.ok) {
        setIpActionFeedback(`✓ IP ${cleanIp} has been restricted immediately.`);
        setManualIp("");
        setManualReason("");
        fetchOverview();
        setTimeout(() => setIpActionFeedback(null), 4000);
      } else {
        setIpActionFeedback(`⚠️ Error: ${data.error || "Failed to block IP"}`);
      }
    } catch (err: any) {
      setIpActionFeedback(`⚠️ Network error: ${err.message}`);
    } finally {
      setIsBlockingIp(false);
    }
  };

  // Reset a user's cooldown and daily limits
  const handleResetUser = async (username: string) => {
    if (!confirm(`Are you sure you want to reset cooldown and daily limits for @${username}?`)) return;
    setResettingUser(username);
    try {
      const res = await fetch("/api/admin/reset-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (res.ok) {
        alert(`✓ Limits reset successfully for @${username}`);
        fetchOverview();
      } else {
        const data = await res.json();
        alert(`⚠️ Error: ${data.error || "Failed to reset user"}`);
      }
    } catch (err: any) {
      alert(`⚠️ Network error: ${err.message}`);
    } finally {
      setResettingUser(null);
    }
  };

  // Unblock an IP address immediately
  const handleUnblockIp = async (ipToUnblock: string) => {
    if (!ipToUnblock) return;
    try {
      const res = await fetch(`/api/admin/blocked-ips?ip=${encodeURIComponent(ipToUnblock)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setIpActionFeedback(`✓ IP ${ipToUnblock} is unblocked.`);
        fetchOverview();
        setTimeout(() => setIpActionFeedback(null), 3000);
      }
    } catch (err) {
      console.error("Failed to unblock IP:", err);
    }
  };

  // Auto-refresh every 12s if authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(fetchOverview, 12000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Filtered users
  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  // Filtered orders
  const filteredOrders = orders.filter((o) => {
    const matchUser = o.username.toLowerCase().includes(searchQuery.toLowerCase().trim());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchUser && matchStatus;
  });

  // -------------------------------------------------------------
  // Authentication Screen
  // -------------------------------------------------------------
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#070b14] flex items-center justify-center p-4 text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs sm:text-sm font-mono tracking-wider">VERIFYING COMMAND SESSION...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col items-center justify-center p-4 selection:bg-emerald-500 selection:text-black">
        <div className="w-full max-w-sm sm:max-w-md bg-[#0e1626]/90 border border-slate-800/80 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 text-2xl mb-3 shadow-inner">
              🔥
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-white flex items-center justify-center gap-2">
              Ozama <span>Swarm Command</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">Authorized personnel only. Enter root access password.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Admin Master Password
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password..."
                className="w-full bg-[#080d18] border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/80 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                autoFocus
              />
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-2">
                <span>⚠️</span>
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingAuth || !passwordInput.trim()}
              className="w-full min-h-[46px] bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
            >
              {isSubmittingAuth ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Unlock Command Dashboard</span>
                  <span>→</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800/80 text-center">
            <Link
              href="/"
              className="text-xs text-slate-400 hover:text-white transition-colors flex items-center justify-center gap-1.5"
            >
              <span>← Back to Public Funding Desk</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Authenticated Admin Dashboard (Highly Mobile Responsive)
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 selection:bg-emerald-500 selection:text-black pb-12">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-[#0a101d]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          {/* Brand */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-base sm:text-lg shrink-0">
              🔥
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-display font-bold text-sm sm:text-base text-white tracking-tight truncate">
                  Ozama
                </span>
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] sm:text-[10px] font-mono font-bold tracking-wider uppercase">
                  Admin
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate hidden xs:block">
                Lagos Life Swarm Telemetry
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              onClick={fetchOverview}
              disabled={isLoading}
              className="px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              title="Refresh Data"
            >
              <svg
                className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-emerald-400" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <Link
              href="/"
              target="_blank"
              className="px-2.5 sm:px-3.5 py-1.5 min-h-[36px] rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition-all"
            >
              <span>Public Desk</span>
              <span className="opacity-60 text-[10px]">↗</span>
            </Link>

            <button
              onClick={() => {
                document.cookie = "ozama_admin_token=; Max-Age=0; path=/;";
                setIsAuthenticated(false);
              }}
              className="px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 text-xs font-semibold transition-all cursor-pointer"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6">

        {/* Global Feedback Banner */}
        {statusSaveSuccess && (
          <div className="p-3 sm:p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
            <span>✓</span>
            <span>{statusSaveSuccess}</span>
          </div>
        )}

        {ipActionFeedback && (
          <div className="p-3 sm:p-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
            <span>ℹ</span>
            <span>{ipActionFeedback}</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* SECTION 1: GLOBAL KILL SWITCH (USER EXPLICIT REQUIREMENT) */}
        {/* ========================================================= */}
        <section className={`rounded-3xl border p-5 sm:p-7 backdrop-blur-xl transition-all shadow-2xl relative overflow-hidden ${
          tempKillSwitch
            ? "bg-gradient-to-br from-[#2f0c13] via-[#1f0a12] to-[#070b14] border-rose-500/50 shadow-rose-950/40"
            : "bg-gradient-to-br from-[#0c1824] via-[#09121d] to-[#070b14] border-slate-700/70"
        }`}>
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5 relative z-10">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-slate-400">
                  CRITICAL ACCESS CONTROL
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                  tempKillSwitch
                    ? "bg-rose-500/25 text-rose-300 border-rose-500/50"
                    : "bg-slate-800 text-slate-300 border-slate-700"
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    tempKillSwitch ? "bg-rose-500 animate-ping" : "bg-emerald-400"
                  }`} />
                  {tempKillSwitch ? "KILL SWITCH ENGAGED (BLACKOUT)" : "KILL SWITCH: OFF (NORMAL)"}
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-white font-display tracking-tight flex items-center gap-2">
                <span>⚡ Global Kill Switch Toggle</span>
              </h2>

              <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                When activated, the public site completely hides the username inputs, funding tiers, and activity cards.
                The homepage will <strong>ONLY display your custom message below</strong>.
              </p>
            </div>

            {/* Big Toggle Buttons */}
            <div className="flex sm:flex-row items-stretch gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => handleToggleKillSwitch(false)}
                disabled={isUpdatingStatus}
                className={`flex-1 sm:flex-none px-4 sm:px-5 py-3 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer border min-h-[46px] ${
                  !tempKillSwitch
                    ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-md ring-2 ring-emerald-400/40 font-extrabold"
                    : "bg-slate-900/80 hover:bg-slate-800 text-slate-400 border-slate-700"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>DEACTIVATE</span>
              </button>

              <button
                type="button"
                onClick={() => handleToggleKillSwitch(true)}
                disabled={isUpdatingStatus}
                className={`flex-1 sm:flex-none px-4 sm:px-5 py-3 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer border min-h-[46px] ${
                  tempKillSwitch
                    ? "bg-rose-500 text-white border-rose-400 shadow-xl shadow-rose-950 ring-2 ring-rose-400/50 font-extrabold"
                    : "bg-slate-900/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border-slate-700"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                <span>ENGAGE KILL SWITCH</span>
              </button>
            </div>
          </div>

          {/* Editable Announcement Message for Kill Switch */}
          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-2">
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              Kill Switch Public Message (Editable by Admin):
            </label>
            <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
              <textarea
                rows={2}
                value={tempKillSwitchMsg}
                onChange={(e) => setTempKillSwitchMsg(e.target.value)}
                placeholder="Message to display to all visitors when the kill switch is active..."
                className="flex-1 bg-[#080d18] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500/80 resize-none font-medium leading-relaxed"
              />
              <button
                onClick={() => handleSaveSettings({ killSwitchMessage: tempKillSwitchMsg })}
                disabled={isUpdatingStatus}
                className="px-4 py-2.5 min-h-[42px] rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center justify-center"
              >
                {isUpdatingStatus ? "Saving..." : "Save Announcement"}
              </button>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* SECTION 2: SWARM PUBLIC STATUS (OPERATIONAL VS MAINTENANCE) */}
        {/* ========================================================= */}
        <section className={`rounded-3xl border p-5 sm:p-7 backdrop-blur-xl transition-all shadow-xl relative overflow-hidden ${
          tempIsLive
            ? "bg-[#0b161c]/90 border-emerald-500/30"
            : "bg-[#181119]/90 border-amber-500/30"
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Swarm Execution Switch
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  tempIsLive
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                }`}>
                  {tempIsLive ? "SWARM ONLINE" : "SWARM PAUSED"}
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                {tempIsLive ? "🟢 Normal Swarm Operations" : "🟡 Maintenance Pause"}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Disable swarm without triggering total blackout (site remains up, execute button shows maintenance).
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleToggleSwarmLive(true)}
                disabled={isUpdatingStatus}
                className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold transition-all border min-h-[42px] cursor-pointer ${
                  tempIsLive
                    ? "bg-emerald-500 text-slate-950 border-emerald-400"
                    : "bg-slate-900 text-slate-400 border-slate-700"
                }`}
              >
                Swarm LIVE
              </button>
              <button
                type="button"
                onClick={() => handleToggleSwarmLive(false)}
                disabled={isUpdatingStatus}
                className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-bold transition-all border min-h-[42px] cursor-pointer ${
                  !tempIsLive
                    ? "bg-amber-500 text-slate-950 border-amber-400"
                    : "bg-slate-900 text-slate-400 border-slate-700"
                }`}
              >
                Swarm PAUSED
              </button>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* SECTION 3: CONCURRENT SITE VISITORS CAPACITY */}
        {/* ========================================================= */}
        <section className="rounded-3xl border border-cyan-500/30 bg-[#07131d]/90 p-5 sm:p-7 backdrop-blur-xl transition-all shadow-xl relative overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-cyan-400">
                  TRAFFIC & CONCURRENCY CONTROL
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-cyan-500/15 text-cyan-300 border-cyan-500/30">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  {stats.activeVisitors ?? 0} / {systemStatus.maxCapacity ?? tempMaxCapacity} Live Active Sessions
                </span>
              </div>

              <h2 className="text-xl sm:text-2xl font-black text-white font-display tracking-tight flex items-center gap-2">
                <span>👥 Total Site Visitors Limit</span>
              </h2>

              <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
                Restricts the maximum number of concurrent active users allowed on the site.
                When active users hit this limit, incoming visitors are held on the waiting queue screen until a slot frees up.
              </p>
            </div>

            {/* Capacity Input & Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <div className="flex items-center bg-[#050a12] border border-cyan-500/40 rounded-2xl p-1.5 shadow-inner">
                <button
                  type="button"
                  onClick={() => setTempMaxCapacity((prev) => Math.max(1, prev - 5))}
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-lg flex items-center justify-center transition-colors cursor-pointer"
                  title="Decrease by 5"
                >
                  -
                </button>
                <div className="px-3 flex flex-col items-center min-w-[90px]">
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={tempMaxCapacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setTempMaxCapacity(isNaN(val) ? 1 : Math.max(1, Math.min(1000, val)));
                    }}
                    className="w-16 text-center bg-transparent font-display font-black text-xl text-cyan-300 focus:outline-none"
                  />
                  <span className="text-[10px] uppercase font-bold text-slate-400 -mt-0.5">visitors</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTempMaxCapacity((prev) => Math.min(1000, prev + 5))}
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-lg flex items-center justify-center transition-colors cursor-pointer"
                  title="Increase by 5"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleSaveSettings({ maxCapacity: tempMaxCapacity })}
                disabled={isUpdatingStatus}
                className="px-5 py-3 min-h-[48px] rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-xs sm:text-sm transition-all cursor-pointer shadow-lg shadow-cyan-950 flex items-center justify-center gap-2"
              >
                {isUpdatingStatus ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Save Visitor Limit</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">
              Quick Presets:
            </span>
            {[
              { label: "10 (Strict)", value: 10 },
              { label: "20 (Default)", value: 20 },
              { label: "50 (Medium)", value: 50 },
              { label: "100 (High)", value: 100 },
              { label: "200 (Extreme)", value: 200 },
            ].map((preset) => {
              const isCurrent = (systemStatus.maxCapacity ?? 20) === preset.value;
              const isSelected = tempMaxCapacity === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    setTempMaxCapacity(preset.value);
                    handleSaveSettings({ maxCapacity: preset.value });
                  }}
                  disabled={isUpdatingStatus}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    isSelected
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-xs"
                      : "bg-[#0b1626] text-slate-400 border-slate-800 hover:text-white hover:border-slate-700"
                  }`}
                >
                  <span>{preset.label}</span>
                  {isCurrent && (
                    <span className="ml-1.5 text-[9px] px-1.5 py-0.2 rounded-full bg-cyan-400/20 text-cyan-300 font-normal">
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* ========================================================= */}
        {/* STATS OVERVIEW CARDS (Responsive Grid) */}
        {/* ========================================================= */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Delivered Volume
            </div>
            <div className="text-xl sm:text-2xl font-black text-white font-display">
              {formatCompactNaira(stats.totalAmount)}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 truncate font-mono">
              ₦{stats.totalAmount.toLocaleString()}
            </div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Unique Players
            </div>
            <div className="text-xl sm:text-2xl font-black text-white font-display">
              {stats.totalPlayers}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Lagos Life accounts</div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Total Orders
            </div>
            <div className="text-xl sm:text-2xl font-black text-white font-display">
              {stats.totalOrders}
            </div>
            <div className="text-[10px] text-emerald-400 mt-1 font-semibold">
              {stats.completedOrders} completed
            </div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Swarm Nodes
            </div>
            <div className="text-xl sm:text-2xl font-black text-white font-display">
              {stats.botPoolSize}
            </div>
            <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Pool Ready</span>
            </div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Active Visitors
            </div>
            <div className="text-xl sm:text-2xl font-black text-cyan-300 font-display">
              {stats.activeVisitors ?? 0} <span className="text-xs text-slate-400 font-normal">/ {systemStatus.maxCapacity ?? 20}</span>
            </div>
            <div className="text-[10px] text-cyan-400/90 mt-1 flex items-center gap-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>
                {Math.round(((stats.activeVisitors ?? 0) / (systemStatus.maxCapacity || 20)) * 100)}% Max Capacity
              </span>
            </div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5">
            <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Blocked IPs
            </div>
            <div className="text-xl sm:text-2xl font-black text-rose-400 font-display">
              {blockedIps.length}
            </div>
            <div className="text-[10px] text-rose-400/80 mt-1 font-semibold">
              Restricted from API
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* TAB CONTROLS & TABLES (Touch-friendly on mobile) */}
        {/* ========================================================= */}
        <div className="bg-[#0e1626]/90 border border-slate-800/80 rounded-3xl backdrop-blur-xl shadow-xl overflow-hidden">
          {/* Tab Headers */}
          <div className="p-3 sm:p-5 border-b border-slate-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Horizontal Scrollable Tabs */}
            <div className="flex items-center gap-1.5 bg-[#080d18] p-1 rounded-2xl border border-slate-800 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveTab("users")}
                className={`px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "users"
                    ? "bg-emerald-500 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>All Players</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === "users" ? "bg-slate-950/20 text-slate-950" : "bg-slate-800 text-slate-300"
                }`}>
                  {users.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("orders")}
                className={`px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "orders"
                    ? "bg-emerald-500 text-slate-950 shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>Orders History</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === "orders" ? "bg-slate-950/20 text-slate-950" : "bg-slate-800 text-slate-300"
                }`}>
                  {orders.length}
                </span>
              </button>

              <button
                onClick={() => setActiveTab("security")}
                className={`px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === "security"
                    ? "bg-rose-500 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <span>🚫 Blocked IPs</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeTab === "security" ? "bg-white/20 text-white" : "bg-slate-800 text-slate-300"
                }`}>
                  {blockedIps.length}
                </span>
              </button>
            </div>

            {/* Search Input & Status Filter */}
            {activeTab !== "security" && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-60">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search player handle..."
                    className="w-full bg-[#080d18] border border-slate-700/80 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>

                {activeTab === "orders" && (
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-[#080d18] border border-slate-700/80 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/60 cursor-pointer"
                  >
                    <option value="all">All</option>
                    <option value="completed">Completed</option>
                    <option value="streaming">Streaming</option>
                    <option value="failed">Failed</option>
                    <option value="queued">Queued</option>
                  </select>
                )}
              </div>
            )}
          </div>

          {/* TAB 1: USERS DIRECTORY */}
          {activeTab === "users" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead className="bg-[#080d18]/70 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800/80">
                  <tr>
                    <th className="py-3 px-4 sm:px-6">Player Handle</th>
                    <th className="py-3 px-4 sm:px-6">Total Naira</th>
                    <th className="py-3 px-4 sm:px-6">Orders</th>
                    <th className="py-3 px-4 sm:px-6">Status</th>
                    <th className="py-3 px-4 sm:px-6">Client IP</th>
                    <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500 font-mono">
                        No players found.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const isStaleStreaming =
                        user.lastStatus === "streaming" &&
                        Date.now() - new Date(user.lastActive).getTime() > 2 * 60 * 1000;

                      return (
                        <tr key={user.username} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3.5 px-4 sm:px-6">
                            <div className="flex items-center gap-2">
                              <span className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-xs shrink-0">
                                {user.username.charAt(0).toUpperCase()}
                              </span>
                              <span className="font-bold text-white text-sm">@{user.username}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 font-mono text-emerald-400 font-bold text-sm">
                            ₦{user.totalFunded.toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 text-slate-300">
                            <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/60 font-mono text-[11px]">
                              {user.totalOrders} {user.totalOrders === 1 ? "order" : "orders"}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 sm:px-6">
                            {isStaleStreaming ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                TIMED OUT
                              </span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                user.lastStatus === "completed"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : user.lastStatus === "failed"
                                  ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                  : "bg-sky-500/10 text-sky-400 border-sky-500/30"
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  user.lastStatus === "completed"
                                    ? "bg-emerald-400"
                                    : user.lastStatus === "failed"
                                    ? "bg-rose-400"
                                    : "bg-sky-400 animate-pulse"
                                }`} />
                                {user.lastStatus}
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 font-mono text-slate-400 text-[11px]">
                            {user.lastIp || "—"}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 text-right space-x-2">
                            <button
                              onClick={() => handleResetUser(user.username)}
                              disabled={resettingUser === user.username}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/25 text-amber-300 border border-amber-500/20 text-[11px] font-bold transition-all cursor-pointer"
                              title="Reset cooldown and daily funding limits for this user"
                            >
                              {resettingUser === user.username ? "Resetting..." : "⚡ Reset"}
                            </button>
                            {user.lastIp && (
                              <button
                                onClick={() => handleBlockIp(user.lastIp!, `Blocked player @${user.username}`)}
                                disabled={isBlockingIp}
                                className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-500/20 text-[11px] font-bold transition-all cursor-pointer"
                                title="Block this IP address immediately"
                              >
                                🚫 Block IP
                              </button>
                            )}
                            <a
                              href="https://lagoslife.eliysites.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline font-semibold"
                            >
                              In Game ↗
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: ORDERS HISTORY */}
          {activeTab === "orders" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[800px]">
                <thead className="bg-[#080d18]/70 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800/80">
                  <tr>
                    <th className="py-3 px-4 sm:px-6">Order ID</th>
                    <th className="py-3 px-4 sm:px-6">Player</th>
                    <th className="py-3 px-4 sm:px-6">Requested</th>
                    <th className="py-3 px-4 sm:px-6">Delivered</th>
                    <th className="py-3 px-4 sm:px-6">Status & Progress</th>
                    <th className="py-3 px-4 sm:px-6">Client IP</th>
                    <th className="py-3 px-4 sm:px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-500 font-mono">
                        No orders recorded yet.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const stale = isOrderStale(order);
                      const displayStatus = stale ? "failed" : order.status;

                      return (
                        <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3.5 px-4 sm:px-6 font-mono text-slate-400 text-[11px]">
                            {order.id}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 font-bold text-white">
                            @{order.username}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 font-mono text-slate-300 font-semibold">
                            ₦{order.amount.toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 font-mono text-emerald-400 font-bold">
                            ₦{(order.amountDelivered || 0).toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                displayStatus === "completed"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : displayStatus === "failed"
                                  ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                  : "bg-sky-500/10 text-sky-400 border-sky-500/30"
                              }`}>
                                {stale ? "TIMED OUT" : order.status}
                              </span>
                              <span className="text-[11px] font-mono text-slate-400">
                                {order.percentComplete}%
                              </span>
                            </div>
                            {(order.error || stale) && (
                              <div className="text-[10px] text-rose-400 mt-0.5 truncate max-w-xs">
                                ⚠️ {stale ? "Session timed out / closed by user" : order.error}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 font-mono text-slate-400 text-[11px]">
                            {order.clientIp || "—"}
                          </td>
                          <td className="py-3.5 px-4 sm:px-6 text-right">
                            {order.clientIp && (
                              <button
                                onClick={() => handleBlockIp(order.clientIp!, `Blocked from Order ${order.id}`)}
                                disabled={isBlockingIp}
                                className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 border border-rose-500/20 text-[11px] font-bold transition-all cursor-pointer"
                              >
                                🚫 Block IP
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: SECURITY & BLOCKED IPS */}
          {activeTab === "security" && (
            <div className="p-4 sm:p-6 space-y-6">
              {/* Form: Block Any IP Immediately */}
              <div className="p-4 sm:p-5 rounded-2xl bg-[#080d18] border border-slate-800 space-y-3">
                <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>🚫</span>
                  <span>Block Any IP Address Immediately</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Instantly revokes access to `/api/fund`, `/api/verify-user`, and `/api/status` for this IP address.
                </p>

                <div className="flex flex-col sm:flex-row items-stretch gap-2.5 pt-1">
                  <input
                    type="text"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    placeholder="Enter IP (e.g. 102.89.45.12)..."
                    className="flex-1 bg-[#0e1626] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500/80 font-mono"
                  />
                  <input
                    type="text"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="Reason (e.g. Abusive automated requests)..."
                    className="flex-1 bg-[#0e1626] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500/80"
                  />
                  <button
                    onClick={() => handleBlockIp(manualIp, manualReason || "Blocked by administrator")}
                    disabled={isBlockingIp || !manualIp.trim()}
                    className="px-5 py-2.5 min-h-[42px] rounded-xl bg-rose-500 hover:bg-rose-400 disabled:opacity-50 text-white font-bold text-xs transition-all cursor-pointer shrink-0"
                  >
                    {isBlockingIp ? "Blocking..." : "Block IP Now"}
                  </button>
                </div>
              </div>

              {/* List of Blocked IPs */}
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Currently Blocked IP Addresses ({blockedIps.length})
                </h4>

                {blockedIps.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800 rounded-2xl">
                    No IP addresses are currently blocked.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[600px]">
                      <thead className="bg-[#080d18]/70 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800/80">
                        <tr>
                          <th className="py-3 px-4 sm:px-6">Blocked IP</th>
                          <th className="py-3 px-4 sm:px-6">Reason</th>
                          <th className="py-3 px-4 sm:px-6">Date Restricted</th>
                          <th className="py-3 px-4 sm:px-6 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-medium">
                        {blockedIps.map((b) => (
                          <tr key={b.ip} className="hover:bg-slate-800/30 transition-colors">
                            <td className="py-3.5 px-4 sm:px-6 font-mono font-bold text-rose-400">
                              {b.ip}
                            </td>
                            <td className="py-3.5 px-4 sm:px-6 text-slate-300">
                              {b.reason || "Manual restriction"}
                            </td>
                            <td className="py-3.5 px-4 sm:px-6 text-slate-400 font-mono text-[11px]">
                              {formatDate(b.blockedAt)}
                            </td>
                            <td className="py-3.5 px-4 sm:px-6 text-right">
                              <button
                                onClick={() => handleUnblockIp(b.ip)}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-300 border border-slate-700 text-xs font-bold transition-all cursor-pointer"
                              >
                                Unblock
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
