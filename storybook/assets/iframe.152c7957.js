import{c as f,a as u,b as O,P as p,C as R,d as L}from"./vendor.3f888b44.js";const P=function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))i(e);new MutationObserver(e=>{for(const r of e)if(r.type==="childList")for(const o of r.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&i(o)}).observe(document,{childList:!0,subtree:!0});function _(e){const r={};return e.integrity&&(r.integrity=e.integrity),e.referrerpolicy&&(r.referrerPolicy=e.referrerpolicy),e.crossorigin==="use-credentials"?r.credentials="include":e.crossorigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(e){if(e.ep)return;e.ep=!0;const r=_(e);fetch(e.href,r)}};P();const v="modulepreload",l={},h="./",t=function(s,_){return!_||_.length===0?s():Promise.all(_.map(i=>{if(i=`${h}${i}`,i in l)return;l[i]=!0;const e=i.endsWith(".css"),r=e?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${i}"]${r}`))return;const o=document.createElement("link");if(o.rel=e?"stylesheet":v,e||(o.as="script",o.crossOrigin=""),o.href=i,document.head.appendChild(o),e)return new Promise((E,m)=>{o.addEventListener("load",E),o.addEventListener("error",m)})})).then(()=>s())},d=f({page:"preview"});u.setChannel(d);window.__STORYBOOK_ADDONS_CHANNEL__=d;const{SERVER_CHANNEL_URL:a}=globalThis;if(a){const n=O({url:a});u.setServerChannel(n),window.__STORYBOOK_SERVER_CHANNEL__=n}const T={"./src/stories/Demo.stories.tsx":async()=>t(()=>import("./Demo.stories.5e774e4c.js"),["assets/Demo.stories.5e774e4c.js","assets/index.5fb43a63.js","assets/Listing.25ee582b.js","assets/Listing.6417040f.css","assets/index.33068e5f.js","assets/jsx-runtime.0c0cb522.js","assets/PenrosePrograms.0c8d197f.js","assets/Simple.456b9180.js"]),"./src/stories/Embed.stories.tsx":async()=>t(()=>import("./Embed.stories.d90c55b7.js"),["assets/Embed.stories.d90c55b7.js","assets/Embed.stories.d4a537c3.css","assets/index.5fb43a63.js","assets/jsx-runtime.0c0cb522.js","assets/Simple.456b9180.js","assets/PenrosePrograms.0c8d197f.js"]),"./src/stories/Listing.stories.tsx":async()=>t(()=>import("./Listing.stories.7f1a1239.js"),["assets/Listing.stories.7f1a1239.js","assets/Listing.25ee582b.js","assets/Listing.6417040f.css","assets/index.5fb43a63.js","assets/index.33068e5f.js","assets/jsx-runtime.0c0cb522.js","assets/PenrosePrograms.0c8d197f.js"]),"./src/stories/Simple.stories.tsx":async()=>t(()=>import("./Simple.stories.151bc22e.js"),["assets/Simple.stories.151bc22e.js","assets/Simple.456b9180.js","assets/PenrosePrograms.0c8d197f.js","assets/index.5fb43a63.js","assets/jsx-runtime.0c0cb522.js"])};async function y(n){return T[n]()}const A=async()=>L(await Promise.all([t(()=>import("./config.95699a68.js"),["assets/config.95699a68.js","assets/index.33068e5f.js","assets/vendor.3f888b44.js","assets/index.5fb43a63.js","assets/string.ee197102.js","assets/jsx-runtime.0c0cb522.js"]),t(()=>import("./config.edd73146.js"),["assets/config.edd73146.js","assets/vendor.3f888b44.js","assets/index.5fb43a63.js","assets/index.7826dbe5.js","assets/jsx-runtime.0c0cb522.js"]),t(()=>import("./preview.81bda474.js"),["assets/preview.81bda474.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.8ef0115c.js"),["assets/preview.8ef0115c.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.0512e47e.js"),["assets/preview.0512e47e.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.83a225cb.js"),["assets/preview.83a225cb.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.d11f1f08.js"),["assets/preview.d11f1f08.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.cf4979c1.js"),["assets/preview.cf4979c1.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.ebb14ae4.js"),["assets/preview.ebb14ae4.js","assets/vendor.3f888b44.js"]),t(()=>import("./preview.5dfc337f.js"),[])])),c=new p;window.__STORYBOOK_PREVIEW__=c;window.__STORYBOOK_STORY_STORE__=c.storyStore;window.__STORYBOOK_CLIENT_API__=new R({storyStore:c.storyStore});c.initialize({importFn:y,getProjectAnnotations:A});
//# sourceMappingURL=iframe.152c7957.js.map