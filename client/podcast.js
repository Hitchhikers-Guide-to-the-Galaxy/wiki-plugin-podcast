(()=>{var L="/system/api/podcast",n=o=>String(o??"").replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),T=o=>o?new Date(o).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"",P=o=>o?`${Math.round(o/60)} min`:"",S=o=>{try{return new URL(o).host.replace(/^www\./,"")}catch{return o}};function x(o){let a={input:"",title:void 0,recent:void 0};for(let d of String(o||"").split(`
`).map(s=>s.trim()).filter(Boolean)){let s=d.match(/^([A-Z]+):?\s+(.*)$/);s&&s[1]==="TITLE"?a.title=s[2]:s&&s[1]==="RECENT"?a.recent=parseInt(s[2],10)||void 0:a.input||(a.input=d)}return a}async function y(o,a){let d=await fetch(`${L}/${o}.json`,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify(a)}),s={};try{s=await d.json()}catch{}if(d.status===401||d.status===403)throw new Error(s.error||s.message||"Sign in as this site's owner to look podcasts up (and only on a private site).");if(d.status===404&&!s.error&&!s.message)throw new Error("This farm has no podcast service. Is wiki-plugin-podcast installed here?");if(!d.ok)throw new Error(s.error||s.message||`The farm answered ${d.status}.`);return s}var U=`
.podcast-item{border:1px solid #ddd;border-radius:6px;padding:10px;background:#fafaf7}
.podcast-item .pc-row{display:flex;gap:6px}
.podcast-item input{flex:1;min-width:0;padding:5px 7px;border:1px solid #bbb;border-radius:4px;font:inherit}
.podcast-item button{padding:4px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font:inherit}
.podcast-item button:disabled{opacity:.5;cursor:wait}
.podcast-item.pc-over{outline:2px dashed #4a7;background:#f0f8f0}
.podcast-item .pc-status{color:#666;font-size:85%;margin-top:6px;min-height:1em}
.podcast-item .pc-status.pc-error{color:#b33}
.podcast-item .pc-card{display:flex;gap:10px;margin-top:8px;align-items:flex-start}
.podcast-item .pc-card img{width:72px;height:72px;object-fit:cover;border-radius:4px}
.podcast-item .pc-title{font-weight:bold}
.podcast-item .pc-meta{color:#666;font-size:85%}
.podcast-item ul{margin:8px 0 0;padding:0;list-style:none}
.podcast-item li{display:flex;gap:6px;align-items:baseline;padding:2px 0;border-top:1px solid #eee;font-size:90%}
.podcast-item li span{flex:1}
.podcast-item li em{color:#888;font-style:normal;font-size:85%;white-space:nowrap}
.podcast-item li button{padding:1px 6px;font-size:85%}
.podcast-item .pc-mark{background:#fff6d6}
`,j=(o,a)=>{let{input:d}=x(a.text);if(!document.getElementById("podcast-plugin-style")){let s=document.createElement("style");s.id="podcast-plugin-style",s.textContent=U,document.head.appendChild(s)}o.html(`<div class="podcast-item">
    <div class="pc-row">
      <input class="pc-input" type="text" value="${n(d)}" placeholder="Paste or drop a podcast link, or type a title">
      <button class="pc-find">Find</button>
    </div>
    <div class="pc-status"></div>
    <div class="pc-result"></div>
  </div>`)},B=(o,a)=>{let d=x(a.text),s=o.find(".podcast-item")[0],m=o.find(".pc-input")[0],v=o.find(".pc-find")[0],h=o.find(".pc-status")[0],g=o.find(".pc-result")[0],c=null,r=(t,e)=>{h.textContent=t||"",h.classList.toggle("pc-error",!!e)},l=t=>{for(let e of s.querySelectorAll("button"))e.disabled=t};async function b(t){if(c){l(!0),r(t?"Building the episode page\u2026":"Building the podcast page\u2026");try{let e=await y("page",{feedUrl:c.found.feedUrl,episode:t,found:c.found,recent:d.recent}),i=o.parents(".page");wiki.showResult(wiki.newPage(e.page),{$page:i}),r(`Opened \u201C${e.page.title}\u201D as a ghost page. Fork it to keep it.`)}catch(e){r(e.message,!0)}finally{l(!1)}}}function w(t){c=t;let e=t.found,i=t.podcast,f=`${e.route} route${e.movedFrom?"; the old feed stopped, this is the live one":""}`,k=i.episodes.slice(0,10).map(p=>`<li class="${t.episode?.key===p.key?"pc-mark":""}">
        <span>${n(p.title)}</span><em>${n([T(p.published),P(p.duration)].filter(Boolean).join(", "))}</em>
        <button class="pc-ep" data-key="${n(p.key)}">page</button></li>`).join(""),$=e.ambiguous&&e.candidates?.length?`<div class="pc-meta" style="margin-top:8px">\u201C${n(e.input)}\u201D could be several podcasts. Not this one?</div><ul>${e.candidates.filter(p=>p.feedUrl!==e.feedUrl).slice(0,5).map(p=>`<li><span>${n(p.title)}</span><button class="pc-use" data-feed="${n(p.feedUrl)}">use</button></li>`).join("")}</ul>`:"",E=t.episode&&!i.episodes.slice(0,10).some(p=>p.key===t.episode.key)?`<div style="margin-top:8px"><button class="pc-ep" data-key="${n(t.episode.key)}">Episode page: ${n(t.episode.title)}</button></div>`:"";g.innerHTML=`<div class="pc-card">
        ${i.image?`<img src="${n(i.image)}" alt="">`:""}
        <div><div class="pc-title">${n(i.title)}</div>
          <div class="pc-meta">${n(i.author||"")}${i.author?" \xB7 ":""}${i.count} episodes \xB7 <a href="${n(e.feedUrl)}" target="_blank" rel="noopener">${n(S(e.feedUrl))}</a></div>
          <div class="pc-meta">found by the ${n(f)}</div>
          <div style="margin-top:6px"><button class="pc-pod">Podcast page</button></div></div>
      </div>${E}${$}<ul>${k}</ul>`,r(t.episode?`Found the podcast and the episode \u201C${t.episode.title}\u201D.`:"Found the podcast.")}async function u(t,e){if(t=(t??m.value).trim(),!t){r("Paste a podcast link, or type a title.",!0);return}m.value=t,l(!0),g.innerHTML="",r("Looking for the open feed\u2026");try{let i=await y("find",{input:t,title:e??d.title});if(!i.ok){r(`No feed found: ${i.found?.error||"unknown reason"}.`,!0);return}w(i)}catch(i){r(i.message,!0)}finally{l(!1)}}v.addEventListener("click",()=>u()),m.addEventListener("keydown",t=>{t.key==="Enter"&&(t.preventDefault(),u())}),g.addEventListener("click",t=>{let e=t.target.closest("button");e&&(e.classList.contains("pc-pod")?b():e.classList.contains("pc-ep")?b(e.dataset.key):e.classList.contains("pc-use")&&u(e.dataset.feed))}),s.addEventListener("dragover",t=>{t.preventDefault(),t.stopPropagation(),s.classList.add("pc-over")}),s.addEventListener("dragleave",()=>s.classList.remove("pc-over")),s.addEventListener("drop",t=>{t.preventDefault(),t.stopPropagation(),s.classList.remove("pc-over");let e=t.dataTransfer,i=(e.getData("text/uri-list")||"").split(`
`).find(f=>f&&!f.startsWith("#"))||e.getData("text/plain");i&&u(i.trim())}),o.on("dblclick",t=>{t.target.closest("input,button,a,li")||wiki.textEditor(o,a)})};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.podcast={emit:j,bind:B});})();
//# sourceMappingURL=podcast.js.map
