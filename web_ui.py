from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request

from main import process

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
HTML = r'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ID Card Reader</title><style>
:root{font-family:Arial,sans-serif;color:#14213d;background:#f3f5f9}*{box-sizing:border-box}body{margin:0;padding:32px 18px}.wrap{max-width:850px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px}h1{font-size:24px;margin:0 0 7px}p{color:#65738b;margin:0}.card{background:white;border:1px solid #dfe5ef;border-radius:14px;padding:22px;margin-top:18px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.preview{height:260px;background:#101f3d;border-radius:12px;display:grid;place-items:center;overflow:hidden;color:#dbe6ff;margin:16px 0}.preview img,.preview video{width:100%;height:100%;object-fit:contain}.buttons{display:flex;gap:9px;flex-wrap:wrap}button,.upload{border:1px solid #d8dfeb;background:white;border-radius:9px;padding:11px 15px;font-size:14px;cursor:pointer;color:#14213d}.primary{background:#245cf5;color:white;border-color:#245cf5}input[type=file]{display:none}.upload{display:inline-block}#status{margin-top:16px;color:#56657d}pre{white-space:pre-wrap;word-break:break-word;background:#f7f8fb;padding:14px;border-radius:9px;max-height:440px;overflow:auto}video{display:none}@media(max-width:650px){.grid{grid-template-columns:1fr}body{padding:22px 14px}}
</style><div class="wrap"><header><div><h1>ID Card Reader</h1><p>Upload an image or capture one with your camera.</p></div></header><div class="grid"><section class="card"><b>Your ID image</b><div class="preview" id="preview"><span id="empty">Choose an image to preview</span><img id="photo" hidden></div><div class="buttons"><label class="upload" for="file">Upload image</label><input id="file" type="file" accept="image/*"><button class="primary" id="camera">Use camera</button><button id="capture" hidden>Capture photo</button><button id="stop" hidden>Stop camera</button></div><video id="video" autoplay playsinline></video><div id="status"></div><div class="buttons"><button class="primary" id="scan" disabled>Read ID</button></div></section><section class="card"><b>Extracted information</b><p style="margin-top:8px">Your OCR results will appear here.</p><pre id="result">No image processed yet.</pre></section></div></div><script>
let chosen=null,stream=null;const file=document.querySelector('#file'),photo=document.querySelector('#photo'),video=document.querySelector('#video'),status=document.querySelector('#status'),scan=document.querySelector('#scan');function show(blob,name){chosen=blob;photo.src=URL.createObjectURL(blob);photo.hidden=false;document.querySelector('#empty').hidden=true;scan.disabled=false;status.textContent=name||'Image ready';document.querySelector('#result').textContent='Ready to read this image.'}file.onchange=()=>{if(file.files[0])show(file.files[0],file.files[0].name)};document.querySelector('#camera').onclick=async()=>{try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});video.srcObject=stream;video.style.display='block';photo.hidden=true;document.querySelector('#capture').hidden=false;document.querySelector('#stop').hidden=false;status.textContent='Camera ready'}catch(e){status.textContent='Could not access camera. Check browser permission or upload an image.'}};document.querySelector('#capture').onclick=()=>{const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);c.toBlob(b=>{show(b,'Camera capture');stop()},'image/jpeg',.92)};function stop(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.style.display='none';document.querySelector('#capture').hidden=true;document.querySelector('#stop').hidden=true}document.querySelector('#stop').onclick=stop;
const labels={name:'Name',father_name:"Father's name",mother_name:"Mother's name",dob:'Date of birth',phone:'Mobile',email:'Email',institution:'Institution',company:'Company',course:'Course',class_section:'Class / section',employee_id:'Employee ID',id_number:'ID number',dl_number:'Licence number',aadhaar_number:'Aadhaar number',pan_number:'PAN',passport_number:'Passport number',voter_id:'Voter ID',card_number:'Card number',issued_on:'Issued',valid_till:'Valid until',address:'Address',pincode:'PIN code',landline:'Landline',website:'Website',remarks:'Remarks'};function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function present(d){const el=document.querySelector('#result');let h=`<div style="padding:12px;background:#f1f5ff;border-radius:10px"><strong>${esc(d.doc_type_label||'Document')}</strong><div style="font-size:13px;color:#68758a;margin-top:5px">${esc(d.side_hint||'')} side · ${Math.round((d.confidence||0)*100)}% confidence</div></div>`;const fs=Object.entries(d.fields||{});if(fs.length){h+='<div style="margin-top:12px">';for(const[k,f]of fs){const v=Array.isArray(f.value)?f.value.join(', '):f.value;h+=`<div style="display:grid;grid-template-columns:34% 1fr;gap:10px;padding:10px 2px;border-bottom:1px solid #e8edf4;font-size:14px"><span style="color:#68758a">${esc(labels[k]||k.replaceAll('_',' '))}</span><strong style="overflow-wrap:anywhere">${esc(v)}</strong></div>`}h+='</div>'}else h+='<p style="color:#68758a">No fields found. Try a clearer image.</p>';h+=`<details style="margin-top:16px"><summary style="cursor:pointer;color:#53627a">OCR details</summary><pre style="white-space:pre-wrap;word-break:break-word;background:#f7f8fb;padding:12px;border-radius:8px;font-size:12px">${esc(Object.entries(d.engines||{}).map(([k,v])=>`${k.toUpperCase()}\n${v.text||v.error||'No text detected'}`).join('\n\n'))}</pre></details>`;el.innerHTML=h}scan.onclick=async()=>{if(!chosen)return;scan.disabled=true;status.textContent='Reading image…';try{const fd=new FormData();fd.append('image',chosen,'id-image.jpg');const r=await fetch('/api/read',{method:'POST',body:fd}),data=await r.json();if(!r.ok)throw Error(data.error||'Could not process image');present(data);status.textContent='Done'}catch(e){status.textContent=e.message}finally{scan.disabled=false}};
</script></html>'''

@app.get("/")
def index():
    return render_template_string(HTML)

@app.post("/api/read")
def read_image():
    upload = request.files.get("image")
    if not upload or not upload.filename:
        return jsonify(error="Choose an image first."), 400
    ext = Path(upload.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}:
        ext = ".jpg"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"upload{ext}"
            upload.save(path)
            args = argparse.Namespace(no_rotate=False, tesseract_cmd=None, engines="both", mask=True, annotate=False)
            return jsonify(process(path, args, Path(tmp)))
    except Exception as exc:
        return jsonify(error=f"{type(exc).__name__}: {exc}"), 500

if __name__ == "__main__":
    app.run(debug=False)
