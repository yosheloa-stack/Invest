"""Synthetic fixtures for temporal integrity only; no model delivered from tests."""
import sys,unittest,tempfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research'))
from train import split_purged,metrics,train_group
import numpy as np
class ResearchTests(unittest.TestCase):
    def test_purge(self):
        rows=[dict(t=i*60000,final_t=i*60000+900000) for i in range(200)]
        train,val,test=split_purged(rows)
        self.assertLess(train[-1]['final_t'],val[0]['t'])
        self.assertLess(val[-1]['final_t'],test[0]['t'])
    def test_perfect_calibration(self):
        result=metrics(np.array([0,1,2]),np.eye(3))
        self.assertEqual(result['brier'],0)
        self.assertEqual(result['ece'],0)
    def test_wrong_probabilities_have_error(self):
        result=metrics(np.array([0,1,2]),np.array([[.1,.8,.1],[.1,.1,.8],[.8,.1,.1]]))
        self.assertGreater(result['brier'],1)
    def test_complete_training_pipeline_on_explicit_fixture(self):
        # Synthetic data are a test-only fixture; artifacts live in an auto-deleted directory.
        rows=[]
        for k in range(2100):
            t=1700000000000+k*60000
            label=k%3
            rows.append(dict(symbol='TESTUSDT',horizon=5,t=t,due=t+300000,final_t=t+300100,label=label,**{'return':[-.002,0,.002][label]},features=dict(version='fixture',names=['x','z'],vector=[float(label),float(k%7)],t=t,price=100)))
        meta=dict(threshold=.0005,featureVersion='fixture',featureNames=['x','z'])
        with tempfile.TemporaryDirectory() as tmp:
            report=train_group(rows,meta,'TESTUSDT',5,tmp)
            artifact=json.loads(Path(tmp,'TESTUSDT-5.json').read_text())
            self.assertEqual(report['samples'],2100)
            self.assertEqual(len(artifact['walkForward']),2)
            self.assertLess(artifact['trainEnd'],artifact['calibrationEnd'])
            self.assertLess(artifact['calibrationEnd'],artifact['testStart'])
            self.assertTrue(artifact['temperature']>0)
if __name__=='__main__':unittest.main()
