"""Local model providers. No network clients, demographic inference, or identity guessing."""
import hashlib
import json
import math
from pathlib import Path
from typing import Protocol

class Provider(Protocol):
    id: str
    version: str
    def analyze(self,path): ...

class LocalVision:
    id='visual'
    def __init__(self,models):
        import cv2,numpy as np,torch,timm
        from safetensors.torch import load_file
        from timm.data import create_transform,resolve_model_data_config,ImageNetInfo
        self.cv,self.np,self.torch=cv2,np,torch
        torch.set_num_threads(2)
        cv2.setNumThreads(2)
        self.models=Path(models)
        manifest=json.loads((self.models/'manifest.json').read_text())
        for name,info in manifest.items():
            if hashlib.sha256((self.models/name).read_bytes()).hexdigest()!=info['sha256']:
                raise ValueError('model_checksum_mismatch')
        self.version='local-v2-'+hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:12]
        self.net=timm.create_model('mobilenetv3_small_100',pretrained=False)
        self.net.load_state_dict(load_file(str(self.models/'mobilenet.safetensors')))
        self.net.eval()
        self.transform=create_transform(**resolve_model_data_config(self.net),is_training=False)
        self.labels=ImageNetInfo()
        self.detector=cv2.FaceDetectorYN.create(str(self.models/'yunet.onnx'),'',(640,640),.85,.3,1000)
        self.recognizer=cv2.FaceRecognizerSF.create(str(self.models/'sface.onnx'),'')

    def analyze(self,path,progress=lambda *args: None):
        from PIL import Image
        cv,np=self.cv,self.np
        image=Image.open(path).convert('RGB')
        progress('subject','running')
        with self.torch.inference_mode():
            inp=self.transform(image).unsqueeze(0)
            features=self.net.forward_features(inp)
            embedding=self.net.forward_head(features,pre_logits=True)[0]
            output=self.net.forward_head(features)[0].softmax(0)
            values,indices=output.topk(5)
        tags=[{'label':self.labels.index_to_description(int(i)),'confidence':round(float(v),4)} for v,i in zip(values,indices)]
        embedding=embedding/(embedding.norm()+1e-9)
        progress('subject','done')
        progress('faces','running')
        frame=cv.cvtColor(np.array(image),cv.COLOR_RGB2BGR)
        self.detector.setInputSize((image.width,image.height))
        _,faces=self.detector.detect(frame)
        found=[]
        for face in (faces if faces is not None else []):
            aligned=self.recognizer.alignCrop(frame,face)
            vector=self.recognizer.feature(aligned)[0]
            vector=vector/(np.linalg.norm(vector)+1e-9)
            found.append({'box':[float(face[0]/image.width),float(face[1]/image.height),float(face[2]/image.width),float(face[3]/image.height)],'embedding':vector.tolist(),'confidence':float(face[-1])})
        progress('faces','done')
        progress('score','running')
        gray=cv.cvtColor(frame,cv.COLOR_BGR2GRAY)/255.
        sharp=float(cv.Laplacian((gray*255).astype(np.uint8),cv.CV_64F).var())
        clipped=float(((gray<.025)|(gray>.975)).mean())
        contrast=float(gray.std())
        # Transparent baseline: this is a technical quality heuristic, not a learned human-liking probability.
        sharp_score=min(1,math.log1p(sharp)/math.log(1001))
        exposure=max(0,1-clipped*2)
        edges=cv.Sobel(gray,cv.CV_64F,1,0)**2+cv.Sobel(gray,cv.CV_64F,0,1)**2
        h,w=gray.shape
        ys,xs=np.indices(gray.shape)
        total=float(edges.sum())+1e-9
        cx,cy=float((edges*xs).sum()/total/w),float((edges*ys).sum()/total/h)
        composition=max(0,1-min(math.hypot(cx-x,cy-y) for x in (1/3,2/3) for y in (1/3,2/3))*2)
        score=100*(.35*sharp_score+.3*exposure+.15*min(1,contrast/.2)+.2*composition)
        small=np.array(image.resize((9,8)).convert('L'))
        signature=''.join('1' if v else '0' for v in (small[:,1:]>small[:,:-1]).flatten())
        progress('score','done')
        return {'signature':format(int(signature,2),'016x'),'tags':tags,'embedding':embedding.tolist(),'faces':found,'score':round(score,1),'scoring':'technical-composition-v1','features':{'sharpness':sharp,'clipped_fraction':clipped,'contrast':contrast,'saliency_center':[cx,cy],'thirds_proximity':composition},'offline':True}
