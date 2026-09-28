"""Evaluate held-out probabilistic forecasts. This is NOT an execution backtest.
The paper execution ledger is separately measured with observed bid/ask.
"""
import argparse,json
from pathlib import Path
import numpy as np

def evaluate(rows,cutoff,payout):
    selected=[r for r in rows if max(r['probabilities'][0],r['probabilities'][2])>=cutoff]
    wins=losses=neutrals=streak=max_streak=0
    for r in selected:
        direction=2 if r['probabilities'][2]>=r['probabilities'][0] else 0
        if r['label']==1: neutrals+=1;streak=0
        elif direction==r['label']: wins+=1;streak=0
        else: losses+=1;streak+=1;max_streak=max(max_streak,streak)
    return dict(forecasts=len(rows),selected=len(selected),wins=wins,losses=losses,neutrals=neutrals,winRate=wins/(wins+losses) if wins+losses else None,maxLossStreak=max_streak,breakEven=1/(1+payout),hypotheticalUnits=wins*payout-losses,warning='Forecast-only; overlapping horizons, no confluence replay or executable fills. Neutrals assumed refunded. Not realized P&L.')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('predictions');p.add_argument('--cutoff',type=float,default=.6);p.add_argument('--payout',type=float,default=.8);a=p.parse_args()
    if not .5<=a.cutoff<1 or not 0<a.payout<=1: p.error('Invalid cutoff or payout')
    rows=[json.loads(line) for line in Path(a.predictions).read_text().splitlines() if line.strip()];print(json.dumps(evaluate(rows,a.cutoff,a.payout),indent=2))
