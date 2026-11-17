'use strict';
/* Convya Flow V1: deterministic, locally authored automation; NO WhatsApp sends. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.ConvyaFlow=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 const TYPES={
  start:{label:'Início',icon:'▶',color:'#18a957'},
  input:{label:'Aguardar mensagem',icon:'◉',color:'#548de8'},
  wait:{label:'Esperar',icon:'◷',color:'#e3a023'},
  text:{label:'Enviar texto',icon:'✉',color:'#8b68d9'},
  image:{label:'Enviar imagem',icon:'▧',color:'#ce6c9d'},
  audio:{label:'Enviar áudio',icon:'♫',color:'#c67f4d'},
  video:{label:'Enviar vídeo',icon:'▣',color:'#5490a5'},
  link:{label:'Enviar site / link',icon:'↗',color:'#27a5a1'},
  condition:{label:'Condição SIM/NÃO',icon:'◇',color:'#e29b4c'},
  ai:{label:'IA opcional',icon:'✦',color:'#8a76d5'},
  human:{label:'Transferir humano',icon:'♙',color:'#6595a7'},
  end:{label:'Encerrar',icon:'■',color:'#75838d'}
 };
 const MAX_NODES=50;
 const id=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36);
 const toText=(x,max)=>String(x||'').trim().slice(0,max);
 const validUrl=u=>{try{const v=new URL(u);return v.protocol==='https:'||v.protocol==='http:'}catch{return false}};
 const defaultsFor=type=>{
  if(type==='start')return {title:'Início do atendimento'};
  if(type==='input')return {placeholder:'Aguardar mensagem do cliente',match:''};
  if(type==='wait')return {duration:2,unit:'minutos'};
  if(type==='text')return {text:'Olá! Obrigado pelo contato. Como posso ajudar?'};
  if(type==='condition')return {contains:'site'};
  if(type==='end')return {title:'Fim do fluxo'};
  if(type==='human')return {text:'Conversa encaminhada para atendimento humano (simulado).'};
  if(type==='ai')return {prompt:'Responda à dúvida do cliente sobre nossos serviços.'};
  if(type==='link')return {url:'',caption:'Veja nosso site'};
  if(type==='image'||type==='video'||type==='audio')return {url:'',caption:'Confira este conteúdo'};
  return {};
 };
 function node(type,x,y){if(!TYPES[type])throw Error('Bloco desconhecido');return {id:id(),type,x:Math.round(x),y:Math.round(y),config:defaultsFor(type),next:{}}}
 function create(title='Meu primeiro fluxo'){
  const flow={id:id(),name:title,status:'draft',updatedAt:new Date().toISOString(),nodes:[]};
  let start=node('start',145,65),input=node('input',145,255),wait=node('wait',145,445),message=node('text',145,635),end=node('end',145,825);
  start.next.out=input.id;input.next.out=wait.id;wait.next.out=message.id;message.next.out=end.id;
  flow.nodes=[start,input,wait,message,end];
  return flow;
 }
 function createYesNoDemo(){
  const flow={id:id(),name:'Exemplo SIM/NÃO',status:'draft',updatedAt:new Date().toISOString(),nodes:[]};
  const start=node('start',600,65),input=node('input',600,245),condition=node('condition',600,435);
  const yes=node('text',310,660),no=node('text',890,660),end=node('end',600,900);
  input.config.match='';condition.config.contains='sim';
  yes.config.text='Ótimo! Vou apresentar nossos serviços.';
  no.config.text='Sem problemas! Estamos à disposição.';
  start.next.out=input.id;input.next.out=condition.id;condition.next.yes=yes.id;condition.next.no=no.id;
  yes.next.out=end.id;no.next.out=end.id;
  flow.nodes=[start,input,condition,yes,no,end];return flow;
 }
 function cleanNode(n){
  if(!n||typeof n!=='object'||!TYPES[n.type]||typeof n.id!=='string'||n.id.length>80)throw Error('Bloco inválido');
  return {id:n.id,type:n.type,x:Math.min(2800,Math.max(0,Number.isFinite(n.x)?Math.round(n.x):100)),
   y:Math.min(2900,Math.max(0,Number.isFinite(n.y)?Math.round(n.y):100)),
   config:Object.fromEntries(Object.entries(n.config||{}).filter(([k])=>['title','placeholder','match','duration','unit','text','contains','prompt','url','caption'].includes(k)).map(([k,v])=>[k,typeof v==='number'?v:toText(v,1200)])),
   next:Object.fromEntries(Object.entries(n.next||{}).filter(([k,v])=>['out','yes','no'].includes(k)&&typeof v==='string').map(([k,v])=>[k,v]))};
 }
 function cleanFlow(flow){
  if(!flow||typeof flow!=='object'||!Array.isArray(flow.nodes)||flow.nodes.length>MAX_NODES)throw Error('Fluxo inválido ou muito grande');
  const nodes=flow.nodes.map(cleanNode);
  if(new Set(nodes.map(n=>n.id)).size!==nodes.length)throw Error('Há IDs duplicados no fluxo');
  return {id:toText(flow.id,80)||id(),name:toText(flow.name,90)||'Fluxo sem nome',
   status:['draft','published','paused'].includes(flow.status)?flow.status:'draft',
   updatedAt:flow.updatedAt||new Date().toISOString(),nodes};
 }
 function connect(flow,sourceId,port,targetId){
  const source=flow.nodes.find(n=>n.id===sourceId),target=flow.nodes.find(n=>n.id===targetId);
  if(!source||!target||source.id===target.id)throw Error('Selecione blocos diferentes');
  if(!['out','yes','no'].includes(port))throw Error('Porta inválida');
  if(source.type==='end'||source.type==='human')throw Error('Este bloco finaliza o atendimento');
  if(source.type==='condition'?(port==='out'):(port!=='out'))throw Error('Saída inválida para este bloco');
  if(target.type==='start')throw Error('Não é possível conectar ao início');
  source.next[port]=target.id;
  return flow;
 }
 function validate(flow){
  let errors=[];let map=new Map(flow.nodes.map(n=>[n.id,n]));
  const starts=flow.nodes.filter(n=>n.type==='start');
  if(starts.length!==1)errors.push('É necessário exatamente um bloco Início.');
  if(!flow.nodes.some(n=>n.type==='end'||n.type==='human'))errors.push('Adicione ao menos um bloco Encerrar ou Transferir humano.');
  if(flow.nodes.length>MAX_NODES)errors.push('Limite de 50 blocos.');
  for(const n of flow.nodes){
   const ports=n.type==='condition'?['yes','no']:['end','human'].includes(n.type)?[]:['out'];
   for(const port of ports){if(!n.next?.[port])errors.push('Conecte a saída '+(port==='out'?'principal':port.toUpperCase())+' de '+TYPES[n.type].label+'.');}
   for(const [port,target] of Object.entries(n.next||{})){
    if(!['out','yes','no'].includes(port)||!map.has(target))errors.push('Conexão quebrada em '+TYPES[n.type].label+'.');
   }
   if(n.type==='wait'){
    const t=Number(n.config.duration);
    if(!Number.isFinite(t)||t<0||t>10080||!['segundos','minutos','horas','dias'].includes(n.config.unit))errors.push('Espera inválida; use 0–10080 e unidade de tempo.');
   }
   if(n.type==='text'&&!toText(n.config.text,1200))errors.push('Preencha o bloco Enviar texto.');
   if(n.type==='condition'&&!toText(n.config.contains,120))errors.push('Defina a palavra da condição SIM/NÃO.');
   if(['image','video','audio','link'].includes(n.type)&&!validUrl(n.config.url))errors.push('Informe URL http(s) válida em '+TYPES[n.type].label+'.');
  }
  // Follow only linked paths. Orphan blocks must be connected before publishing.
  const walked=new Set(),stack=starts.length?[starts[0].id]:[];
  while(stack.length){const current=stack.pop();if(walked.has(current))continue;walked.add(current);
   const n=map.get(current);if(n)for(const next of Object.values(n.next||{}))if(map.has(next))stack.push(next);
  }
  for(const n of flow.nodes)if(!walked.has(n.id))errors.push('Bloco desconectado: '+TYPES[n.type].label+'.');
  // A cycle could never terminate in a simple MVP; disallow cycles.
  const active=new Set(),finished=new Set();let loop=false;
  function dfs(nid){if(active.has(nid)){loop=true;return}if(finished.has(nid))return;active.add(nid);
   const n=map.get(nid);if(n)for(const dest of Object.values(n.next||{}))if(map.has(dest))dfs(dest);
   active.delete(nid);finished.add(nid)}
  if(starts[0])dfs(starts[0].id);
  if(loop)errors.push('O fluxo contém um ciclo. Conecte sem voltas nesta versão.');
  return [...new Set(errors)];
 }
 function advance(flow,oldSession=null,customerText=''){
  const source=cleanFlow(flow),errors=validate(source);
  if(errors.length)return {ok:false,errors,events:[],steps:[],session:null};
  const byId=new Map(source.nodes.map(n=>[n.id,n]));
  const starts=source.nodes.find(n=>n.type==='start');
  let session=oldSession&&typeof oldSession==='object'&&oldSession.flowId===source.id?
   {flowId:source.id,cursor:oldSession.cursor,lastInput:String(oldSession.lastInput||'').slice(0,850),
    events:Array.isArray(oldSession.events)?oldSession.events.slice(-150):[],
    steps:Array.isArray(oldSession.steps)?oldSession.steps.slice(-150):[],
    ended:!!oldSession.ended,human:!!oldSession.human}:{
      flowId:source.id,cursor:starts.id,lastInput:'',events:[],steps:[],ended:false,human:false
    };
  if(session.ended||session.human)return {ok:true,ended:session.ended,human:session.human,waiting:false,events:session.events,steps:session.steps,session};
  let text=toText(customerText,850),consumed=false,waiting=false;
  for(let count=0;session.cursor&&count<=MAX_NODES;count++){
   const n=byId.get(session.cursor);
   if(!n){session.ended=true;break}
   const kind=n.type,c=n.config||{};
   let detail='',port='out',finish=false;
   if(kind==='start')detail='Fluxo iniciado';
   if(kind==='input'){
    const matches=!c.match||text.toLowerCase().includes(String(c.match).toLowerCase());
    if(!text||consumed||!matches){
      waiting=true;detail=c.match?'Aguardando mensagem contendo "'+c.match+'"':'Aguardando mensagem do cliente';
      if(!session.steps.length||session.steps.at(-1)?.id!==n.id||session.steps.at(-1)?.result!==detail)
       session.steps.push({id:n.id,type:kind,label:TYPES[kind].label,result:detail});
      break;
    }
    consumed=true;session.lastInput=text;
    detail='Cliente enviou: '+text;
    session.events.push({direction:'in',type:'text',text});
   }
   if(kind==='wait')detail='Espera simulada: '+c.duration+' '+c.unit+' (tempo acelerado)';
   if(kind==='text'){detail='Texto exibido';session.events.push({direction:'out',type:'text',text:toText(c.text,1200)})}
   if(['image','audio','video','link'].includes(kind)){
    detail='Mídia/link exibido somente na simulação';
    session.events.push({direction:'out',type:kind,url:toText(c.url,1200),text:toText(c.caption,120)});
   }
   if(kind==='condition'){
    const yes=session.lastInput.toLowerCase().includes(String(c.contains).toLowerCase());
    port=yes?'yes':'no';detail='Contém "'+c.contains+'"? '+(yes?'SIM':'NÃO');
   }
   if(kind==='ai'){
    detail='IA opcional (execução ainda não vinculada neste MVP)';
    session.events.push({direction:'note',type:'note',text:'Bloco IA configurado. Integração ainda não habilitada no motor real.'});
   }
   if(kind==='human'){
    detail='Atendimento humano simulado; ninguém foi avisado';finish=true;session.human=true;
    session.events.push({direction:'note',type:'note',text:'Transferência simulada. Nenhum atendente ou CRM foi acionado.'});
   }
   if(kind==='end'){detail='Fluxo encerrado';finish=true;session.ended=true}
   session.steps.push({id:n.id,type:kind,label:TYPES[kind].label,result:detail});
   session.cursor=finish?null:n.next?.[port]||null;
   if(!session.cursor&&!finish)session.ended=true;
  }
  return {ok:true,waiting,ended:session.ended,human:session.human,
   events:session.events,steps:session.steps,session};
 }
 function simulate(flow,customerText,options={}){
  const result=advance(flow,null,customerText);
  const {session,...publicResult}=result;
  return publicResult;
 }
 return {TYPES,MAX_NODES,create,createYesNoDemo,node,cleanFlow,connect,validate,advance,simulate,validUrl};
});
