const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
const promptInput=$('#worldPrompt'), count=$('#charCount'), generate=$('#generateBtn'), status=$('#status');
const presets={
 gaming:{name:'NOVA WORLD',icon:'N',color:'#7c5cff',groups:[['البداية',['📢・القوانين','📣・الإعلانات','🎭・اختيار-الرتب']],['المجتمع',['💬・الدردشة-العامة','📷・لقطاتكم','🤖・أوامر-البوت']],['الصوتية',['🔊・الاستراحة','🎮・فريق-1','🏆・البطولات']]]},
 creator:{name:'STUDIO CLUB',icon:'S',color:'#f05da8',groups:[['أهلًا بك',['📢・آخر-الأخبار','✨・ابدأ-هنا','🎨・أعمالكم']],['الاستوديو',['💬・الكواليس','📸・المحتوى','💡・الأفكار']],['نتكلم',['🔊・الاستراحة','🎙・البث-المباشر']]]},
 study:{name:'FOCUS SPACE',icon:'F',color:'#4ca6ff',groups:[['الانطلاقة',['📌・القواعد','📅・الجدول','🎯・الأهداف']],['المذاكرة',['💬・نذاكر-سوا','📚・المصادر','✅・الإنجازات']],['غرف التركيز',['🔊・تركيز-1','🔊・تركيز-2','☕・استراحة']]]},
 community:{name:'ملتقى',icon:'م',color:'#ff9b51',groups:[['الترحيب',['👋・أهلًا-وسهلًا','📜・القوانين']],['المجلس',['💬・السوالف','📷・الصور','🎲・الفعاليات']],['الصوتية',['🔊・المجلس','🎵・الموسيقى']]]}
};
let zoom=1, credits=3;
function renderWorld(world){
 $('#serverName').textContent=world.name; $('#projectTitle').textContent=world.name; $('#botWorld').textContent=world.name; $('#serverIcon').textContent=world.icon;
 $('#serverIcon').style.background=`linear-gradient(145deg,${world.color},#34266f)`;
 const wrap=$('#channelGroups'); wrap.innerHTML='';
 world.groups.forEach((group,gi)=>{const box=document.createElement('div');box.className='channel-group';box.innerHTML=`<div class="category">⌄ ${group[0]}</div>`;group[1].forEach((name,i)=>{const row=document.createElement('div');row.className='channel'+(gi===1&&i===0?' active':'');const isVoice=name.includes('🔊')||name.includes('🎙')||name.includes('🎵');row.innerHTML=`<span class="channel-icon">${isVoice?'◖':'#'}</span><span>${name.split('・')[1]||name}</span>${gi===0?'<span class="lock">⚙</span>':''}`;row.onclick=()=>{ $$('.channel').forEach(x=>x.classList.remove('active'));row.classList.add('active'); const label=name.split('・')[1]||name;$('#activeChannel').textContent=label;$('#welcomeChannel').textContent='#'+label;$('.composer span').textContent='مراسلة #'+label;};box.appendChild(row)});wrap.appendChild(box)});
}
function inferWorld(text){const t=text.toLowerCase();if(/دراس|مذاكر|تعليم|جامعة/.test(t))return presets.study;if(/محتوى|يوتيو|بث|صانع/.test(t))return presets.creator;if(/عام|سوالف|أصدقاء/.test(t))return presets.community;return presets.gaming}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
promptInput.addEventListener('input',()=>{count.textContent=promptInput.value.length; if(promptInput.value.length>300)promptInput.value=promptInput.value.slice(0,300)});
$$('.chips button').forEach(b=>b.onclick=()=>{promptInput.value=b.dataset.prompt;count.textContent=promptInput.value.length;promptInput.focus()});
$$('.template').forEach(b=>b.onclick=()=>{renderWorld(presets[b.dataset.template]);toast('تم تطبيق القالب، تقدر تعدّل كل التفاصيل')});
generate.onclick=()=>{if(!promptInput.value.trim()){toast('اكتب وصفًا بسيطًا لعالمك أولًا');promptInput.focus();return}if(credits===0){toast('استخدم القوالب الآن أو انتظر تجدد الرصيد');return}generate.classList.add('loading');status.textContent='أحلّل الفكرة وأبني الهوية…';setTimeout(()=>{status.textContent='أرتّب القنوات والرتب…';},700);setTimeout(()=>{const world={...inferWorld(promptInput.value)};if(/فضا|كوكب|مجر/.test(promptInput.value)){world.name='ORBIT WORLD';world.icon='O';world.color='#715cff'}renderWorld(world);generate.classList.remove('loading');credits--;$('.credit-count').textContent=credits+'/3';$('.credit b').textContent=credits+' تصميمات مجانية متبقية';status.textContent='اكتمل عالمك ✦';toast('تم إنشاء العالم — جرّب الضغط على القنوات');setTimeout(()=>status.textContent='',2500)},1500)};
$('#zoomIn').onclick=()=>setZoom(Math.min(1.2,zoom+.1));$('#zoomOut').onclick=()=>setZoom(Math.max(.6,zoom-.1));function setZoom(v){zoom=Number(v.toFixed(1));$('#zoomValue').textContent=Math.round(zoom*100)+'%';$('#discordWindow').style.transform=`scale(${zoom})`}
$('#resetBtn').onclick=()=>{renderWorld(presets.gaming);setZoom(1);toast('رجعنا التصميم الأساسي')};
$('#connectBtn').onclick=()=>$('#modal').hidden=false;$('#modalClose').onclick=()=>$('#modal').hidden=true;$('#modal').onclick=e=>{if(e.target.id==='modal')e.currentTarget.hidden=true};
$('#previewBtn').onclick=()=>{document.body.classList.toggle('preview-mode');toast('هذه معاينة عالمك داخل ديسكورد')};
$$('.rail-item').forEach(b=>b.onclick=()=>{$$('.rail-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(b.dataset.panel&&b.dataset.panel!=='ai')toast('قسم '+b.querySelector('span:last-child').textContent+' جاهز للنسخة القادمة')});
$('.floating-hint button').onclick=e=>e.currentTarget.parentElement.remove();
renderWorld(presets.gaming);
