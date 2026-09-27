const langQuestions=[
  ['English','Will it rain tomorrow in Kolkata?'],['हिंदी','कल मुंबई में समुद्र में मछली पकड़ना सुरक्षित है?'],['বাংলা','চেন্নাইয়ের ৭ দিনের আবহাওয়ার পূর্বাভাস'],['தமிழ்','நாளை பூச்சிக்கொல்லி தெளிப்பது பாதுகாப்பானதா?'],['తెలుగు','రేపు చెన్నైలో చేపల వేటకు వెళ్లడం సురక్షితమేనా?'],['मराठी','उद्या कोलकात्यात कीटकनाशक फवारणी सुरक्षित आहे का?']
];
const audiences=[
{id:'farmers',icon:'✾',name:'Farmers',tagline:'FAO-56 · IMD thresholds',description:'Field decisions grounded in FAO-56 evapotranspiration and IMD agricultural thresholds.',points:['Spray windows (wind < 15 km/h, rain < 30%)','2-day irrigation demand, in millimetres','Harvest suitability for the coming week','7-day outlook plus rainfall history back to 1940'],verdictLabel:'Spray call',verdict:'Go · 06:00–09:00',tone:'go'},
{id:'fishing',icon:'≈',name:'Coastal fishing crews',tagline:'Wave · swell · wind',description:'Wave, swell and wind checks sized for small and artisanal boats.',points:['Wave height, period and direction','Plain-language safe / caution / stay-ashore calls'],verdictLabel:'Small boats',verdict:'Caution · 1.8 m swell',tone:'warn'},
{id:'ops',icon:'≋',name:'Field & disaster ops',tagline:'Cyclone · model agreement',description:'A wider lens when conditions turn, without waiting on a single source.',points:['Cyclone bulletins & regional map watch across major hubs','NOAA GFS vs ECMWF IFS model agreement, shown side by side'],verdictLabel:'Model check',verdict:'GFS ≈ IFS · agree',tone:'info'}
];
const pipeline=[
{title:'Understand the question',body:'Gemini reads your question — in any of six languages — and extracts the place, date and topic. It never answers at this stage, only listens.'},
{title:'Pull live facts',body:'Open-Meteo, ERA5 history and marine data are fetched for that exact place and date, then run through deterministic farming and safety rule engines.'},
{title:'Narrate, guarded',body:"Gemini writes the reply from those facts alone, in your language. A numbers guard scans every figure and blocks the reply if anything doesn't match the data."}
];
const features=[
['Read the sky',[['map','Interactive location map','City-level','resolution, plus a regional watch','City-level map plus a live regional watch across major Indian hubs, coloured by rain, heat and wind thresholds.',['Rain layer','Heat layer','Wind layer']],['aqi','Air quality & UV','AQI 142','example: unhealthy for sensitive groups','PM2.5, PM10 and US AQI with severity badges, plus peak solar UV for the day.',['PM2.5','PM10','US AQI','Peak UV']],['marine','Marine safety','1.8 m','swell, checked against small-boat limits','Wave height, period and swell checks tuned for coastal and artisanal fishing boats.',['Wave height','Swell period','Direction']]]],
['Decide',[['farm','Farm decision engine','06–09','tomorrow’s safe spray window','Spray windows, irrigation demand and harvest suitability, computed from live thresholds.',['Spray windows','Irrigation mm','Harvest week']],['consensus','Model consensus','2 models','compared for every forecast','NOAA GFS and ECMWF IFS forecasts placed side by side, so you know when models agree.',['NOAA GFS','ECMWF IFS']],['climate','Climate history','1940','earliest year in the rainfall record','ERA5 archive back to 1940, drawn as an inline rainfall trend chart.',['ERA5','Rainfall trend']]]],
['Stay in reach',[['voice','Voice in, voice out','6','languages, spoken or typed','Ask by speaking and have the answer read back, hands-free, in the field.',['Speech input','Read aloud']],['signin','Email or phone sign-in','0','passwords to remember','Magic-link email or SMS OTP — or skip it entirely with full-featured Guest Mode.',['Magic link','SMS OTP','Guest Mode']],['history','Saved search history','1 tap','to re-ask any past question','Signed-in users get past questions grouped by day, one tap to re-ask, one tap to delete.',['Grouped by day','Re-ask','Delete']]]]
];
const ledger=[
['live','Live & operational',['Open-Meteo weather, marine & flood APIs','FAO-56 irrigation & IMD-aligned thresholds','Gemini intent parsing + guarded narration']],
['demo','Simulated for demo',['Seeded cyclone bulletin, clearly watermarked','City-granularity regional disaster overview']],
['roadmap','On the roadmap',['Official IMD / NDMA statutory alert feeds','3 km WRF regional downscaling']]
];

const $=s=>document.querySelector(s);
$('#site-nav').addEventListener('click',e=>{if(e.target.closest('a'))setTimeout(()=>{},0)});
window.addEventListener('scroll',()=>$('#site-nav').classList.toggle('scrolled',scrollY>20),{passive:true});

function marquee(){
  const make=(arr)=>arr.map(([l,t])=>`<div class="chip"><small>${l}</small>${t}</div>`).join('');
  const m=$('#marquee'),m2=$('#marquee2'); const s=make(langQuestions);m.innerHTML=s+s;m2.innerHTML=s+s;
}
marquee();

function renderAudiences(){
  $('#audience-list').innerHTML=audiences.map((a,i)=>`<article class="audience ${i===0?'open':''}"><button class="audience-head" data-a="${a.id}"><span class="audience-icon">${a.icon}</span><span><span class="audience-title">${a.name}</span><span class="audience-tag">${a.tagline}</span></span><span class="audience-plus">+</span></button><div class="audience-body"><p>${a.description}</p><ul>${a.points.map(x=>`<li>${x}</li>`).join('')}</ul><div><div class="verdict ${a.tone==='warn'?'warn':''}"><small>${a.verdictLabel}</small><strong>${a.verdict}</strong></div><div class="verdict-note">Example of the plain call you get back</div></div></div></article>`).join('');
  document.querySelectorAll('.audience-head').forEach(btn=>btn.addEventListener('click',()=>{const card=btn.closest('.audience');document.querySelectorAll('.audience').forEach(x=>x!==card&&x.classList.remove('open'));card.classList.toggle('open');}));
}
renderAudiences();

let activePipe=0;
function renderPipeline(){
  $('#pipeline-nav').innerHTML=pipeline.map((p,i)=>`<button class="pipe-btn ${i===activePipe?'active':''}" data-i="${i}"><span class="pipe-num">${i+1}</span><span class="pipe-title">${p.title}</span><span class="pipe-body">${p.body}</span></button>`).join('');
  document.querySelectorAll('.pipe-btn').forEach(b=>b.addEventListener('click',()=>{activePipe=+b.dataset.i;renderPipeline();renderPipeCard();}));
}
function renderPipeCard(){
  const stage=activePipe;
  let html=`<div class="incoming"><span>Incoming question</span><span>Check ${stage+1} of 3</span></div><div class="question">कल मुंबई में समुद्र में मछली पकड़ना सुरक्षित है?</div><div class="question-en">“Is it safe to fish at sea off Mumbai tomorrow?”</div><div class="card-rule"></div>`;
  if(stage===0) html+=`<div class="intent-grid">${[['Place','Mumbai','19.07°N, 72.87°E'],['Date','Tomorrow','Mon, 28 Sep'],['Topic','Marine safety','Small boat'],['Language','Hindi','Reply in हिंदी']].map(x=>`<div class="intent-box"><dt>${x[0]}</dt><dd>${x[1]}</dd><dd>${x[2]}</dd></div>`).join('')}</div><p class="hero-note">No answer drafted yet. At this stage it only listens.</p>`;
  if(stage===1) html+=`<div>${[['Wave height','1.8 m','Open-Meteo Marine'],['Swell period','9 s','Open-Meteo Marine'],['Wind','24 km/h','Gusts to 31 km/h']].map(x=>`<div class="fact-row"><span>${x[0]}</span><strong>${x[1]}</strong><span style="color:rgba(239,231,214,.45);text-align:right;font:11px 'IBM Plex Mono',monospace">${x[2]}</span></div>`).join('')}</div><div class="guard"><span>Small-boat rule · wave &gt; 1.5 m</span><b>Stay ashore</b></div>`;
  if(stage===2) html+=`<div class="answer-grid"><div class="answer">कल मुंबई तट पर लहरें <mark>1.8 मी</mark> तक और हवा <mark>24 किमी/घं</mark> रहेगी। छोटी नावों के लिए किनारे पर रहना बेहतर है।<div style="margin-top:12px;color:rgba(12,20,16,.6);font-size:14px">Waves up to 1.8 m and wind at 24 km/h off Mumbai tomorrow. Small boats should stay ashore.</div></div><ul class="guard-list"><li>1.8 m <span>✓</span></li><li>24 km/h <span>✓</span></li><li>Verdict <span>✓</span></li></ul></div>`;
  $('#pipeline-card').innerHTML=html;
}
renderPipeline();renderPipeCard();

let activeFeature='map';
function getFeature(){for(const [g,items] of features){const f=items.find(x=>x[0]===activeFeature);if(f)return [g,f]}return [features[0][0],features[0][1][0]]}
function renderFeatures(){
  $('#feature-menu').innerHTML=features.map(([group,items])=>`<div class="feature-group"><h3>${group}</h3>${items.map(f=>`<button class="feature-item ${activeFeature===f[0]?'active':''}" data-f="${f[0]}"><span>${f[1]}</span><span class="feature-dot"></span></button>`).join('')}</div>`).join('');
  document.querySelectorAll('.feature-item').forEach(b=>b.addEventListener('mouseenter',()=>{activeFeature=b.dataset.f;renderFeatures();renderFeaturePanel()}));
}
function renderFeaturePanel(){
  const [,f]=getFeature();$('#feature-panel').innerHTML=`<div class="feature-stat">${f[2]}</div><div class="feature-label">${f[3]}</div><div class="feature-spacer"></div><h3>${f[1]}</h3><p>${f[4]}</p><div class="tags">${f[5].map(x=>`<span class="tag">${x}</span>`).join('')}</div>`;
}
renderFeatures();renderFeaturePanel();

$('#ledger').innerHTML=ledger.map(([s,l,items])=>`<div class="ledger-col"><div class="ledger-head"><span class="status-dot ${s==='live'?'live':s==='demo'?'demo':''}"></span>${l}</div><ul>${items.map(x=>`<li>${x}</li>`).join('')}</ul></div>`).join('');

const locBtn=$('#locate-btn');locBtn.addEventListener('click',()=>{locBtn.textContent='⌖ Locating…';setTimeout(()=>{locBtn.textContent='⌖ Howrah, just now';$('#ticket-place').textContent='Howrah, West Bengal';$('#ticket-time').textContent='Your location · just now';},900)});

// Lightweight rainfall/terrain-like animated background so the page stays fully static-server friendly.
const canvas=$('#hero-canvas'),ctx=canvas.getContext('2d');let W=0,H=0;const drops=Array.from({length:180},()=>({x:Math.random(),y:Math.random(),s:.35+Math.random()*.9,l:5+Math.random()*12}));
function resize(){W=canvas.width=innerWidth*devicePixelRatio;H=canvas.height=innerHeight*devicePixelRatio;canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}
function draw(){ctx.clearRect(0,0,innerWidth,innerHeight);ctx.strokeStyle='rgba(215,222,207,.16)';ctx.lineWidth=1;for(let x=-20;x<innerWidth+40;x+=70){ctx.beginPath();ctx.moveTo(x,innerHeight);ctx.lineTo(x+120,innerHeight-170);ctx.stroke()}for(const d of drops){d.y+=.006*d.s;if(d.y>1.1)d.y=-.1;ctx.strokeStyle='rgba(215,222,207,.12)';ctx.beginPath();ctx.moveTo(d.x*innerWidth,d.y*innerHeight);ctx.lineTo(d.x*innerWidth-2,d.y*innerHeight+d.l);ctx.stroke()}requestAnimationFrame(draw)}
resize();addEventListener('resize',resize);draw();
