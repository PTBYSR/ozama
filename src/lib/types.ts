export interface OrderBatch {
  batchId: number;
  amount: number;
  botsCount: number;
  status: 'pending' | 'sent' | 'failed';
  timestamp: string;
}

export interface OrderDoc {
  id: string;
  username: string;
  amount: number;
  status: 'queued' | 'authenticating' | 'allocating' | 'streaming' | 'completed' | 'failed';
  amountDelivered: number;
  percentComplete: number;
  botsDispatched: number;
  batches: OrderBatch[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  clientIp?: string;
}

export interface FundingLogDoc {
  id: string;
  username: string;
  amount: number;
  orderId: string;
  timestamp: string;
}

export interface CooldownCheckResult {
  username: string;
  hourlyLimit: number;
  usedLastHour: number;
  remainingAllowed: number;
  canFund: boolean;
  cooldownSeconds: number;
  nextResetIso?: string;
}

export interface SystemSettings {
  isLive: boolean;
  maintenanceMessage?: string;
  killSwitch?: boolean;
  killSwitchMessage?: string;
  maxCapacity?: number;
  updatedAt: string;
}

export interface UserSummary {
  username: string;
  totalFunded: number;
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  lastActive: string;
  lastStatus: string;
  lastIp?: string;
}

export interface BlockedIpDoc {
  ip: string;
  reason?: string;
  blockedAt: string;
}

