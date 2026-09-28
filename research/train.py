"""Offline chronological training, held-out calibration and untouched test.
No random split, parameter sweep, synthetic training data or automatic promotion.
"""
import argparse, json, time, hashlib
from pathlib import Path
import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import softmax
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import log_loss

def split_purged(rows, fractions=(.6,.8)):
    n=len(rows); a=int(n*fractions[0]); b=int(n*fractions[1])
    train=[r for r in rows[:a] if int(r['final_t'])<int(rows[a]['t'])]
    validation=[r for r in rows[a:b] if int(r['final_t'])<int(rows[b]['t'])]
    return train,validation,rows[b:]

def arrays(rows):
    return np.array([r['features']['vector'] for r in rows],float),np.array([r['label'] for r in rows],int)

def metrics(y,p):
    one=np.eye(3)[y]; pred=p.argmax(axis=1); conf=p.max(axis=1); ece=0.; bins=[]
    for lo in np.arange(0,1,.1):
        selected=(conf>=lo)&(conf<lo+.1 if lo<.9 else conf<=1)
        count=int(selected.sum())
        if count:
            observed=float((pred[selected]==y[selected]).mean()); probability=float(conf[selected].mean())
            ece+=count/len(y)*abs(observed-probability)
            bins.append(dict(lower=float(lo),count=count,predicted=probability,observed=observed))
    return dict(brier=float(np.mean(np.sum((p-one)**2,axis=1))),ece=float(ece),logLoss=float(log_loss(y,p,labels=[0,1,2])),accuracy=float((pred==y).mean()),calibrationBins=bins)

def fit(train,val):
    x,y=arrays(train); vx,vy=arrays(val)
    if set(y)!={0,1,2} or set(vy)!={0,1,2}: raise ValueError('Each train/calibration partition needs all three classes')
    scaler=StandardScaler().fit(x)
    model=LogisticRegression(C=1.,max_iter=2000,solver='lbfgs').fit(scaler.transform(x),y)
    logits=model.decision_function(scaler.transform(vx))
    objective=lambda logt: log_loss(vy,softmax(logits/np.exp(logt),axis=1),labels=[0,1,2])
    result=minimize_scalar(objective,bounds=(-3,3),method='bounded')
    if not result.success: raise ValueError('Calibration did not converge')
    return scaler,model,float(np.exp(result.x))

def walk_forward(rows):
    results=[]
    for ratio in (.6,.8):
        boundary=int(len(rows)*ratio); end=min(len(rows),boundary+int(len(rows)*.2))
        history=[r for r in rows[:boundary] if int(r['final_t'])<int(rows[boundary]['t'])]
        split=int(len(history)*.75); tr=[r for r in history[:split] if int(r['final_t'])<int(history[split]['t'])]; cal=history[split:]; test=rows[boundary:end]
        if min(len(tr),len(cal),len(test))<100: raise ValueError('Insufficient walk-forward partition')
        sc,model,temp=fit(tr,cal); x,y=arrays(test); p=softmax(model.decision_function(sc.transform(x))/temp,axis=1)
        results.append(dict(trainEnd=int(tr[-1]['final_t']),testStart=int(test[0]['t']),testEnd=int(test[-1]['final_t']),count=len(test),**metrics(y,p)))
    return results

def train_group(rows,meta,symbol,horizon,out):
    rows=sorted(rows,key=lambda r:int(r['t']))
    if len(rows)<1500: raise ValueError(f'{len(rows)} samples, minimum 1500')
    if len({int(r['t']) for r in rows})!=len(rows): raise ValueError('Duplicate timestamps')
    for r in rows:
        f=r['features']; ret=float(r['return']); expected=2 if ret>meta['threshold'] else 0 if ret< -meta['threshold'] else 1
        if f['version']!=meta['featureVersion'] or f['names']!=meta['featureNames']: raise ValueError('Mixed feature versions')
        if int(f['t'])!=int(r['t']) or int(r['due'])!=int(r['t'])+horizon*60000: raise ValueError('Invalid feature/label timestamp')
        if not int(r['due'])<=int(r['final_t'])<=int(r['due'])+2000: raise ValueError('Invalid settlement tolerance')
        if r['label']!=expected or not np.isfinite(f['vector']).all(): raise ValueError('Invalid label/features')
    tr,cal,test=split_purged(rows)
    if len(test)<200: raise ValueError('Minimum 200 untouched test samples')
    sc,model,temp=fit(tr,cal); tx,ty=arrays(test); p=softmax(model.decision_function(sc.transform(tx))/temp,axis=1)
    # Walk-forward remains entirely before the final untouched test period.
    wf=walk_forward(tr+cal)
    result=metrics(ty,p); now=int(time.time()*1000)
    fingerprint=hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest()
    model_id=f'{symbol}-{horizon}m-{fingerprint[:12]}'
    artifact=dict(id=model_id,symbol=symbol,horizon=horizon,featureVersion=meta['featureVersion'],featureNames=meta['featureNames'],classes=model.classes_.tolist(),mean=sc.mean_.tolist(),scale=sc.scale_.tolist(),coef=model.coef_.tolist(),intercept=model.intercept_.tolist(),temperature=temp,threshold=meta['threshold'],createdAt=now,trainEnd=int(tr[-1]['final_t']),calibrationEnd=int(cal[-1]['final_t']),testStart=int(test[0]['t']),testEnd=int(test[-1]['final_t']),sampleCount=len(rows),testCount=len(test),metrics=result,walkForward=wf,datasetSHA256=fingerprint)
    Path(out).mkdir(parents=True,exist_ok=True)
    Path(out,f'{symbol}-{horizon}.json').write_text(json.dumps(artifact,indent=2))
    probs=[dict(t=int(r['t']),due=int(r['due']),label=int(y),probabilities=prob.tolist(),price=r['features']['price'],return_=r['return']) for r,y,prob in zip(test,ty,p)]
    Path(out,f'{symbol}-{horizon}.predictions.jsonl').write_text('\n'.join(json.dumps(r) for r in probs))
    return dict(symbol=symbol,horizon=horizon,samples=len(rows),train=len(tr),validation=len(cal),test=len(test),**result)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('dataset');ap.add_argument('--out',default='research/candidates');args=ap.parse_args();meta=json.loads(Path(args.dataset).read_text())
    if meta['source']!='prospective-market-observations': raise ValueError('Unsupported data provenance')
    reports=[]
    for symbol,h in sorted({(r['symbol'],int(r['horizon'])) for r in meta['rows']}):
        try: reports.append(train_group([r for r in meta['rows'] if r['symbol']==symbol and int(r['horizon'])==h],meta,symbol,h,args.out))
        except ValueError as error: reports.append(dict(symbol=symbol,horizon=h,status='INSUFFICIENT_OR_INVALID',reason=str(error)))
    Path(args.out).mkdir(parents=True,exist_ok=True);Path(args.out,'report.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports,indent=2))
if __name__=='__main__': main()
