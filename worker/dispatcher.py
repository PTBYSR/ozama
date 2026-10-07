#!/usr/bin/env python3
"""
Ozama Bot Fulfillment Worker
Connects to x-bot/lagoslife_registry.json to disburse funds to target players.
Can read orders directly from MongoDB (via pymongo) or local data/ozama.json.
"""

import os
import sys
import time
import json
import random
import requests
from typing import Dict, Any, List

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "x-bot", "lagoslife_registry.json")
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "ozama.json")
BASE_URL = "https://lagoslife.eliysites.com"

def load_registry() -> Dict[str, Any]:
    if not os.path.exists(REGISTRY_PATH):
        print(f"[!] Registry not found at {REGISTRY_PATH}")
        return {"accounts": [], "sessions": {}}
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[!] Error loading registry: {e}")
        return {"accounts": [], "sessions": {}}

def process_pending_orders():
    print("[*] Ozama Fulfillment Worker started...")
    registry = load_registry()
    total_bots = len(registry.get("accounts", []))
    print(f"[*] Loaded {total_bots} active bot profiles from registry.")

    while True:
        if os.path.exists(DATA_PATH):
            try:
                with open(DATA_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                orders = data.get("orders", [])
                pending = [o for o in orders if o.get("status") in ["queued", "processing"]]
                
                if pending:
                    for order in pending:
                        print(f"[+] Processing order {order['id']} for @{order['username']}: ₦{order['amount']:,}")
            except Exception as e:
                pass
        
        time.sleep(5)

if __name__ == "__main__":
    process_pending_orders()
