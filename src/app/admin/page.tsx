"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { SystemSettings, UserSummary, OrderDoc } from "@/lib/types";

interface AdminStats {
  totalAmount: number;
  totalPlayers: number;
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  activeOrders: number;
  botPoolSize: number;
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
      second: "2-digit",
    });
  } catch {
    return iso;
  }
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
  });
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Status toggle form state
  const [tempIsLive, setTempIsLive] = useState(true);
  const [tempMaintenanceMsg, setTempMaintenanceMsg] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusSaveSuccess, setStatusSaveSuccess] = useState(false);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<"users" | "orders">("users");
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
        setAuthError(data.error || "Incorrect admin key");
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
        }
        if (data.stats) setStats(data.stats);
        if (data.users) setUsers(data.users);
        if (data.orders) setOrders(data.orders);
      } else if (res.status === 401) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Failed to fetch admin overview:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save Live/Down status
  const handleSaveStatus = async (newIsLive?: boolean) => {
    const targetLive = typeof newIsLive === "boolean" ? newIsLive : tempIsLive;
    setIsUpdatingStatus(true);
    setStatusSaveSuccess(false);

    try {
      const res = await fetch("/api/admin/system-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isLive: targetLive,
          maintenanceMessage: tempMaintenanceMsg,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data.settings);
        setTempIsLive(data.settings.isLive);
        setStatusSaveSuccess(true);
        setTimeout(() => setStatusSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Status update error:", err);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Quick toggle helper
  const handleQuickToggle = (nextLive: boolean) => {
    setTempIsLive(nextLive);
    handleSaveStatus(nextLive);
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
      <div className="min-h-screen bg-[#070b14] flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-mono tracking-wider">VERIFYING COMMAND SESSION...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col items-center justify-center p-4 selection:bg-emerald-500 selection:text-black">
        <div className="w-full max-w-md bg-[#0e1626]/90 border border-slate-800/80 rounded-3xl p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          {/* Glowing background decor */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 text-2xl mb-3 shadow-inner">
              🔥
            </div>
            <h1 className="text-2xl font-bold font-display tracking-tight text-white flex items-center justify-center gap-2">
              Ozama <span>Swarm Command</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">Authorized personnel only. Enter root access password.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Admin Master Key
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
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
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
  // Authenticated Admin Dashboard
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 selection:bg-emerald-500 selection:text-black">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-[#0a101d]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-lg">
              🔥
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-base text-white tracking-tight">Ozama</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold tracking-wider uppercase">
                  Admin Console
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Lagos Life Swarm Telemetry & Access Control</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchOverview}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
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
              className="px-3.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <span>Public Desk</span>
              <span className="opacity-60">↗</span>
            </Link>

            <button
              onClick={() => {
                document.cookie = "ozama_admin_token=; Max-Age=0; path=/;";
                setIsAuthenticated(false);
              }}
              className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 text-xs font-semibold transition-all cursor-pointer"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* ========================================================= */}
        {/* SWARM STATUS TOGGLE CONTROL PANEL (CRUCIAL USER REQUEST) */}
        {/* ========================================================= */}
        <section className={`rounded-3xl border p-6 sm:p-7 backdrop-blur-xl transition-all shadow-2xl relative overflow-hidden ${
          systemStatus.isLive
            ? "bg-gradient-to-br from-[#0c1c1a]/95 via-[#0a1622]/95 to-[#070b14]/95 border-emerald-500/30 shadow-emerald-950/20"
            : "bg-gradient-to-br from-[#210e14]/95 via-[#180e1a]/95 to-[#070b14]/95 border-rose-500/30 shadow-rose-950/20"
        }`}>
          {/* Subtle Ambient Radial Glow */}
          <div className={`absolute top-0 right-0 w-80 h-80 rounded-full blur-3xl pointer-events-none opacity-20 ${
            systemStatus.isLive ? "bg-emerald-500" : "bg-rose-500"
          }`} />

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
            {/* Status Information */}
            <div className="space-y-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Global Public Site Activity Control
                </span>
                <span className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold border ${
                  systemStatus.isLive
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    systemStatus.isLive ? "bg-emerald-400 animate-pulse" : "bg-rose-500 animate-ping"
                  }`} />
                  {systemStatus.isLive ? "STATUS: LIVE (OPERATIONAL)" : "STATUS: DOWN (MAINTENANCE)"}
                </span>
                {statusSaveSuccess && (
                  <span className="text-xs font-semibold text-emerald-400 animate-in fade-in">
                    ✓ Updated on server & public site!
                  </span>
                )}
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-display tracking-tight flex items-center gap-2">
                {systemStatus.isLive ? (
                  <>
                    <span className="text-emerald-400">🟢 Swarm Is Live</span>
                    <span className="text-slate-400 font-light text-base sm:text-lg">
                      — Public users can fund without interruption
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-rose-400">🔴 Swarm Is Down</span>
                    <span className="text-slate-400 font-light text-base sm:text-lg">
                      — Public desk disabled with maintenance notice
                    </span>
                  </>
                )}
              </h2>

              <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
                {systemStatus.isLive
                  ? "All dispatch workers, bot balance inflations, and player search endpoints are active. Toggling this Down will immediately block public submissions on /api/fund and render a maintenance banner on the homepage."
                  : "Funding desk is currently locked. The public site displays the Swarm as offline and rejects incoming mint requests."}
              </p>
            </div>

            {/* Big Interactive Toggle Button Switch */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => handleQuickToggle(true)}
                disabled={isUpdatingStatus}
                className={`px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer border ${
                  systemStatus.isLive
                    ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-500/25 ring-2 ring-emerald-400/50"
                    : "bg-slate-900/80 hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-300 border-slate-700/80"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span>Switch to LIVE</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickToggle(false)}
                disabled={isUpdatingStatus}
                className={`px-5 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer border ${
                  !systemStatus.isLive
                    ? "bg-rose-500 text-white border-rose-400 shadow-lg shadow-rose-500/25 ring-2 ring-rose-400/50"
                    : "bg-slate-900/80 hover:bg-rose-500/10 text-slate-400 hover:text-rose-300 border-slate-700/80"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <span>Switch to DOWN</span>
              </button>
            </div>
          </div>

          {/* Optional Maintenance Notice Input */}
          <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Custom Maintenance Announcement Message (optional)
              </label>
              <input
                type="text"
                value={tempMaintenanceMsg}
                onChange={(e) => setTempMaintenanceMsg(e.target.value)}
                placeholder="e.g. Swarm nodes recharging daily balances. Re-opening at 12:00 UTC."
                className="w-full bg-[#080d18] border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <button
              onClick={() => handleSaveStatus()}
              disabled={isUpdatingStatus}
              className="self-end sm:self-auto px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 text-xs font-semibold transition-all cursor-pointer"
            >
              {isUpdatingStatus ? "Saving..." : "Save Message"}
            </button>
          </div>
        </section>

        {/* ========================================================= */}
        {/* STATS OVERVIEW CARDS */}
        {/* ========================================================= */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Total Volume Delivered</span>
              <span className="text-emerald-400 text-base">₦</span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-display">
              {formatCompactNaira(stats.totalAmount)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-mono">
              ₦{stats.totalAmount.toLocaleString()} exact
            </div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Registered Players</span>
              <span className="text-teal-400 text-sm">👥</span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-display">
              {stats.totalPlayers}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Unique target usernames funded</div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Total Orders</span>
              <span className="text-sky-400 text-sm">📦</span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-display">
              {stats.totalOrders}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
              <span className="text-emerald-400 font-semibold">{stats.completedOrders} completed</span>
              <span>•</span>
              <span className="text-rose-400 font-semibold">{stats.failedOrders} failed</span>
            </div>
          </div>

          <div className="bg-[#0e1626]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Bot Swarm Nodes</span>
              <span className="text-amber-400 text-sm">⚡</span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-display">
              {stats.botPoolSize}
            </div>
            <div className="text-[11px] text-emerald-400 mt-1 font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Rotational Failover Ready</span>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* USERS LIST & ORDERS TABS */}
        {/* ========================================================= */}
        <div className="bg-[#0e1626]/90 border border-slate-800/80 rounded-3xl backdrop-blur-xl shadow-xl overflow-hidden">
          {/* Tab Header & Search Toolbar */}
          <div className="p-4 sm:p-6 border-b border-slate-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {/* Tabs */}
            <div className="flex items-center gap-2 bg-[#080d18] p-1.5 rounded-2xl border border-slate-800">
              <button
                onClick={() => setActiveTab("users")}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
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
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
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
            </div>

            {/* Search Input & Status Filter */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by username..."
                  className="w-full bg-[#080d18] border border-slate-700/80 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60"
                />
              </div>

              {activeTab === "orders" && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-[#080d18] border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/60 cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="streaming">Streaming</option>
                  <option value="failed">Failed</option>
                  <option value="queued">Queued</option>
                </select>
              )}
            </div>
          </div>

          {/* Tab 1: Users Directory Table */}
          {activeTab === "users" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#080d18]/70 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800/80">
                  <tr>
                    <th className="py-3.5 px-6">Player Username</th>
                    <th className="py-3.5 px-6">Total Naira Received</th>
                    <th className="py-3.5 px-6">Orders Count</th>
                    <th className="py-3.5 px-6">Last Known Status</th>
                    <th className="py-3.5 px-6">Last Activity</th>
                    <th className="py-3.5 px-6 text-right">Lagos Life Profile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-500 font-mono">
                        No players found matching &ldquo;{searchQuery}&rdquo;
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.username} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-xs">
                              {user.username.charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <span className="font-bold text-white text-sm">@{user.username}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-mono text-emerald-400 font-bold text-sm">
                          ₦{user.totalFunded.toLocaleString()}
                        </td>
                        <td className="py-4 px-6 text-slate-300">
                          <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/60 font-mono text-[11px]">
                            {user.totalOrders} {user.totalOrders === 1 ? "order" : "orders"}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
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
                        </td>
                        <td className="py-4 px-6 text-slate-400 font-mono text-[11px]">
                          {formatDate(user.lastActive)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <a
                            href={`https://lagoslife.eliysites.com`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 hover:underline font-semibold"
                          >
                            <span>Open In Game</span>
                            <span>↗</span>
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Orders History Table */}
          {activeTab === "orders" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#080d18]/70 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800/80">
                  <tr>
                    <th className="py-3.5 px-6">Order ID</th>
                    <th className="py-3.5 px-6">Target Player</th>
                    <th className="py-3.5 px-6">Requested</th>
                    <th className="py-3.5 px-6">Delivered</th>
                    <th className="py-3.5 px-6">Status & Progress</th>
                    <th className="py-3.5 px-6">Batches</th>
                    <th className="py-3.5 px-6">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 font-mono">
                        No orders recorded yet.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-4 px-6 font-mono text-slate-400 text-[11px]">
                          {order.id}
                        </td>
                        <td className="py-4 px-6 font-bold text-white">
                          @{order.username}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-300 font-semibold">
                          ₦{order.amount.toLocaleString()}
                        </td>
                        <td className="py-4 px-6 font-mono text-emerald-400 font-bold">
                          ₦{(order.amountDelivered || 0).toLocaleString()}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                              order.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                : order.status === "failed"
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                                : "bg-sky-500/10 text-sky-400 border-sky-500/30"
                            }`}>
                              {order.status}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              {order.percentComplete}%
                            </span>
                          </div>
                          {order.error && (
                            <div className="text-[10px] text-rose-400 mt-1 truncate max-w-xs" title={order.error}>
                              ⚠️ {order.error}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-400 text-[11px]">
                          {order.batches?.length || 0} batches
                        </td>
                        <td className="py-4 px-6 text-slate-400 font-mono text-[11px]">
                          {formatDate(order.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
