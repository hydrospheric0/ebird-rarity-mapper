#!/usr/bin/env python3
"""
Test script: Fetch all US notable observations and summarize per-state counts.
Shows how many total records the /data/obs/US/recent/notable endpoint returns
and whether aggregating them at the state level is feasible.

Usage:
    EBIRD_API_KEY=your_key python3 notable_state_counts.py [--back N]
    python3 notable_state_counts.py --api-key your_key [--back N]
"""

import sys
import os
import argparse
import time
import urllib.request
import urllib.parse
import json

ABA_COLORS = {
    "1": "★★★★★",
    "2": "★★★★☆",
    "3": "★★★☆☆",
    "4": "★★☆☆☆",
    "5": "★☆☆☆☆",
    "6": "☆☆☆☆☆",
    "0": "(unknown)",
}

STATE_NAMES = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
    "CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
    "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa",
    "KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland",
    "MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
    "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire",
    "NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina",
    "ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania",
    "RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee",
    "TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
    "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"Dist. of Columbia",
}


def fetch_notable(api_key: str, back: int) -> list:
    url = f"https://api.ebird.org/v2/data/obs/US/recent/notable?detail=full&back={back}"
    req = urllib.request.Request(
        url,
        headers={
            "X-eBirdApiToken": api_key,
            "Accept": "application/json",
            "User-Agent": "ebird-notable-test-script",
        },
    )
    print(f"  Fetching: {url}")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = json.loads(resp.read().decode())
    elapsed = time.time() - t0
    print(f"  Response: {len(raw)} records in {elapsed:.1f}s")
    return raw


def main():
    parser = argparse.ArgumentParser(description="Summarize US notable eBird obs by state")
    parser.add_argument("--api-key", default=os.environ.get("EBIRD_API_KEY"), help="eBird API key")
    parser.add_argument("--back", type=int, default=7, choices=range(1, 15),
                        metavar="[1-14]", help="Days back (default 7)")
    args = parser.parse_args()

    if not args.api_key:
        print("ERROR: No API key. Set EBIRD_API_KEY env var or pass --api-key KEY")
        sys.exit(1)

    print(f"\n=== US Notable Observations — last {args.back} day(s) ===\n")
    records = fetch_notable(args.api_key, args.back)

    # Aggregate by state
    states: dict[str, dict] = {}
    skipped = 0
    for item in records:
        code = (item.get("subnational1Code") or "").upper()
        if not code.startswith("US-"):
            skipped += 1
            continue
        st = code[3:]
        if len(st) != 2:
            skipped += 1
            continue
        if st not in states:
            states[st] = {"total": 0, "aba": {}}
        states[st]["total"] += 1
        # ABA code — simplified lookup by common name pattern
        com = item.get("comName") or ""
        aba = guess_aba_slot(com, item)
        states[st]["aba"][aba] = states[st]["aba"].get(aba, 0) + 1

    print(f"  Skipped {skipped} records with no valid US state code\n")

    if not states:
        print("No state data found — check API key or try --back 14")
        sys.exit(1)

    # Sort by total desc
    rows = sorted(states.items(), key=lambda x: x[1]["total"], reverse=True)

    # Print table
    header = f"{'State':<22} {'Code':<5} {'Total':>6}   {'ABA breakdown'}"
    sep = "-" * 75
    print(header)
    print(sep)
    grand = 0
    for st, data in rows:
        name = STATE_NAMES.get(st, st)
        total = data["total"]
        grand += total
        aba_parts = []
        for k in sorted(data["aba"].keys()):
            aba_parts.append(f"{data['aba'][k]}×ABA{k}")
        aba_str = "  ".join(aba_parts) if aba_parts else ""
        print(f"{name:<22} {st:<5} {total:>6}   {aba_str}")

    print(sep)
    print(f"{'TOTAL':<22} {'--':<5} {grand:>6}")
    print(f"\nTotal unique records fetched from API: {len(records)}")
    print(f"States with notable obs: {len(states)}")

    # Size estimate
    # Rough estimate: full detail records are ~600 bytes each
    est_kb = len(records) * 600 / 1024
    print(f"\nEstimated response payload: ~{est_kb:.0f} KB ({est_kb/1024:.1f} MB)")
    if est_kb > 1024:
        print("  ⚠  This exceeds 1 MB — likely too large to cache efficiently in Cloudflare.")
    elif est_kb > 512:
        print("  ⚠  This is substantial. Consider whether caching is reliable at this size.")
    else:
        print("  ✓  Payload is manageable.")


def guess_aba_slot(com_name: str, item: dict) -> str:
    """
    Placeholder ABA lookup — returns '0' (unknown) since we don't have the
    full aba-codes-data.js here. The worker has the real lookup.
    Replace with actual data if desired.
    """
    return "0"


if __name__ == "__main__":
    main()
